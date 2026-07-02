import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { Check, ChevronDown } from "lucide-react";
import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import { AgentIcon } from "../AgentIcon";
import { AGENT_ICON_OPTIONS } from "../AgentIcon/agent-icon-options";

interface AgentIconPickerProps {
	/** Currently selected icon key, or null for the neutral fallback glyph. */
	value: string | null;
	onChange: (iconId: string | null) => void;
	disabled?: boolean;
}

export function AgentIconPicker({
	value,
	onChange,
	disabled,
}: AgentIconPickerProps) {
	const isDark = useIsDarkTheme();
	const selected = AGENT_ICON_OPTIONS.find((option) => option.id === value);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					className={cn(
						"inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm",
						"bg-transparent hover:bg-accent/50 transition-colors disabled:opacity-50",
					)}
				>
					<AgentIcon
						iconId={value}
						presetId="custom"
						isDark={isDark}
						className="size-5"
					/>
					<span className="flex-1 text-left">
						{selected ? selected.label : "No icon"}
					</span>
					<ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-48">
				<DropdownMenuItem className="gap-2" onSelect={() => onChange(null)}>
					<AgentIcon
						iconId={null}
						presetId="custom"
						isDark={isDark}
						className="size-4"
					/>
					<span className="flex-1">No icon</span>
					{value === null ? <Check className="size-3.5 shrink-0" /> : null}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{AGENT_ICON_OPTIONS.map((option) => (
					<DropdownMenuItem
						key={option.id}
						className="gap-2"
						onSelect={() => onChange(option.id)}
					>
						<AgentIcon
							iconId={option.id}
							presetId="custom"
							isDark={isDark}
							className="size-4"
						/>
						<span className="flex-1">{option.label}</span>
						{value === option.id ? (
							<Check className="size-3.5 shrink-0" />
						) : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
