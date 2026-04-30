import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthContext {
	sub: string;
	email: string;
	organizationIds: string[];
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL("/api/auth/jwks", jwksUrl));
	}
	return jwks;
}

export async function verifyJWT(
	token: string,
	jwksUrl: string,
	issuer: string,
): Promise<AuthContext | null> {
	try {
		const { payload } = await jwtVerify(token, getJWKS(jwksUrl), {
			issuer,
			audience: issuer,
		});

		const sub = payload.sub;
		const email = payload.email as string | undefined;
		const organizationIds = payload.organizationIds as string[] | undefined;

		if (!sub || !organizationIds) {
			return null;
		}

		return { sub, email: email ?? "", organizationIds };
	} catch (error) {
		console.error("[relay-cf] JWT verification failed:", error);
		return null;
	}
}
