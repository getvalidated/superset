# @superset/pty-daemon

Long-lived PTY-owning process for the v2 desktop terminal. host-service is a
client over a Unix socket; routine host-service upgrades don't touch shells.

Implements [Phase 1 of the daemon plan](../../apps/desktop/plans/20260429-pty-daemon-implementation.md).
This package is **standalone**: it does not import from `@superset/host-service`
or any other workspace package. Host-service consumes only the protocol types
via `@superset/pty-daemon/protocol`.

## Runtime

**Node ≥ 20**, not Bun. node-pty's master fd handling is incompatible with
Bun's `tty.ReadStream` (verified: Bun 1.3, node-pty 1.1 — onData/onExit
silently never fire). The daemon ships as a Node script in the desktop app
bundle; host-service can stay on Bun.

## Layout

```
src/
├── main.ts                     # Node entrypoint: argv → Server.listen()
├── index.ts                    # Public exports for host-service consumers
├── protocol/                   # Wire schemas + length-prefixed framing
│   ├── version.ts              # CURRENT_PROTOCOL_VERSION + supported list
│   ├── messages.ts             # ClientMessage / ServerMessage unions
│   ├── framing.ts              # encodeFrame / FrameDecoder (4-byte BE prefix)
│   └── index.ts
├── Pty/                        # node-pty thin wrapper with dim validation
│   ├── Pty.ts
│   └── index.ts
├── SessionStore/               # in-memory map + 64KB ring buffer per session
│   ├── SessionStore.ts
│   └── index.ts
├── handlers/                   # pure functions: open/input/resize/close/list/subscribe
│   ├── handlers.ts
│   └── index.ts
└── Server/                     # AF_UNIX SOCK_STREAM accept loop, handshake, dispatch
    ├── Server.ts
    └── index.ts

test/
└── integration.test.ts         # node --test: real shells, real socket
```

## Design notes

- **Stateless from the client's perspective.** Every protocol call carries
  full context. No client tracking, no session tombstones, no business
  rules. Single design principle from
  [the implementation plan](../../apps/desktop/plans/20260429-pty-daemon-implementation.md#the-single-design-principle).
- **Auth boundary = Unix socket file mode 0600.** No in-band tokens. The
  daemon trusts whoever can open the socket.
- **Buffer is in-memory only.** Survives host-service restarts (because the
  daemon does), but never persisted to disk. No SQLite, no scrollback files.
  v1's `HistoryManager` is explicitly out of scope.
- **Protocol versioned from day one.** Handshake (`hello` / `hello-ack`)
  picks the highest mutually supported version.

## Testing

```sh
bun test                     # unit tests (protocol, handlers, SessionStore, Pty validation)
bun run test:integration     # end-to-end via node --test (spawns real shells)
```

Why two runners? `bun test` is fast for pure-JS work. node-pty doesn't work
under Bun, so anything that spawns a real PTY runs under Node.

## Running locally

```sh
bun run start --socket=/tmp/pty-daemon.sock
```

Logs go to stderr; stdout stays empty (so the daemon can later be supervised
by host-service with stdout reserved for protocol or kept dark).

## Out of scope (Phase 1)

- Host-service integration (DaemonClient, terminal.ts refactor, manifest
  adoption) — separate PR.
- Daemon-upgrade handoff via `child_process.spawn` `stdio` fd inheritance
  — separate PR (Phase 2 of the plan).
- Windows ConPTY — not in v1 protocol; defer until Windows users justify it.
