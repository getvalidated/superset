CREATE TABLE `host_agent_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`preset_id` text NOT NULL,
	`label` text NOT NULL,
	`launch_command` text NOT NULL,
	`prompt_input` text NOT NULL,
	`order` integer NOT NULL,
	`user_modified` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `host_agent_configs_order_idx` ON `host_agent_configs` (`order`);--> statement-breakpoint
INSERT INTO `host_agent_configs` (`id`, `preset_id`, `label`, `launch_command`, `prompt_input`, `order`, `user_modified`, `created_at`) VALUES
	('seed-claude', 'claude', 'Claude', 'claude --permission-mode acceptEdits', 'argv', 0, 0, (unixepoch() * 1000)),
	('seed-amp', 'amp', 'Amp', 'amp', 'stdin', 1, 0, (unixepoch() * 1000)),
	('seed-codex', 'codex', 'Codex', 'codex -c model_reasoning_effort="high" -c model_reasoning_summary="detailed" -c model_supports_reasoning_summaries=true --full-auto --', 'argv', 2, 0, (unixepoch() * 1000)),
	('seed-gemini', 'gemini', 'Gemini', 'gemini --approval-mode=auto_edit', 'argv', 3, 0, (unixepoch() * 1000)),
	('seed-copilot', 'copilot', 'Copilot', 'copilot -i --allow-tool=write', 'argv', 4, 0, (unixepoch() * 1000));