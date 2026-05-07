import type { APIPromise } from "../core/api-promise";
import { APIResource } from "../core/resource";
import type { RequestOptions } from "../internal/request-options";

export class Members extends APIResource {
	/**
	 * List members of the active organization.
	 *
	 * Mirrors `superset organization members list`.
	 */
	list(
		query?: MemberListParams | null,
		options?: RequestOptions,
	): APIPromise<MemberListResponse> {
		return this._client.query<MemberListResponse>(
			"organization.members.list",
			query ?? undefined,
			options,
		);
	}

	/**
	 * Add an existing user to the active organization. The user must already
	 * have a Superset account — pass their userId.
	 */
	add(body: MemberAddParams, options?: RequestOptions): APIPromise<Member> {
		return this._client.mutation<Member>(
			"organization.members.add",
			body,
			options,
		);
	}

	/**
	 * Remove a member from the organization by userId.
	 */
	remove(
		body: MemberRemoveParams,
		options?: RequestOptions,
	): APIPromise<MemberRemoveResult> {
		return this._client.mutation<MemberRemoveResult>(
			"organization.members.remove",
			body,
			options,
		);
	}
}

export class Organization extends APIResource {
	/**
	 * Member management for the active organization.
	 */
	members: Members = new Members(this._client);
}

export type OrganizationRole = "member" | "admin" | "owner";

export interface Member {
	id: string;
	name: string | null;
	email: string;
	image: string | null;
	role: OrganizationRole;
}

export type MemberListResponse = Array<Member>;

export interface MemberListParams {
	search?: string | null;
	limit?: number;
}

export interface MemberAddParams {
	organizationId: string;
	userId: string;
	role?: OrganizationRole;
}

export interface MemberRemoveParams {
	organizationId: string;
	userId: string;
}

export interface MemberRemoveResult {
	success: boolean;
}

export declare namespace Organization {
	export type {
		Member,
		MemberAddParams,
		MemberListParams,
		MemberListResponse,
		MemberRemoveParams,
		MemberRemoveResult,
		OrganizationRole,
	};
}
