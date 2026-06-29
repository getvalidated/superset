/**
 * Renderer component test for IntegrationsSettings.
 *
 * The shared test-setup installs a *fake* document/window (not a real DOM).
 * happy-dom is registered in beforeAll (NOT at module load) and unregistered in
 * afterAll, so the rest of the (non-DOM) desktop suite — whose other test files
 * evaluate their module bodies before any beforeAll runs — keeps the fake DOM
 * and is unaffected. Queries come from render()'s return (container-scoped), not
 * the global `screen` (which binds to document at import, before beforeAll).
 *
 * Locks in the loading behavior: an integration row must show a loading state
 * (not "Not connected") while the connections query is still pending — the
 * regression that swapping the cache-first synced collection for `useQuery`
 * would otherwise reintroduce.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

// Controllable hook return for the three states under test.
let connectionsState: {
	connections: Array<{ provider: string; externalOrgName?: string | null }>;
	isLoading: boolean;
} = { connections: [], isLoading: false };

mock.module(
	"renderer/react-query/integrations/useIntegrationConnections",
	() => ({
		useIntegrationConnections: () => connectionsState,
	}),
);

mock.module("renderer/lib/auth-client", () => ({
	authClient: {
		useSession: () => ({
			data: { session: { activeOrganizationId: "org-1" } },
		}),
	},
}));

mock.module("renderer/lib/api-trpc-client", () => ({
	apiTrpcClient: {
		integration: {
			github: { getInstallation: { query: async () => null } },
		},
	},
}));

mock.module("renderer/env.renderer", () => ({
	env: { NEXT_PUBLIC_WEB_URL: "https://web.example" },
}));

// Render only the Linear row so its status text is unambiguous.
mock.module("../../../utils/settings-search", () => ({
	isItemVisible: (itemId: string) => itemId === "linear",
	SETTING_ITEM_ID: {
		INTEGRATIONS_LINEAR: "linear",
		INTEGRATIONS_GITHUB: "github",
		INTEGRATIONS_SLACK: "slack",
	},
}));

const { render, cleanup, act } = await import("@testing-library/react");
const { IntegrationsSettings } = await import("./IntegrationsSettings");

// Flush the always-on github useEffect (async getInstallation) so its state
// update doesn't fire outside act() after assertions.
async function renderAndSettle() {
	let view: ReturnType<typeof render>;
	await act(async () => {
		view = render(<IntegrationsSettings />);
		await Promise.resolve();
	});
	// biome-ignore lint/style/noNonNullAssertion: assigned synchronously above
	return view!;
}

afterEach(() => cleanup());

describe("IntegrationsSettings — Linear row status", () => {
	it("shows a loading state (not 'Not connected') while connections are pending", async () => {
		connectionsState = { connections: [], isLoading: true };

		const view = await renderAndSettle();

		expect(view.getByText("Linear")).toBeDefined();
		// The regression would render "Not connected" here; loading must not.
		expect(view.queryByText("Not connected")).toBeNull();
		expect(view.queryByText(/^Connected/)).toBeNull();
	});

	it("shows 'Connected to <org>' when a linear connection exists", async () => {
		connectionsState = {
			connections: [{ provider: "linear", externalOrgName: "Acme" }],
			isLoading: false,
		};

		const view = await renderAndSettle();

		expect(view.getByText("Connected to Acme")).toBeDefined();
	});

	it("shows 'Not connected' when loaded with no connections", async () => {
		connectionsState = { connections: [], isLoading: false };

		const view = await renderAndSettle();

		expect(view.getByText("Not connected")).toBeDefined();
	});
});
