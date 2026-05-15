# Terminal WebGL Rendering and Glyph Corruption

This note covers terminal rendering failures where the PTY stream is still
alive but the terminal pixels are wrong: blank panes after switching, smeared
glyphs, overlapping text, or rows that look like a corrupted font atlas.

If copying text out of the affected terminal returns clean text, treat the
failure as a renderer/GPU issue first. The backend session, daemon stream, and
terminal buffer may still be correct.

## What We Already Do

- Electron raises Chromium's active WebGL context cap to `256` in
  `apps/desktop/src/lib/electron-app/factories/app/setup.ts`. Each xterm WebGL
  renderer owns a context, and parked terminal panes can otherwise exceed
  Chromium's default cap of `16`, causing forced context eviction.
- On macOS, Electron starts with
  `disable-backgrounding-occluded-windows` to avoid compositor throttling for
  windows that are covered or backgrounded.
- Terminal WebGL loading is optional, centralized in
  `apps/desktop/src/renderer/lib/terminal/terminal-webgl-addon.ts`, and
  deferred by one animation frame in both terminal creation paths.
- If `WebglAddon` fails to load, the renderer records
  `suggestedRendererType = "dom"` and skips WebGL for later terminals in the
  same renderer process.
- If WebGL reports context loss, the current code disposes that terminal's
  `WebglAddon`, clears the addon reference, promotes the renderer process to
  DOM fallback for later terminals, and refreshes the visible rows immediately
  and again on the next animation frame. That gives xterm a chance to keep
  rendering without the lost WebGL context and avoids re-entering the same GPU
  path for newly created terminals.
- If xterm's private WebGL atlas state reaches high pressure, the code clears
  the atlas through `WebglAddon.clearTextureAtlas()` and refreshes the visible
  rows. The guard currently trips when xterm has requested an atlas-model clear
  or when any atlas page reaches at least 2048px wide/high. This is deliberately
  renderer-local: it does not touch the PTY, replay, serialized buffer, pane
  ownership, or terminal parking.
- The v2 terminal runtime parks xterm wrappers on detach instead of tearing
  them down. Switching workspaces should reattach the same runtime instead of
  replaying a large terminal history into a fresh renderer.
- Unicode 11 is activated before restoring serialized buffers. That prevents
  CJK, emoji, and ZWJ-width decisions from being baked into replay with the
  wrong width table.
- The image addon is bounded in
  `apps/desktop/src/renderer/lib/terminal/terminal-image-addon.ts`:
  `storageLimit: 16`, `pixelLimit: 1_048_576`, and 8 MB limits for kitty/IIP
  payloads. This avoids one image-heavy terminal consuming unbounded renderer
  memory.
- Terminal dispose is delayed by two animation frames after parking the wrapper
  so pending xterm refresh work can drain before the DOM node disappears.

## What The Font-Breaking Screenshot Suggests

The screenshot with mixed, smeared glyphs looks more like a WebGL glyph atlas
or renderer-cache failure than a bad PTY stream. The terminal prompt and layout
still exist, but glyphs from previous cells appear to bleed through the current
row.

Likely causes to check first:

- WebGL context loss or forced context eviction.
- GPU texture atlas corruption after a context loss.
- Too many live terminal WebGL contexts while parked terminals remain alive.
- Font or ligature cache mismatch after appearance changes.
- xterm refresh work racing with a hidden, detached, or zero-sized terminal.

Upstream xterm repros point at the same class of problem:

