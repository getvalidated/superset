# React Scan Workspace Performance Findings

Date: 2026-06-02
Repo: `main` at `5881fdcced92917e08531a741c608e73bfaebdec`
Trace files:

- `/tmp/superset-react-scan-broader.jsonl`
- `/tmp/superset-react-scan-root-main.jsonl`
- `/tmp/superset-react-scan-open-oboe-claude.jsonl`
- `/tmp/superset-react-scan-final2.jsonl`

## Summary

The observed CPU spikes are interaction-triggered render fanout, not an idle render loop. Idle with the workspace open was nearly quiet, but tab switching, pane creation, and opening the right sidebar produced many React commits and long tasks.

The biggest cost is not the terminal renderer itself. Pane layout changes write broad workspace-local state, which wakes unrelated workspace UI. The render cascade then flows through the route/provider stack, tab bar, pane headers, right sidebar, and Radix tooltip/dropdown/context-menu wrappers.

## Profile Results

| Scenario | Commits | React commit duration | Long tasks |
| --- | ---: | ---: | ---: |
| Idle, right sidebar open | 1 | 1.4 ms | 0 |
| Idle, right sidebar closed | 1 | 4.6 ms | 0 |
| Switch tabs, right sidebar open | 76 | 290.8 ms | 7 |
| Switch tabs, right sidebar closed | 51 | 265.7 ms | 5 |
| Create 4 terminal tabs, right sidebar closed | 41 | 118.4 ms | 4 |
| Open right sidebar | 22 | 226.6 ms | 1 |
| Create 2 terminal tabs, right sidebar open | 37 | 136.2 ms | 5 |

## Open Workspace With Claude Active

I also profiled the currently opened workspace, `test / open-oboe`, with the right sidebar open and Claude visible. This run used the active desktop route:

`http://localhost:7665/#/v2-workspace/d3010a09-de89-4c81-8ff1-0a6663ce6ba9`

| Scenario | Commits | React commit duration | Long tasks | Long task duration |
| --- | ---: | ---: | ---: | ---: |
| Activate Claude from Chat | 23 | 145.8 ms | 4 | 354 ms |
| Switch Claude/terminal tabs | 88 | 263.6 ms | 11 | 836 ms |
| Create panes from Claude-open workspace | 125 | 318.2 ms | 11 | 1009 ms |
| Idle with Claude active after multi-terminal setup | 3 | 9.9 ms | 0 | 0 ms |

Notes:

- `Cmd+T` created a new Chat pane in this workspace, so the pane-creation scenario includes one accidental Chat pane followed by two Terminal panes created through the add-pane menu.
- The idle result again argues against a continuous idle render loop. The CPU spikes are tied to interaction bursts.
- The hot local components matched the earlier root-main profiles:
  - `TooltipTrigger` rendered 3,028 times during the Claude/terminal switch burst and 4,461 times during pane creation.
  - `TabBar` rendered 434 times during the switch burst and 566 times during pane creation.
  - `DropdownMenu` rendered 864 times during the switch burst and 1,312 times during pane creation.
  - `WorkspaceClientProvider`, `TRPCProvider`, and `QueryClientProvider` each rendered 176 times during the switch burst and 250 times during pane creation.

This reinforces the diagnosis that pane interactions fan out through shared workspace state, then through the workspace provider stack and every tab/header overlay primitive. Claude being open is not a separate root cause; it adds another pane type into the same expensive tab and provider cascade.

## Fixes Applied

The first patch set targeted the measured render fanout without changing pane behavior:

- Debounced `paneLayout` persistence in `useV2WorkspacePaneLayout` so rapid pane/tab mutations write one local-state update after the burst instead of on every store mutation.
- Stabilized workspace render props in `V2WorkspaceContent`, including tab accessory, add menu, below-tab-bar, trailing controls, empty state, and workspace-run button.
- Stabilized tab callbacks in `Workspace` and `TabBar`, then memoized `TabItem`.
- Removed always-mounted tab label and close-button `Tooltip` wrappers in favor of native `title` and `aria-label`.
- Lazy-mounted tab and pane context-menu content only while the menu is open.
- Reused the cached `WorkspaceClientProvider` client object as the context value.
- Memoized the `WorkspaceProvider` value.

I also tested hoisting `workspaceRunTerminals` from each terminal dropdown into the pane registry. React Scan showed that this made the registry depend on a broad, frequently changing map and increased workspace-wide rerenders, so I reverted that part. The better follow-up is to split workspace-run terminal state out of the broad `v2WorkspaceLocalState` row, not to pass the full map through the whole pane registry.

## Validation After Fixes

Final validation used the same open workspace route with Claude open and the right sidebar open. It is a conservative comparison because the final run had more existing terminal tabs than the baseline after repeated create-pane tests.

| Scenario | Baseline commits | Final commits | Baseline React duration | Final React duration | Baseline long tasks | Final long tasks | Baseline long-task duration | Final long-task duration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Idle with Claude active | 3 | 7 | 9.9 ms | 27.4 ms | 0 | 0 | 0 ms | 0 ms |
| Switch Claude/terminal tabs | 88 | 36 | 263.6 ms | 211.6 ms | 11 | 1 | 836 ms | 70 ms |
| Create 2 terminal tabs | 125 | 76 | 318.2 ms | 232.6 ms | 11 | 4 | 1009 ms | 299 ms |

Key deltas:

