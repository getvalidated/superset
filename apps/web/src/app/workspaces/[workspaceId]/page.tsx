"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { trpcClient } from "../../../trpc/client";
import { WebTerminal } from "./components/WebTerminal";

interface HostTerminal {
	terminalId: string;
	title: string | null;
	exited: boolean;
}

export default function WorkspaceTerminalPage({
	params,
}: {
	params: Promise<{ workspaceId: string }>;
}) {
	const { workspaceId } = use(params);
	const [terminals, setTerminals] = useState<HostTerminal[] | null>(null);
	const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(
		null,
	);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [viewportHeight, setViewportHeight] = useState<number | null>(null);

	const loadTerminals = useCallback(async () => {
		try {
			const result = await trpcClient.workspaceTerminal.list.query({
				workspaceId,
			});
			setLoadError(null);
			setTerminals(
				result.map((terminal) => ({
					terminalId: terminal.terminalId,
					title: terminal.title,
					exited: terminal.exited,
				})),
			);
		} catch (caught) {
			setLoadError(caught instanceof Error ? caught.message : String(caught));
			setTerminals([]);
		}
	}, [workspaceId]);

	useEffect(() => {
		void loadTerminals();
	}, [loadTerminals]);

	useEffect(() => {
		if (selectedTerminalId || !terminals) return;
		const first =
			terminals.find((terminal) => !terminal.exited) ?? terminals[0];
		if (first) setSelectedTerminalId(first.terminalId);
	}, [terminals, selectedTerminalId]);

	useEffect(() => {
		const visualViewport = window.visualViewport;
		if (!visualViewport) return;
		const update = () => setViewportHeight(visualViewport.height);
		update();
		visualViewport.addEventListener("resize", update);
		visualViewport.addEventListener("scroll", update);
		return () => {
			visualViewport.removeEventListener("resize", update);
			visualViewport.removeEventListener("scroll", update);
		};
	}, []);

	const createTerminal = useCallback(async () => {
		setCreating(true);
		try {
			const created = await trpcClient.workspaceTerminal.create.mutate({
				workspaceId,
			});
			await loadTerminals();
			setSelectedTerminalId(created.terminalId);
		} catch (caught) {
			setLoadError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setCreating(false);
		}
	}, [workspaceId, loadTerminals]);

	return (
		<div
			className="flex flex-col overflow-hidden bg-[#151110] text-[#eae8e6]"
			style={{ height: viewportHeight ? `${viewportHeight}px` : "100dvh" }}
		>
			<header
				className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm"
				style={{ borderColor: "#2a2827", backgroundColor: "#1a1716" }}
			>
				<Link
					href="/workspaces"
					className="text-[#a8a5a3] hover:text-[#eae8e6]"
				>
					← Workspaces
				</Link>
				<select
					value={selectedTerminalId ?? ""}
					onChange={(event) =>
						setSelectedTerminalId(event.target.value || null)
					}
					className="rounded border bg-transparent px-2 py-1 text-xs"
					style={{ borderColor: "#2a2827" }}
				>
					{terminals && terminals.length > 0 ? (
						terminals.map((terminal) => (
							<option key={terminal.terminalId} value={terminal.terminalId}>
								{(terminal.title?.trim() || terminal.terminalId.slice(0, 8)) +
									(terminal.exited ? " (exited)" : "")}
							</option>
						))
					) : (
						<option value="">No terminals</option>
					)}
				</select>
				<button
					type="button"
					onClick={() => void createTerminal()}
					disabled={creating}
					className="rounded border px-2 py-1 text-xs disabled:opacity-50"
					style={{ borderColor: "#2a2827" }}
				>
					{creating ? "Starting…" : "+ New terminal"}
				</button>
			</header>
			{loadError && (
				<div
					className="border-b px-3 py-1 text-xs"
					style={{
						borderColor: "rgba(220, 107, 107, 0.35)",
						backgroundColor: "rgba(220, 107, 107, 0.12)",
						color: "#e88888",
					}}
				>
					{loadError}
				</div>
			)}
			<div className="relative flex-1 overflow-hidden">
				{selectedTerminalId ? (
					<WebTerminal
						key={selectedTerminalId}
						workspaceId={workspaceId}
						terminalId={selectedTerminalId}
					/>
				) : (
					<div className="flex h-full items-center justify-center text-sm text-[#a8a5a3]">
						{terminals === null
							? "Loading terminals…"
							: "No terminal sessions. Create one to get started."}
					</div>
				)}
			</div>
		</div>
	);
}
