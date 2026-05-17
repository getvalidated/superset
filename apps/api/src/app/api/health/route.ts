import { getDeploymentProfile } from "@superset/shared/deployment-profile";
import { NextResponse } from "next/server";
import { getIntegrationStatuses } from "../../../lib/integration-status";

export function GET() {
	const profile = getDeploymentProfile();
	return NextResponse.json({
		ok: true,
		profile,
		integrations: getIntegrationStatuses(),
	});
}