- Tab switching: commits down 59%, React commit duration down 20%, long-task count down 91%, long-task duration down 92%.
- Creating two terminal panes: commits down 39%, React commit duration down 27%, long-task count down 64%, long-task duration down 70%.
- Idle is still quiet in terms of long tasks, but the final idle commit count was higher than baseline because the workspace had accumulated more panes during profiling and sidebar/git status work was active.

Hot components after fixes:

- `TooltipTrigger` remains the biggest local render counter during pane creation, but dropped from 4,461 renders to 1,824 renders.
- `TabBar`/tab-item context-menu work dropped substantially after lazy-mounting menu content. `ContextMenu` no longer shows up as a top local component in the final switch burst.
- The route/provider stack still rerenders once per workspace interaction commit, so the next larger improvement needs narrower state subscriptions rather than more tab-level memoization.

## Main Findings

1. Workspace-local state is too broad.

   `v2WorkspaceLocalState` currently stores `paneLayout`, `sidebarState`, `viewedFiles`, `recentlyViewedFiles`, and `workspaceRunTerminals` in one localStorage collection row. A pane layout change therefore invalidates subscribers that only care about sidebar state or workspace-run terminal state.

   Relevant files:

   - `apps/desktop/src/renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema.ts`
   - `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useV2WorkspacePaneLayout/useV2WorkspacePaneLayout.ts`

2. Terminal panes still read workspace-run state from the broad local-state row.

   Every `TerminalSessionDropdown` performs a `useLiveQuery` against the full `v2WorkspaceLocalState` row to read `workspaceRunTerminals[terminalId]`. With several terminal tabs open, each pane layout update can wake each terminal header. Hoisting the full map into the pane registry made the wider workspace subtree depend on the same state, so the right fix is splitting or narrowing the stored state.

   Relevant file:

   - `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/components/TerminalSessionDropdown/TerminalSessionDropdown.tsx`

3. The right sidebar adds significant render cost, but it is not the whole issue.

   Closing the sidebar reduced commits during tab switching from 76 to 51, but still left 5 long tasks. The sidebar subscribes to the same workspace-local row and the Changes tab rerenders during terminal-only interactions.

   Relevant file:

   - `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceSidebar/WorkspaceSidebar.tsx`

4. Tab rendering scales with tab count.

   `TabBar` maps all tabs on each active-tab change. Each `TabItem` mounts context menu and tooltip primitives, and callback/accessory props are recreated from `V2WorkspaceContent`. This showed up as thousands of `TooltipTrigger`, `DropdownMenu`, and `ContextMenu` renders.

   Relevant files:

   - `packages/panes/src/react/components/Workspace/components/TabBar/TabBar.tsx`
   - `packages/panes/src/react/components/Workspace/components/TabBar/components/TabItem/TabItem.tsx`
   - `packages/ui/src/components/ui/tooltip.tsx`
   - `packages/ui/src/components/ui/dropdown-menu.tsx`

5. Provider context values participate in the cascade.

   `WorkspaceClientProvider` recreates its context value on parent renders. React Scan repeatedly showed `WorkspaceClientProvider`, `TRPCProvider`, and `QueryClientProvider` in the hot path during tab switching and pane creation.

   Relevant file:

   - `packages/workspace-client/src/providers/WorkspaceClientProvider/WorkspaceClientProvider.tsx`

## Proposed Fix Plan

1. Split or narrow workspace-local state subscriptions.

   Prefer separate local collections for:

   - pane layout
   - sidebar state
   - workspace-run terminal state
   - viewed/recent files

   If a schema split is too large for the first pass, add selector hooks that expose stable, narrow values and avoid passing full local-state rows into unrelated UI.

2. Split workspace-run terminal state out of the pane-layout row.

   Do not pass the full `workspaceRunTerminals` map through `usePaneRegistry`. Prefer a separate local collection, or a selector that subscribes only to one `terminalId` so terminal status updates do not invalidate unrelated tab/header UI.

3. Continue reducing always-mounted overlay primitives.

   Tab context-menu content is now lazy-mounted, but tooltip wrappers across the sidebar, preset bar, and pane headers remain hot. Convert low-value static tooltips on frequently rerendered chrome to native `title` or a shared/lazy tooltip trigger.

4. Batch pane layout persistence.

   `useV2WorkspacePaneLayout` currently snapshots the full pane store with `JSON.stringify` and writes each store update to local storage. Debounce or microtask-batch persistence so rapid tab/pane mutations produce one local state write, and compare a cheaper revision/snapshot where possible.

5. Stabilize remaining workspace render props.

   The main `V2WorkspaceContent` render props are now memoized. Continue this work in sidebar/pane header components that still recreate dropdown/tooltip props during workspace-level commits.

6. Memoize pane header components and avoid always-mounted overlays.

   `TabItem` is now memoized and tab/pane context-menu content is lazy-mounted. Extend the same approach to pane header extras and right-sidebar toolbar components after narrowing state subscriptions.

7. Re-profile against budgets.

   Suggested budgets for the same scenarios:

   - idle: 0-1 commits per 10 seconds, no long tasks
   - tab switch burst: under 25 commits, no long tasks
   - create 4 terminal tabs: under 25 commits, no long tasks
   - `TooltipTrigger` render count reduced by at least 70 percent

## Notes

React Scan attributed render and CPU work, not heap retention. A real memory-leak investigation should add Chromium/Electron heap snapshots after repeated open/switch/close cycles, but reducing the render fanout should come first because it is the directly measured CPU spike.
