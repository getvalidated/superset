import { cn } from "@superset/ui/utils";
import { workspaceTrpc } from "@superset/workspace-client";
import { useEffect, useRef, useState } from "react";
import type { CanvasSubagentData } from "./useCanvasSeeding";

type TranscriptItem =
	| { kind: "user"; text: string }
	| { kind: "text"; text: string }
	| { kind: "tool_use"; name: string; detail: string };

const POLL_MS = 2_000;
const ACTIVE_WITHIN_MS = 60_000;
/** Bound renderer memory on very chatty subagents; old items scroll away. */
const MAX_ITEMS = 2_000;

function lastActivityLabel(mtimeMs: number | null, now: number): string {
	if (!mtimeMs) return "connecting…";
	const seconds = Math.max(0, Math.round((now - mtimeMs) / 1000));
	if (seconds < 5) return "active now";
	if (seconds < 60) return `active ${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `last activity ${minutes}m ago`;
	return `last activity ${Math.round(minutes / 60)}h ago`;
}

/**
 * Read-only live view of one subagent's transcript, tailed incrementally
 * from the host by byte offset. Subagents have no PTY — this pane is the
 * canvas's window into an in-process agent the parent session spawned.
 */
export function SubagentPane({ data }: { data: CanvasSubagentData }) {
	const utils = workspaceTrpc.useUtils();
	const [items, setItems] = useState<TranscriptItem[]>([]);
	const [mtimeMs, setMtimeMs] = useState<number | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const offsetRef = useRef(0);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const pinnedToBottomRef = useRef(true);

	const { agentSessionId, subagentId } = data;

	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		offsetRef.current = 0;
		setItems([]);

		const tick = async () => {
			try {
				const slice = await utils.client.subagents.readTranscript.query({
					agentSessionId,
					subagentId,
					offsetBytes: offsetRef.current,
				});
				if (cancelled) return;
				offsetRef.current = slice.nextOffsetBytes;
				setMtimeMs(slice.mtimeMs);
				if (slice.items.length > 0) {
					setItems((prev) =>
						[...prev, ...(slice.items as TranscriptItem[])].slice(-MAX_ITEMS),
					);
				}
			} catch {
				// Transcript gone (parent exited) or host briefly unreachable —
				// keep whatever is rendered and retry on the next tick.
			}
			if (!cancelled) timer = setTimeout(tick, POLL_MS);
		};
		void tick();
		return () => {
			cancelled = true;
			if (timer !== undefined) clearTimeout(timer);
		};
	}, [utils, agentSessionId, subagentId]);

	// The activity label counts up between polls.
	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), 5_000);
		return () => clearInterval(interval);
	}, []);

	// Follow new output unless the user scrolled up to read history.
	// biome-ignore lint/correctness/useExhaustiveDependencies: items is the re-run trigger, not an effect input
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !pinnedToBottomRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, [items]);

	const isActive = mtimeMs !== null && now - mtimeMs < ACTIVE_WITHIN_MS;

	return (
		<div className="flex h-full w-full flex-col bg-background">
			<div className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-2 py-1">
				<span
					className={cn(
						"size-1.5 shrink-0 rounded-full",
						isActive
							? "animate-pulse bg-emerald-500"
							: "bg-muted-foreground/40",
					)}
				/>
				<span className="text-[10px] text-muted-foreground">
					{lastActivityLabel(mtimeMs, now)}
				</span>
			</div>
			<div
				ref={scrollRef}
				onScroll={(event) => {
					const el = event.currentTarget;
					pinnedToBottomRef.current =
						el.scrollHeight - el.scrollTop - el.clientHeight < 40;
				}}
				className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
			>
				{items.length === 0 ? (
					<p className="text-xs text-muted-foreground">
						Waiting for transcript…
					</p>
				) : (
					<div className="flex flex-col gap-2">
						{items.map((item, index) => {
							const key = `${index}-${item.kind}`;
							if (item.kind === "user") {
								return (
									<div
										key={key}
										className="rounded border border-border/50 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground whitespace-pre-wrap break-words"
									>
										{item.text}
									</div>
								);
							}
							if (item.kind === "tool_use") {
								return (
									<div
										key={key}
										className="flex min-w-0 items-baseline gap-1.5 text-xs"
									>
										<span className="shrink-0 text-muted-foreground/60">⏺</span>
										<span className="shrink-0 font-medium text-foreground">
											{item.name}
										</span>
										<span className="min-w-0 truncate text-muted-foreground">
											{item.detail}
										</span>
									</div>
								);
							}
							return (
								<p
									key={key}
									className="text-xs text-foreground whitespace-pre-wrap break-words"
								>
									{item.text}
								</p>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
