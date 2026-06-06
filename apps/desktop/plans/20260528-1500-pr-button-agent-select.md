# PR action button — agent select

Status: shipped (phases 1–4)
Owner: desktop
Related: PR #4966 (inline agent-comment composer on v2 DiffPane), v2 `PRActionHeader`

Mirror the agent-pick affordance from the DiffPane comment composer
into the top-right PR action slot. Every PR-flow click runs through an
agent — the user picks **which** agent (running terminal, fresh
preset, or chat tab fallback), and the slash command (`/pr/create-pr`,
`/pr/update-pr`) does the actual `gh pr create` / `gh pr edit`.

## As shipped

### Component layout

```
PRActionHeader/
  PRActionHeader.tsx                # routes selectActionButton → ActionSlot
  hooks/useProjectPRPrompt/         # reads + writes .superset/pr-prompt.md
  components/
    PRActionSplitButton/            # the unified pill (create OR update + badge)
      PRActionSplitButton.tsx
      components/
        PRAgentPickerMenu/          # dropdown items: Active sessions + Start new + Edit prompt
        PRPromptEditDialog/         # textarea editor for .superset/pr-prompt.md
      hooks/
        usePRActionAgentTarget/     # localStorage persistence (PR-scoped keys)
        usePRActionDispatch/        # routes target → transport (chat / existing / new)
    PRStatusGroup/                  # standalone PR badge — used when no agent action pairs
      PRStatusGroup.tsx
      components/
        PRBadgeLink/                # the HoverCard + #N link (shared with the unified pill)
        MergePRMenuItems/           # 3 merge-strategy items (shared with the unified pill)
        PRStatusIndicators/
        PRDetailCard/
      hooks/useMergePR/             # merge mutation + toast lifecycle (shared)
      utils/stateTintClasses/       # state-tinted container/hover/divider classes (shared)
    PRAgentPickerSelect — gone (replaced by PRAgentPickerMenu)
    CreatePRIconButton — gone (replaced by PRActionSplitButton)
  utils/
    getPRFlowState/                 # state machine + selectActionButton
    buildPRContext/                 # pr-context.md (sync info + PR meta + Project guidelines)
  ../../hooks/planDispatch/         # planDispatch + formatInlinedPRPrompt + OpenChatFn
  ../../../hooks/useCreateNewAgentSession/  # lifted out of usePaneRegistry
```

Shared (renderer-level) primitives lifted out of the comment composer:
- `renderer/hooks/agents/useAgentTarget` — selection state + localStorage
  persistence + validation, parametrized by `storageKeys`.
- `renderer/hooks/host-service/useSendToTerminalAgent` (already shared).
- `renderer/hooks/host-service/useTerminalAgentBindings` (already shared).
- `renderer/hooks/useV2AgentConfigs` (already shared).

### State matrix (PR exists)

`selectActionButton` returns:

| PR state | Sync | Variant | What renders |
|---|---|---|---|
| open + non-draft | clean | `hidden` | `PRStatusGroup` alone (badge IS the view) |
| open + non-draft | dirty | `update-pr-dropdown` | **Unified pill**: Update primary + #N badge + one chevron |
| open + non-draft | behind upstream | `update-pr-dropdown` + `blockedReason` | Unified pill, primary disabled with tooltip |
| draft | any | `update-pr-dropdown` | Unified pill (Mark-ready deferred) |
| merged / closed | any | `hidden` | `PRStatusGroup` alone |

For no PR yet (`no-pr`) the pill is `kind="create"` (no badge, no merge
section, neutral tint). Loading / unavailable / error / busy paths are
mostly unchanged.

### Unified pill anatomy

```
┌──────────────────────────────────────────────────────────┐
│ ✏️ Update PR │ 🟢 #42 ✓✓✓ │ ▾                            │
└──────────────────────────────────────────────────────────┘
   primary       PR badge       single chevron
   (agent        (hover card,    (combined menu)
   dispatch)     opens GitHub)
```

Container picks up the PR state tint (`stateTintClasses(linkState)`)
when `prBadge` is set; neutral `bg-muted/40` otherwise.

Chevron menu sections (top to bottom):
- **Active sessions** — running terminal agents for this workspace.
- **Start new** — available `HostAgentConfig`s (preset launch).
- **Edit PR prompt…** — opens `PRPromptEditDialog`.
- **Merge** (when `canMerge`) — Squash / Merge commit / Rebase.

### Transports

`usePRActionDispatch` routes by target:
- **null** → `onOpenChat({ initialPrompt, initialFiles })` (chat tab).
- **existing** → `sendToTerminalAgent` + focus the target pane + toast.
- **new** → `onCreateNewAgentSession({ configId, placement, prompt })`
  (split-pane placement is the persisted default).

Payload is `formatInlinedPRPrompt(plan)` for terminal/new transports
(slash command + `**pr-context.md**` heading + markdown inlined),
and the same plan as a real attachment for the chat tab path.

### Per-project prompt

`.superset/pr-prompt.md` is the per-project override:
- `useProjectPRPrompt(workspaceId)` wraps
  `electronTrpc.filesystem.{readFile,writeFile}` with absolute-path
  resolution + "file not found" masking.
- `buildPRContext(state, { projectPrompt })` appends a
  `## Project guidelines` section to the `pr-context.md` payload when
  the file is non-empty.
- `.agents/commands/pr/{create-pr,update-pr}.md` instruct the agent
  to honour that section as non-negotiable stylistic preferences
  (guardrails still win).
- Edit surface: "Edit PR prompt…" item at the tail of the chevron
  menu opens `PRPromptEditDialog` — textarea seeded from the file,
  Save (writes + invalidates the read query), Cancel, and an
  "Open in editor" deep-link into a v2 file tab.

## Out of scope (deferred)

- **Mark ready** for clean drafts. Could swap the primary to
  `gh pr ready`-via-agent, or wire a direct tRPC mutation. Not
  blocking shipping.
- **usePRActionDispatch hook tests**. Would need new test infra
  (`@testing-library/react` + a DOM env) — not present in the repo
  today. The pure transport-format helper (`formatInlinedPRPrompt`)
  IS covered.
- **Per-item mid-launch spinner** inside the agent picker dropdown
  (the pill primary already shows busy for the resting flow).
