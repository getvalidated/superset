# Fix workspace-row gesture jank (dead taps, tap+context-menu double-fire)

## Symptoms (prod/Release build on device; dev mostly masks it)

- Some workspace rows on Home don't respond to taps; which rows are dead can
  change as you scroll.
- Press-and-hold both navigates to the workspace AND opens the context menu
  (menu appears on top of the next screen).

## Root cause

Each row is wrapped in expo-router `Link` + `Link.Trigger` + `Link.Menu`
(`screens/(authenticated)/(home)/workspaces/components/WorkspaceRow/components/WorkspaceRowMenu/WorkspaceRowMenu.tsx`).
`Link.Menu` attaches a native `UIContextMenuInteraction` per row. Inside
LegendList (virtualized, `recycleItems: false` → rows constantly unmount and
remount) some interactions come back mis-wired, and the RN `Pressable` and the
native long-press recognizer race each other — RN commits the navigation press
while UIKit commits the menu. Same failure class we already hit with per-row
`@expo/ui` ContextMenus (see memory of the stuck press-highlight platter);
per-row native interactions and RN list virtualization don't mix.

## Step 0 — confirm on device (fast A/B)

Local Release build on the iPhone: `bunx expo run:ios --device --configuration Release`.
Then delete the `<Link.Menu>…</Link.Menu>` block from WorkspaceRowMenu and
rebuild. If every row taps reliably and nothing double-fires, root cause is
confirmed. Keep the A build around for comparison.

## Fix options (in order of effort)

### Option A — drop per-row native menus, keep LegendList (small, do this first)

- WorkspaceRowMenu: remove `Link.Menu`; keep plain `Link`/`Link.Trigger` for
  navigation (or a plain `Pressable` + `router.push`).
- Row actions move to `onLongPress` → a route-presented sheet, exactly like the
  existing filter sheet (`app/(authenticated)/(home)/filter` formSheet pattern):
  `app/(authenticated)/(home)/workspace-actions?workspaceId=…` with
  Rename / Delete / Copy ID / Share rows (reuse `ListRow` primitives from
  `screens/(authenticated)/components/`). The rename/delete handlers already
  live in WorkspaceRowMenu — lift them into the sheet screen; they need
  `useHostWorkspaces(selectedHost).cache` + `getHostServiceClientByUrl`.
- Cost: loses the iOS context-menu preview flourish. Gains: deterministic
  gestures, no native interaction per cell.

### Option B — native SwiftUI List (the platform-correct version)

Validated by a 184-row spike earlier this week: `@expo/ui/swift-ui` `List`
with `RNHostView` rows renders and scrolls fine.

Structure per row:

```tsx
import { ContextMenu, Host, List, RNHostView, Button, Submenu } from "@expo/ui/swift-ui";

<Host style={{ flex: 1 }}>
  <List /* listStyle plain */>
    {rows.map((w) => (
      <ContextMenu key={w.id}>
        <ContextMenu.Items>
          <Button onPress={rename}>Rename</Button>
          <Button role="destructive" onPress={destroy}>Delete</Button>
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView style={{ height: 64 }}>
            {/* existing WorkspaceRow body (Pressable onPress → router.push) */}
          </RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    ))}
  </List>
</Host>
```

Hard-won constraints (all verified, don't rediscover them):
- `RNHostView` rows inside a native `List` work; **use fixed height** —
  `matchContents` never settles in virtualized cells.
- SwiftUI `Text` in @expo/ui has NO color/font styling — keep all row content
  as RN views inside RNHostView; use SwiftUI only for List/ContextMenu chrome.
- Per-row `Host` in RN scroll views glitches — that's the inverse embedding;
  it does not apply to RNHostView-inside-List.
- List chrome (separators/insets) differs from the current design; budget a
  styling pass (`listRowInsets`, `listStyle` modifiers).

Consequences to handle:
- **Pull-to-refresh**: List has no RN `refreshControl`; keep the
  `useFocusEffect` invalidation and drop pull-to-refresh, or check @expo/ui
  List `refreshable` support.
- **Viewport-bounded diff stats**: `useVisibleDiffStats` keys off LegendList's
  `onViewableItemsChanged`, which List doesn't expose. The list view is now
  single-host + single-project, so row counts are modest: fetch diff stats for
  the first N (~30) visible-sorted rows instead, or all rows with a cap —
  keep `staleTime`/cache semantics from
  `screens/(authenticated)/(home)/workspaces/hooks/useVisibleDiffStats/`.
- Empty/offline states (`HostOfflineView`, empty text) render outside the List.

## Recommendation

Ship Option A now (unblocks prod testing, ~1 hour). Spike Option B behind the
same screen afterwards; keep it only if the native feel wins and the diff-stats
and styling consequences are acceptable.

## Verification

- Release build on device: tap 30+ rows across several scroll passes — zero
  dead rows; long-press opens actions without navigating; rename/delete still
  round-trip through the host (`workspace.update` / `workspaceCleanup.destroy`).
- Regression: workspace push still lands on chat; diff stats still appear.
