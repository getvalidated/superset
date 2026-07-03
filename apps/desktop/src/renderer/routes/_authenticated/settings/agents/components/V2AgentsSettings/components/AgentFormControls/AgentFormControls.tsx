import type { PromptTransport } from "@superset/shared/agent-prompt-launch";
import { Label } from "@superset/ui/label";
import { cn } from "@superset/ui/utils";

/**
 * Shared layout primitives for the agent settings forms, used by both the
 * edit pane (`AgentDetail`) and the create pane (`NewCustomAgentDetail`) so
 * spacing and control semantics stay in sync.
 */

export function Section({
	title,
	children,
}: {
	title: string;
	children?: React.ReactNode;
}) {
	return (
		<section className="space-y-3">
			<h3 className="text-sm font-medium">{title}</h3>
			{children ? <div className="space-y-5">{children}</div> : null}
		</section>
	);
}

interface StackedFieldProps {
	label: string;
	hint?: React.ReactNode;
	htmlFor?: string;
	children: React.ReactNode;
}

export function StackedField({
	label,
	hint,
	htmlFor,
	children,
}: StackedFieldProps) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={htmlFor} className="text-sm font-medium">
				{label}
			</Label>
			{hint && <p className="text-xs text-muted-foreground -mt-1">{hint}</p>}
			{children}
		</div>
	);
}

interface PromptTransportToggleProps {
	value: PromptTransport;
	onChange: (next: PromptTransport) => void;
}

const TRANSPORT_OPTIONS: readonly PromptTransport[] = ["argv", "stdin"];

export function PromptTransportToggle({
	value,
	onChange,
}: PromptTransportToggleProps) {
	return (
		<div className="inline-flex rounded-md border border-border overflow-hidden">
			{TRANSPORT_OPTIONS.map((option, index) => {
				const isSelected = value === option;
				return (
					<button
						key={option}
						type="button"
						aria-pressed={isSelected}
						aria-label={`Prompt transport: ${option}`}
						onClick={() => onChange(option)}
						className={cn(
							"px-3 py-1 text-xs font-medium transition-colors",
							index > 0 && "border-l border-border",
							isSelected
								? "bg-accent text-accent-foreground"
								: "bg-transparent text-muted-foreground hover:bg-accent/50",
						)}
					>
						{option}
					</button>
				);
			})}
		</div>
	);
}
