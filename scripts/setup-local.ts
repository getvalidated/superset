#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const root = resolve(import.meta.dirname, "..");
const LOCAL_DATABASE_HOSTS = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"[::1]",
]);

const help = `Usage: bun setup:local [options]

Prepares a fresh-clone local contributor setup without cloud credentials.

Options:
  --skip-docker       Do not start Docker Postgres/Electric
  --skip-migrate      Do not run database migrations
  --skip-caddy-trust  Do not run caddy trust
  -h, --help          Show this help
`;

function log(message: string): void {
	console.log(`[setup:local] ${message}`);
}

function fail(message: string): never {
	console.error(`[setup:local] ${message}`);
	process.exit(1);
}

function run(command: string, commandArgs: string[]): void {
	log(`$ ${[command, ...commandArgs].join(" ")}`);
	const result = spawnSync(command, commandArgs, {
		cwd: root,
		stdio: "inherit",
		env: process.env,
	});
	if (result.status !== 0) {
		fail(`${command} ${commandArgs.join(" ")} failed`);
	}
}

function commandExists(command: string): boolean {
	const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
		cwd: root,
		stdio: "ignore",
	});
	return result.status === 0;
}

function requireCommand(command: string, installHint: string): void {
	if (!commandExists(command)) {
		fail(`${command} is required. ${installHint}`);
	}
}

function copyIfMissing(source: string, destination: string): void {
	const sourcePath = resolve(root, source);
	const destinationPath = resolve(root, destination);
	if (existsSync(destinationPath)) {
		log(`keeping existing ${destination}`);
		return;
	}
	copyFileSync(sourcePath, destinationPath);
	log(`created ${destination} from ${basename(source)}`);
}

function readEnvValue(name: string): string | undefined {
	const envPath = resolve(root, ".env");
	if (!existsSync(envPath)) return undefined;
	const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const [key, ...valueParts] = trimmed.split("=");
		if (key === name) {
			return valueParts.join("=").replace(/^["']|["']$/g, "");
		}
	}
	return undefined;
}

function isLocalDatabaseUrl(value: string | undefined): boolean {
	if (!value) return false;
	try {
		const url = new URL(value);
		return LOCAL_DATABASE_HOSTS.has(url.hostname);
	} catch {
		return false;
	}
}

if (args.has("-h") || args.has("--help")) {
	console.log(help);
	process.exit(0);
}

if (process.platform !== "darwin") {
	fail("local desktop development is currently documented for macOS only.");
}

requireCommand("bun", "Install Bun from https://bun.sh.");
if (!args.has("--skip-docker")) {
	requireCommand("docker", "Install Docker Desktop for macOS.");
}
if (!args.has("--skip-caddy-trust")) {
	requireCommand("caddy", "Install Caddy with: brew install caddy");
}

copyIfMissing(".env.example", ".env");
const profile = readEnvValue("SUPERSET_PROFILE");
const workspaceName = readEnvValue("SUPERSET_WORKSPACE_NAME");
if (profile !== "local" || workspaceName !== "local-dev") {
	fail(
		[
			"existing .env is not the default contributor profile, so setup stopped before running migrations",
			"expected: SUPERSET_PROFILE=local",
			"expected: SUPERSET_WORKSPACE_NAME=local-dev",
			"move your existing .env aside or update it intentionally, then rerun bun setup:local",
		].join("\n"),
	);
}

if (!isLocalDatabaseUrl(readEnvValue("DATABASE_URL"))) {
	fail("DATABASE_URL must point at localhost for bun setup:local.");
}

if (!isLocalDatabaseUrl(readEnvValue("DATABASE_URL_UNPOOLED"))) {
	fail("DATABASE_URL_UNPOOLED must point at localhost for bun setup:local.");
}

copyIfMissing(
	"apps/electric-proxy/.dev.vars.example",
	"apps/electric-proxy/.dev.vars",
);
copyIfMissing("Caddyfile.example", "Caddyfile");

if (!args.has("--skip-docker")) {
	run("docker", ["compose", "-f", "docker-compose.dev.yml", "up", "-d"]);
}

if (!args.has("--skip-caddy-trust")) {
	run("caddy", ["trust"]);
}

if (!args.has("--skip-migrate")) {
	run("bun", ["run", "db:migrate"]);
}

console.log(`
Local setup is ready.

Next:
  bun dev

Useful checks after boot:
  curl -fsS http://localhost:4641/api/health
  curl -fsS http://localhost:4641/api/auth/ok

Desktop state for this setup lives in:
  ~/.superset-local-dev
`);
