# Fix workspace-row gesture jank (dead taps, tap+context-menu double-fire)

## Symptoms (prod/Release build on device; dev mostly masks it)

- Some workspace rows on Home don't respond to taps; which rows are dead can
  change as you scroll.
- Press-and-hold both navigates to the workspace AND opens the context menu
  (menu appears on top of the next screen).

## Root cause

Each row is wrapped in expo-router `Link` + `Link.Trigger` + `Link.Menu`
(`screens/(authenticated)/(home)/workspaces/components/WorkspaceRow/components/WorkspaceRowMenu/WorkspaceRowMenu.tsx`).
`Link.Menu` attaches a native `UIContextMenuInteraction` per row. Inside a
virtualized list (LegendList, `recycleItems: false` → cells constantly unmount
and remount) some interactions come back mis-wired, and the RN `Pressable` and
the native long-press recognizer race — RN commits the navigation press while
UIKit commits the menu. This is a property of per-row native interactions ×
cell churn, NOT a LegendList bug: FlatList would show it at lower frequency,
and FlashList (true cell recycling) would be worse. A SwiftUI `List`
(@expo/ui) was considered and spiked viable, but couples list fixes to native
releases — rejected to protect OTA iteration.

## Decision: drop virtualization — plain ScrollView

The list is now scoped to one host + one project; realistic row counts are
tens, worst case ~200. That doesn't need virtualization: a `ScrollView` +
`rows.map(...)` mounts every row once, giving each `Link.Menu` a stable native
view (bug class gone), keeps the native context menus + preview, scrolls with
zero per-frame mount work, and stays 100% JS/OTA-updatable. A ~200-row mount
costs a few hundred ms once, off the interaction path.

## Step 0 — confirm on device first

Local Release build (`bunx expo run:ios --device --configuration Release`),
A/B with the `<Link.Menu>` block deleted, to confirm the root cause before
restructuring. Keep both observations in the PR description.

## Implementation

`screens/(authenticated)/(home)/workspaces/WorkspacesScreen.tsx`:

1. Replace `LegendList` with `ScrollView` (keep `contentInsetAdjustmentBehavior`,
   `contentContainerStyle` incl. the `minHeight` used to keep the offline/empty
   states filling the viewport, and `refreshControl` — all supported).
2. Render `visibleWorkspaces.map((item) => <WorkspaceRow key={item.id} … />)`.
   `renderItem`, `extraData`, `keyExtractor`, `viewabilityConfig`,
   `onViewableItemsChanged`, `ListEmptyComponent` go away; empty state becomes
   a conditional above/instead of the map.
3. Diff stats: `useVisibleDiffStats` loses `onViewableItemsChanged`. Replace
   the viewport gate with a simple cap: fetch `git.getStatus` for the first
   `N = 30` rows of the sorted list (they're what's on/near screen given sort
   by recency), keep the existing query keys, staleTime, and the
   read-from-whole-cache map so previously fetched rows keep their numbers.
   Rename the hook accordingly (e.g. `useWorkspaceDiffStats`).
4. `WorkspaceRowMenu` stays exactly as is (Link + Trigger + Menu) — the point
   of this change is that it becomes reliable on stable views.

Keep LegendList out of the workspaces screen only — other screens are
unaffected.

## If jank survives on stable views (fallback)

Then the menus themselves are the problem regardless of mounting: remove
`Link.Menu` and move actions to long-press → a route-presented formSheet
(same pattern as `app/(authenticated)/(home)/filter`, reusing `ListRow`
primitives). Fully deterministic, still OTA-safe.

## Verification (Release build on device)

- Tap 30+ rows across several scroll passes — zero dead rows.
- Long-press opens the context menu WITHOUT navigating; menu preview shows;
  Rename / Delete / Copy ID / Share all work (rename+delete round-trip
  through the owning host).
- Project with many workspaces (e.g. Superset, 100+): initial render latency
  acceptable on device; scrolling smooth.
- Diff stats appear for the top rows and survive scroll away/back.
