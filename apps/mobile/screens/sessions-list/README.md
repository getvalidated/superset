# Sessions-list (pixel-perfect Wave 5)

Storybook-only sessions-list view layer. Each subfolder under `views/`
corresponds 1:1 with a design in `designs/views/01-sessions-list/`.

## What lives here

| Path | Purpose |
|---|---|
| `components/{SessionsList, ProjectPickerSheet, SessionFilterSheet, NewChatSheet}/` | 4 organisms specific to this tier |
| `views/{ViewName}/` | 10 view stories (1 loaded + 5 empty + 1 contact-sheet + 3 overlays) |
| `types.ts` | Domain type re-exports + ChatSession / Project / WorkspacePickerEntry / SessionsFilters / SessionsEmptyVariant |
| `mock-data.ts` | Centralized fixtures matching `designs/views/01-sessions-list/states/loaded/README.md` |

## Wireframe ↔ view mapping (10 views, UC-NAV)

| View | UC |
|---|---|
| SessionsListLoaded | UC-NAV §A |
| SessionsListEmptyNoProjects | UC-NAV-06.1 |
| SessionsListEmptyNoWorkspaces | UC-NAV-06.2 |
| SessionsListEmptyNoSessions | UC-NAV-06.3 |
| SessionsListSearchNoMatch | UC-NAV-06.4 |
| SessionsListFiltersNoMatch | UC-NAV-06.5 |
| SessionsListCombinedEmpty | reference contact sheet (all 5 variants stacked) |
| ProjectPickerSheetView | UC-NAV §B |
| SessionFilterSheetView | UC-NAV-08 §C |
| NewChatSheetView | UC-NAV §D |

## New molecules (this wave)

`SessionRow`, `ProjectChipHeader`, `EmptyState`, `FilterCheckboxRow`,
`AppliedFilterTag`, `WorkspacePickerRow`, `ProjectPickerRow` — all under
`apps/mobile/components/`.

## Storybook integration

`apps/mobile/.rnstorybook/main.js` gets a new narrow glob:

```js
"../screens/sessions-list/**/*.stories.?(ts|tsx|js|jsx)"
```

Same pattern as chat-view — narrow because sibling screens import
expo-router which crashes Storybook 9 RN's prep-time `loadStory`. Files
under `sessions-list/` stay router-free by construction.
