import type { AnyRouter } from "@tanstack/react-router";

let routerRef: AnyRouter | null = null;

export function setRouterInstance(router: AnyRouter): void {
	routerRef = router;
}

export function getRouterInstance(): AnyRouter {
	if (!routerRef) {
		throw new Error("Router instance not set yet");
	}
	return routerRef;
}