- `xtermjs/xterm.js#5847`
  (https://github.com/xtermjs/xterm.js/issues/5847) is open and reports WebGL
  row ghosting and glyph substitution under heavy true-color output.
- `xtermjs/xterm.js#4534` and `xtermjs/xterm.js#4484` cover texture-atlas
  corruption under high color/atlas pressure.
- `xtermjs/xterm.js#4351` covers blurry glyphs during atlas page merging, and
  `xtermjs/xterm.js#4480` covers TUI-driven WebGL render glitches.

## Confirmed Reproduction

Stable WebGL glyph corruption reproduces locally with the renderer stress
harness by writing xterm's true-color atlas rewrite pattern, then comparing a
fixed sentinel frame before and after `clearTextureAtlas()`.

Before the atlas guard, a 1-terminal run changed 241,147 pixels after clearing
the atlas. The saved before-clear screenshot had visible row ghosting and glyph
substitution, while the after-clear screenshot was clean. After the guard, the
same run completed with 0 changed pixels and WebGL still active.

The remaining separate risk is that the browser can still show a one-frame
blank while a WebGL context-loss event is being delivered. Once xterm calls our
context-loss handler, the terminal should fall back to DOM and repaint.

## Recommended Next Fixes

1. Add a developer kill switch for diagnosis, for example
   `SUPERSET_TERMINAL_RENDERER=dom`. This should bypass WebGL loading without
   changing terminal session behavior, replay, persistence, or pane ownership.
2. If corruption survives after WebGL disposal, rebuild only the xterm renderer
   runtime from the serialized terminal buffer. Do not kill the backend PTY and
   do not force a daemon replay on ordinary workspace switches.
3. Consider a terminal WebGL budget instead of raising the context cap further:
   keep WebGL on visible terminals and use DOM for newly created terminals once
   the live WebGL count is above a conservative limit. This preserves parked
   terminal sessions without letting hidden panes own unlimited GPU contexts.
4. If the issue reproduces with DOM rendering, isolate font and ligature state:
   disable `LigaturesAddon` behind the same diagnostic switch and verify whether
   the copied terminal text still matches the corrupt pixels.

Avoid papering over this with periodic full-terminal refreshes, larger replay
windows, or more switch-time terminal reconstruction. Those approaches make
workspace switching slower and risk reintroducing the long background replay
problem.

## Diagnosis Checklist

- Copy several corrupt lines from the terminal. If the clipboard text is clean,
  investigate renderer/WebGL/font state before the PTY stream.
- Check DevTools console for WebGL context loss, WebAssembly memory errors from
  `@xterm/addon-image`, or renderer long-task warnings.
- Confirm whether corruption appears only after workspace switches, only after
  returning from background, or immediately after opening many terminals.
- Compare a run with WebGL enabled against a local patch that skips WebGL
  loading. If DOM rendering is clean, the fix should stay in the addon/rendering
  path, not the terminal transport path.
- Keep the desktop logs open during reproduction. Renderer crashes without a
  JS error often still leave GPU, WebContents, or process-exit evidence there.

## Stress Commands

Use the general stress guide in
`apps/desktop/docs/RENDERER_STRESS_QA.md` for fixture setup and full runs.

For targeted terminal rendering stress:

```bash
SUPERSET_RENDERER_STRESS_CDP_PORT=9333 bun --cwd apps/desktop dev
```

Then, in another shell:

```bash
bun --cwd apps/desktop stress:renderer -- \
  --port 9333 \
  --scenario terminal-heavy \
  --workspace-ids <workspace-id-1>,<workspace-id-2> \
  --terminal-iterations 200 \
  --terminal-tab-count 32 \
  --terminal-panes-per-tab 4 \
  --terminal-lines 80 \
  --terminal-payload-bytes 4096 \
  --interval-ms 0 \
  --settle-ms 1500 \
  --timeout-ms 300000 \
  --max-heartbeat-delay-ms 10000 \
  --max-long-task-ms 10000 \
  --progress-every 10
```

For the atlas/glyph corruption family, use `--terminal-output-mode
atlas-rewrite` plus `--terminal-corruption-check`. This recreates the upstream
xterm issue pattern by repeatedly rewriting the same rows with true-color SGR
attributes, then captures a deterministic sentinel frame before and after
`clearTextureAtlas()`:

```bash
bun --cwd apps/desktop stress:renderer -- \
  --port 9333 \
  --scenario terminal-heavy \
  --terminal-iterations 1500 \
  --terminal-tab-count 1 \
  --terminal-panes-per-tab 1 \
  --terminal-lines 3 \
  --terminal-payload-bytes 0 \
  --terminal-output-mode atlas-rewrite \
  --terminal-corruption-check \
  --interval-ms 0 \
  --settle-ms 500 \
  --timeout-ms 600000 \
  --max-heartbeat-delay-ms 10000 \
  --max-long-task-ms 10000 \
  --progress-every 250 \
  --json
```

The command writes before/after PNGs under
`apps/desktop/.tmp/renderer-terminal-corruption/` by default. In the JSON
result, inspect `terminalVisualCorruptionCheck.diff`. A non-zero diff above the
reported threshold means the visible pixels depended on stale atlas contents.
Also inspect `terminalStressSummary.terminalRuntimes[].renderer`: multiple atlas
pages, large `4096` pages, or `pendingAtlasClear: true` means the run reached
the upstream texture-atlas pressure path.

`--terminal-output-mode cjk-sgr` is still useful as a broader atlas churn mode,
but it is harder to turn into a deterministic pixel detector than the
atlas-rewrite plus sentinel check.

For a narrow A/B test, run that command once normally and once with WebGL
loading locally disabled. A clean DOM run points at WebGL context/atlas
handling. A corrupt DOM run points at font metrics, ligatures, buffer restore,
or xterm sizing instead.
