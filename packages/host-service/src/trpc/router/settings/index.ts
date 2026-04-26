import { router } from "../../index";
import { agentConfigsRouter } from "./agent-configs";

export const settingsRouter = router({
	agentConfigs: agentConfigsRouter,
});
