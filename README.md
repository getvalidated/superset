<div align="center">

<img width="100%" alt="Superset" src="apps/marketing/public/images/readme-hero.png" />

### Run 100+ coding agents in parallel.

A macOS app that gives every agent its own git worktree, terminal, and review surface — and notifies you when one needs your input.

[![GitHub stars](https://img.shields.io/github/stars/superset-sh/superset?style=flat&logo=github)](https://github.com/superset-sh/superset/stargazers)
[![GitHub release](https://img.shields.io/github/v/release/superset-sh/superset?style=flat&logo=github)](https://github.com/superset-sh/superset/releases)
[![License](https://img.shields.io/badge/license-ELv2-blue)](LICENSE.md)
[![Twitter](https://img.shields.io/badge/@superset__sh-555?logo=x)](https://x.com/superset_sh)
[![Discord](https://img.shields.io/badge/Discord-555?logo=discord)](https://discord.gg/cZeD9WYcV7)

<br />

[**Download for macOS**](https://github.com/superset-sh/superset/releases/latest) &nbsp;&bull;&nbsp; [▶ Watch the demo](https://www.youtube.com/watch?v=mk02bSQmEKY) &nbsp;&bull;&nbsp; [Website](https://superset.sh) &nbsp;&bull;&nbsp; [Docs](https://docs.superset.sh) &nbsp;&bull;&nbsp; [Discord](https://discord.gg/cZeD9WYcV7)

</div>

## What it is

Superset is a macOS app for running many CLI coding agents in parallel. Each agent gets its own git worktree, terminal, and diff view, so agents work on different branches at the same time without trampling each other or your main checkout. When an agent stops to ask a question or finishes a task, Superset tells you — so you direct the work instead of babysitting it.

It's built for developers who already run agents like Claude Code, Codex, and Cursor Agent from the terminal and want to drive several at once. It works with any agent that runs in a terminal.

## Why Superset

Most tools in this space are built around one or two specific agents — usually Claude Code and Codex. Superset is deliberately agent-agnostic: if it talks to stdin/stdout, Superset can run it, and you can mix agents across workspaces. Everything runs as a local process on your machine — your code and git history never leave it (see [What runs locally](#what-runs-locally)). You bring your own agent subscriptions and API keys; Superset doesn't proxy or resell them.

## Features

#### Parallel agents in isolated git worktrees

Superset runs each task in its own git worktree off the same repository. Workspaces share the underlying object store but have independent working directories and branches, so agents can edit files, install dependencies, and run tests without touching each other or your main checkout.

Spin up ten workspaces from a single project and have ten agents working on ten branches at once. When a workspace is done, its branch goes through the same review and merge flow you already use.

#### Works with any CLI agent

Superset works with any agent that runs in a terminal. Claude Code, Codex, Cursor Agent, Gemini, Copilot CLI, OpenCode, Amp, and Pi all work without per-agent configuration. No lock-in to a single vendor — pick a different agent per workspace if you want.

#### Notifications when agents need you

Long-running agents alternate between heads-down work and questions for you. Superset watches every workspace and pings you the moment an agent stops to ask something or finishes a task. The notification list lives in the sidebar, so you can scan the state of every workspace at a glance and jump straight to whichever one needs you.

#### Built-in diff review and inline editing

Every workspace ships with a diff view that shows uncommitted changes, staged changes, and the agent's most recent turn. You can edit files in place, stage hunks, and commit without leaving the app.

When you want a full IDE, one click hands the workspace off to VS Code, Cursor, Zed, or your terminal — the worktree path is the same path your editor opens.

#### Reproducible workspace setup

A `.superset/config.json` at your repo root defines what happens when a workspace is created or destroyed — copy `.env`, install dependencies, run migrations, tear down branches, and anything else you'd normally do by hand. New workspaces come up identical to your main checkout in seconds. See the [setup/teardown docs](https://docs.superset.sh/setup-teardown-scripts).

## Supported Agents

| Agent | Status |
|:------|:-------|
| [Amp Code](https://ampcode.com/) | Fully supported |
| [Claude Code](https://github.com/anthropics/claude-code) | Fully supported |
| [OpenAI Codex CLI](https://github.com/openai/codex) | Fully supported |
| [Cursor Agent](https://docs.cursor.com/agent) | Fully supported |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Fully supported |
| [GitHub Copilot](https://github.com/features/copilot) | Fully supported |
| [OpenCode](https://github.com/opencode-ai/opencode) | Fully supported |
| [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) | Fully supported |
| Any other CLI agent | Works without configuration |

If it runs in a terminal, it runs on Superset.

## What runs locally

Superset runs on your machine. Your code, git worktrees, and agent processes never leave it.

- **Local** — every git worktree, file edit, diff, and agent process (Claude Code, Codex, and the rest) runs as a local process on your Mac. Your source code is never uploaded.
- **Account** — Superset requires a free account (GitHub or Google sign-in). The hosted backend stores your account and workspace metadata — names, branches, and status — so the app can sync state across sessions.
- **Bring your own agents** — Superset doesn't proxy your agents. They use whatever subscriptions or API keys you've already configured.

## Getting Started

**[Download Superset for macOS](https://github.com/superset-sh/superset/releases/latest)**, then sign in with GitHub or Google.

### Requirements

| Requirement | Details |
|:------------|:--------|
| **OS** | macOS (Windows and Linux are not supported) |
| **Git** | 2.20+ — Superset manages real git worktrees |
| **Account** | A free Superset account (GitHub or Google sign-in) |
| **GitHub CLI** | [gh](https://cli.github.com/) — optional, for PR workflows |

<details>
<summary>Build from source</summary>

Building from source additionally requires [Bun](https://bun.sh/) v1.0+ and [Caddy](https://caddyserver.com/docs/install).

**1. Clone the repository**

```bash
git clone https://github.com/superset-sh/superset.git
cd superset
```

**2. Set up environment variables** (choose one):

Option A: Full setup
```bash
cp .env.example .env
# Edit .env and fill in the values
```

Option B: Skip env validation (for quick local testing)
```bash
cp .env.example .env
echo 'SKIP_ENV_VALIDATION=1' >> .env
```

**3. Set up Caddy** (reverse proxy for Electric SQL streams):

```bash
# Install caddy: brew install caddy (macOS) or see https://caddyserver.com/docs/install
cp Caddyfile.example Caddyfile

# Without this, Chromium rejects https://localhost:* with ERR_CERT_AUTHORITY_INVALID.
# Prompts for sudo once.
caddy trust
```

**4. Install dependencies and run**

```bash
bun install
bun run dev
```

**5. Build the desktop app**

```bash
bun run build
open apps/desktop/release
```

</details>

## Configuration

Configure workspace setup, teardown, and presets in `.superset/config.json`. See the [configuration docs](https://docs.superset.sh/setup-teardown-scripts).

Keyboard shortcuts are customizable via **Settings > Keyboard Shortcuts** (`⌘/`). See the [full shortcut reference](https://docs.superset.sh/keyboard-shortcuts).

## Tech Stack

<p>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-191970?logo=Electron&logoColor=white" alt="Electron" /></a>
  <a href="https://reactjs.org/"><img src="https://img.shields.io/badge/React-%2320232a.svg?logo=react&logoColor=%2361DAFB" alt="React" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwindcss-%2338B2AC.svg?logo=tailwind-css&logoColor=white" alt="TailwindCSS" /></a>
  <a href="https://bun.sh/"><img src="https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white" alt="Bun" /></a>
  <a href="https://turbo.build/"><img src="https://img.shields.io/badge/Turborepo-EF4444?logo=turborepo&logoColor=white" alt="Turborepo" /></a>
  <a href="https://vitejs.dev/"><img src="https://img.shields.io/badge/Vite-%23646CFF.svg?logo=vite&logoColor=white" alt="Vite" /></a>
  <a href="https://biomejs.dev/"><img src="https://img.shields.io/badge/Biome-339AF0?logo=biome&logoColor=white" alt="Biome" /></a>
  <a href="https://orm.drizzle.team/"><img src="https://img.shields.io/badge/Drizzle%20ORM-FFE873?logo=drizzle&logoColor=black" alt="Drizzle ORM" /></a>
  <a href="https://neon.tech/"><img src="https://img.shields.io/badge/Neon-00E9CA?logo=neon&logoColor=white" alt="Neon" /></a>
  <a href="https://trpc.io/"><img src="https://img.shields.io/badge/tRPC-2596BE?logo=trpc&logoColor=white" alt="tRPC" /></a>
</p>

Superset is a desktop app built on Electron.

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and the PR workflow. For bugs or feature requests, [open an issue](https://github.com/superset-sh/superset/issues).

<a href="https://github.com/superset-sh/superset/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=superset-sh/superset" />
</a>

## Community

- **[Discord](https://discord.gg/cZeD9WYcV7)** — Chat with the team and community
- **[Twitter](https://x.com/superset_sh)** — Follow for updates and announcements
- **[GitHub Issues](https://github.com/superset-sh/superset/issues)** — Report bugs and request features
- **[GitHub Discussions](https://github.com/superset-sh/superset/discussions)** — Ask questions and share ideas

### Team

[![Avi Twitter](https://img.shields.io/badge/Avi-@avimakesrobots-555?logo=x)](https://x.com/avimakesrobots)
[![Kiet Twitter](https://img.shields.io/badge/Kiet-@flyakiet-555?logo=x)](https://x.com/flyakiet)
[![Satya Twitter](https://img.shields.io/badge/Satya-@saddle__paddle-555?logo=x)](https://x.com/saddle_paddle)

## License

Superset is **source-available** under the Elastic License 2.0 (ELv2). You can read, modify, build, and self-host it for free. ELv2 is not an OSI-approved open-source license — the one real restriction is that you can't offer Superset as a hosted service to third parties. See [LICENSE.md](LICENSE.md) for full terms.
