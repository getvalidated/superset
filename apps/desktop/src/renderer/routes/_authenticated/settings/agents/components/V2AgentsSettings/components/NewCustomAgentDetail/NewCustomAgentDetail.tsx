import type { PromptTransport } from "@superset/shared/agent-prompt-launch";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { useState } from "react";
import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import { parseAgentCommandText } from "renderer/lib/agent-launch-command";
import { parseArgs } from "renderer/lib/argv";
import {
	PromptTransportToggle,
	Section,
	StackedField,
} from "../AgentFormControls";
import { AgentIcon } from "../AgentIcon";
import { AgentIconPicker } from "../AgentIconPicker";

export interface CreateCustomAgentInput {
	label: string;
	command: string;
	args: string[];
	promptTransport: PromptTransport;
	promptArgs: string[];
	env: Record<string, string>;
	presetId: string;
	iconId?: string;
}

interface NewCustomAgentDetailProps {
	onCreate: (input: CreateCustomAgentInput) => void;
	onCancel: () => void;
	/** True while the create request is in flight. */
	isSubmitting: boolean;
}

export function NewCustomAgentDetail({
	onCreate,
	onCancel,
	isSubmitting,
}: NewCustomAgentDetailProps) {
	const isDark = useIsDarkTheme();
	const [label, setLabel] = useState("");
	const [iconId, setIconId] = useState<string | null>(null);
	const [commandText, setCommandText] = useState("");
	const [promptArgsText, setPromptArgsText] = useState("");
	const [promptTransport, setPromptTransport] =
		useState<PromptTransport>("argv");

	const trimmedLabel = label.trim();
	const parsedCommand = parseAgentCommandText(commandText);
	const canCreate =
		trimmedLabel.length > 0 &&
		parsedCommand.command.length > 0 &&
		!isSubmitting;

	const handleCreate = () => {
		if (!canCreate) return;
		onCreate({
			label: trimmedLabel,
			command: parsedCommand.command,
			args: parsedCommand.args,
			promptTransport,
			promptArgs: parseArgs(promptArgsText),
			env: parsedCommand.env,
			presetId: "custom",
			iconId: iconId ?? undefined,
		});
	};

	return (
		<div className="p-6 max-w-3xl w-full mx-auto">
			<div className="mb-8 flex items-center gap-3">
				<AgentIcon
					iconId={iconId}
					presetId="custom"
					isDark={isDark}
					className="size-8"
				/>
				<div className="min-w-0 flex-1">
					<h2 className="text-xl font-semibold truncate">
						{trimmedLabel || "New agent"}
					</h2>
					<p className="text-sm text-muted-foreground mt-0.5 truncate">
						Add your own terminal agent to this device.
					</p>
				</div>
			</div>

			<form
				className="space-y-6"
				onSubmit={(e) => {
					e.preventDefault();
					handleCreate();
				}}
			>
				<Section title="Identity">
					<StackedField label="Label" htmlFor="new-agent-label">
						<Input
							id="new-agent-label"
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="My Agent"
							autoFocus
						/>
					</StackedField>

					<StackedField label="Icon" hint="Shown in launchers and this list.">
						<AgentIconPicker value={iconId} onChange={setIconId} />
					</StackedField>
				</Section>

				<Section title="Launch">
					<StackedField
						label="Command"
						hint="Argv used to launch the agent."
						htmlFor="new-agent-command"
					>
						<Input
							id="new-agent-command"
							className="font-mono text-xs"
							value={commandText}
							onChange={(e) => setCommandText(e.target.value)}
							placeholder="claude --dangerously-skip-permissions"
						/>
					</StackedField>

					<StackedField
						label="Prompt-only args"
						hint={
							<>
								Added only when launching with a prompt — e.g. <code>--</code>,{" "}
								<code>--prompt</code>, <code>-i</code>.
							</>
						}
						htmlFor="new-agent-prompt-args"
					>
						<Input
							id="new-agent-prompt-args"
							className="font-mono text-xs"
							value={promptArgsText}
							onChange={(e) => setPromptArgsText(e.target.value)}
							placeholder="--prompt"
						/>
					</StackedField>

					<StackedField
						label="Prompt transport"
						hint="How the prompt is delivered to the process."
					>
						<PromptTransportToggle
							value={promptTransport}
							onChange={setPromptTransport}
						/>
					</StackedField>
				</Section>

				<div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
					<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
						Cancel
					</Button>
					<Button type="submit" size="sm" disabled={!canCreate}>
						Add agent
					</Button>
				</div>
			</form>
		</div>
	);
}
