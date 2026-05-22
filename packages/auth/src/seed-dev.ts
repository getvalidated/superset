import { db } from "@superset/db/client";
import { users } from "@superset/db/schema/auth";
import {
	DEV_EMAIL,
	DEV_NAME,
	DEV_PASSWORD,
} from "@superset/shared/dev-credentials";
import { eq } from "drizzle-orm";
import { auth } from "./server";

async function seedDevAccount(): Promise<void> {
	if (process.env.NODE_ENV !== "development") {
		throw new Error(
			"seed-dev is local-dev only; run with NODE_ENV=development",
		);
	}

	const existing = await db.query.users.findFirst({
		where: eq(users.email, DEV_EMAIL),
	});
	if (existing) {
		console.log(`Dev account already exists: ${DEV_EMAIL}`);
		return;
	}

	await auth.api.signUpEmail({
		body: { email: DEV_EMAIL, password: DEV_PASSWORD, name: DEV_NAME },
	});
	console.log(`Seeded dev account: ${DEV_EMAIL}`);
}

seedDevAccount()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("seed-dev failed:", error);
		process.exit(1);
	});
