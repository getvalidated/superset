import { env } from "renderer/env.renderer";

/**
 * Dead-click forensics (dev tool). Watches every primary-button press and,
 * when no click resolves to an interactive element, logs WHY it died:
 *
 * - the pressed element (or an ancestor) was removed / remounted / reordered
 *   in the DOM between pointerdown and pointerup — Chromium then retargets or
 *   drops the click entirely (the classic re-render-on-pointerdown bug)
 * - a handler called stopPropagation()/stopImmediatePropagation()/
 *   preventDefault() on one of the press events (attributed with a stack)
 * - the pointer was captured away by another element mid-press
 * - a transparent overlay sits above the control (hit-test stack is logged)
 * - a <webview> overlay covers host UI — those clicks never even reach this
 *   document, so a periodic occlusion audit flags stale webview bounds and
 *   menus painting underneath webviews
 *
 * Enabled automatically in development; force on/off anywhere with
 * localStorage.setItem("click-forensics", "on" | "off") and reload.
 * Runtime API: window.__clickForensics — dump(), audit(), clear().
 */

interface Intervention {
	method: string;
	eventType: string;
	handler: string;
	stack: string[];
}

interface PathMutation {
	kind: "removed" | "added";
	node: string;
	atMs: number;
}

interface PressRecord {
	id: number;
	startedAt: number;
	point: { x: number; y: number };
	pressTarget: Element;
	pressDescription: string;
	pressPath: Node[];
	interactive: Element | null;
	interactiveDescription: string | null;
	hitStack: string[];
	occludedInteractive: string | null;
	interventions: Intervention[];
	captures: string[];
	mutations: PathMutation[];
	seenTargets: Partial<Record<string, string>>;
	reachedWindow: Partial<Record<string, boolean>>;
	pointerdownDefaultPrevented: boolean;
	upAtMs: number | null;
	upDistance: number;
	clickTarget: string | null;
	clickResolved: boolean;
	cancelled: boolean;
}

const TRACKED_EVENTS = new Set([
	"pointerdown",
	"pointerup",
	"mousedown",
	"mouseup",
	"click",
	"auxclick",
	"contextmenu",
]);

const INTERACTIVE_SELECTOR = [
	"button",
	"a[href]",
	"input",
	"select",
	"textarea",
	"summary",
	"label",
	"[contenteditable]",
	"[role='button']",
	"[role='menuitem']",
	"[role='menuitemcheckbox']",
	"[role='menuitemradio']",
	"[role='option']",
	"[role='tab']",
	"[role='checkbox']",
	"[role='switch']",
	"[role='slider']",
	"[role='combobox']",
	"[data-radix-collection-item]",
].join(", ");

/** Host UI a webview must never sit on top of. */
const AUDIT_UNDERLAY_SELECTOR = `${INTERACTIVE_SELECTOR}, [role='menu'], [data-radix-popper-content-wrapper], [data-canvas-ui]`;

const TAG = "[click-forensics]";
const MAX_REPORTS = 50;
const DRAG_SLOP_PX = 6;

function describe(node: EventTarget | Node | null): string {
	if (!node) return "<none>";
	if (!(node instanceof Element)) {
		if (node instanceof Document) return "#document";
		if (node === window) return "#window";
		return node instanceof Node ? `#${node.nodeName.toLowerCase()}` : "<?>";
	}
	const el = node;
	let out = el.tagName.toLowerCase();
	if (el.id) out += `#${el.id}`;
	const classes = Array.from(el.classList).slice(0, 3).join(".");
	if (classes) out += `.${classes}`;
	for (const attr of [
		"data-canvas-window",
		"data-canvas-ui",
		"data-testid",
		"role",
		"aria-label",
		"title",
	]) {
		const value = el.getAttribute(attr);
		if (value !== null) out += `[${attr}${value ? `="${value}"` : ""}]`;
	}
	const text = el.textContent?.trim().slice(0, 24);
	if (text && el.children.length === 0) out += ` "${text}"`;
	return out;
}

function describeHit(el: Element): string {
	const style = window.getComputedStyle(el);
	return `${describe(el)} (pointer-events:${style.pointerEvents}, z:${style.zIndex}, pos:${style.position})`;
}

function shortStack(): string[] {
	return (new Error().stack ?? "")
		.split("\n")
		.slice(3, 7)
		.map((line) => line.trim());
}

function hitStackAt(x: number, y: number): Element[] {
	return document.elementsFromPoint(x, y).slice(0, 8);
}

function parseClipInsets(
	clipPath: string,
): { top: number; right: number; bottom: number; left: number } | null {
	const match = clipPath.match(
		/inset\(([\d.]+)px ([\d.]+)px ([\d.]+)px ([\d.]+)px\)/,
	);
	if (!match) return null;
	return {
		top: Number(match[1]),
		right: Number(match[2]),
		bottom: Number(match[3]),
		left: Number(match[4]),
	};
}

class ClickForensics {
	private active: PressRecord | null = null;
	private observer: MutationObserver | null = null;
	private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
	private seq = 0;
	private presses = 0;
	private resolved = 0;
	readonly reports: Array<{ cause: string; record: PressRecord }> = [];
	private auditReported = new Map<string, number>();

	start(): void {
		this.patchEventMethods();
		this.patchPointerCapture();
		for (const type of TRACKED_EVENTS) {
			window.addEventListener(type, this.onCapture, { capture: true });
			window.addEventListener(type, this.onBubble, { capture: false });
		}
		window.addEventListener("pointercancel", this.onPointerCancel, {
			capture: true,
		});
		setInterval(() => this.auditWebviewOcclusion(), 3000);
		console.info(
			`${TAG} armed — dead clicks will be logged here. API: window.__clickForensics`,
		);
	}

	private onCapture = (event: Event): void => {
		const type = event.type;
		if (type === "pointerdown") {
			this.onPointerDown(event as PointerEvent);
			return;
		}
		const rec = this.active;
		if (!rec) return;
		rec.seenTargets[type] = describe(event.target);
		if (type === "pointerup") {
			const up = event as PointerEvent;
			rec.upAtMs = performance.now() - rec.startedAt;
			rec.upDistance = Math.hypot(
				up.clientX - rec.point.x,
				up.clientY - rec.point.y,
			);
			// click (or its absence) is decided synchronously after pointerup;
			// the timeout just leaves room for late/async dispatch.
			this.scheduleFinalize(250);
		} else if (type === "click") {
			rec.clickTarget = describe(event.target);
			const target = event.target;
			rec.clickResolved =
				target instanceof Element && !!target.closest(INTERACTIVE_SELECTOR);
		}
	};

	private onBubble = (event: Event): void => {
		const rec = this.active;
		if (!rec) return;
		rec.reachedWindow[event.type] = true;
	};

	private onPointerCancel = (): void => {
		const rec = this.active;
		if (!rec) return;
		rec.cancelled = true;
		this.scheduleFinalize(0);
	};

	private onPointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		if (this.active) this.finalize();
		this.presses += 1;
		const target =
			event.target instanceof Element ? event.target : document.body;
		const interactive = target.closest(INTERACTIVE_SELECTOR);
		const hits = hitStackAt(event.clientX, event.clientY);
		// A control visible under a hit-eating top layer = occluded.
		const occluded =
			interactive === null
				? (hits.slice(1).find((el) => el.matches(INTERACTIVE_SELECTOR)) ?? null)
				: null;
		const rec: PressRecord = {
			id: ++this.seq,
			startedAt: performance.now(),
			point: { x: event.clientX, y: event.clientY },
			pressTarget: target,
			pressDescription: describe(target),
			pressPath: event
				.composedPath()
				.filter((n): n is Node => n instanceof Node),
			interactive,
			interactiveDescription: interactive ? describe(interactive) : null,
			hitStack: hits.map(describeHit),
			occludedInteractive: occluded ? describe(occluded) : null,
			interventions: [],
			captures: [],
			mutations: [],
			seenTargets: { pointerdown: describe(target) },
			reachedWindow: {},
			pointerdownDefaultPrevented: false,
			upAtMs: null,
			upDistance: 0,
			clickTarget: null,
			clickResolved: false,
			cancelled: false,
		};
		this.active = rec;
		this.watchPressPathMutations(rec);
		// Backstop for presses whose pointerup never reaches this document
		// (native drag, focus steal, guest webview grabbing the pointer).
		this.scheduleFinalize(2000);
		// Read defaultPrevented after the whole dispatch finishes.
		queueMicrotask(() => {
			if (this.active === rec) {
				rec.pointerdownDefaultPrevented = event.defaultPrevented;
			}
		});
	}

	private watchPressPathMutations(rec: PressRecord): void {
		const pressPath = new Set(rec.pressPath);
		this.observer?.disconnect();
		this.observer = new MutationObserver((mutationList) => {
			const atMs = performance.now() - rec.startedAt;
			for (const mutation of mutationList) {
				for (const node of mutation.removedNodes) {
					if (pressPath.has(node)) {
						rec.mutations.push({ kind: "removed", node: describe(node), atMs });
					}
				}
				for (const node of mutation.addedNodes) {
					if (pressPath.has(node)) {
						rec.mutations.push({ kind: "added", node: describe(node), atMs });
					}
				}
			}
		});
		this.observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	}

	private scheduleFinalize(delayMs: number): void {
		if (this.finalizeTimer) clearTimeout(this.finalizeTimer);
		this.finalizeTimer = setTimeout(() => this.finalize(), delayMs);
	}

	private finalize(): void {
		const rec = this.active;
		if (!rec) return;
		this.active = null;
		this.observer?.disconnect();
		this.observer = null;
		if (this.finalizeTimer) {
			clearTimeout(this.finalizeTimer);
			this.finalizeTimer = null;
		}
		if (rec.clickResolved) {
			this.resolved += 1;
			return;
		}
		if (rec.upDistance > DRAG_SLOP_PX) return; // a drag, not a click
		const cause = this.diagnose(rec);
		if (!cause) return; // nothing interactive was aimed at — legit miss
		this.report(cause, rec);
	}

	private diagnose(rec: PressRecord): string | null {
		const aimedAtSomething =
			rec.interactive !== null ||
			rec.occludedInteractive !== null ||
			rec.mutations.length > 0 ||
			rec.pressTarget.tagName === "WEBVIEW";
		if (!aimedAtSomething) return null;

		if (rec.pressTarget.tagName === "WEBVIEW") {
			return rec.occludedInteractive
				? `press landed on a <webview> covering host UI (${rec.occludedInteractive}) — stale webview bounds/clip`
				: null; // clicking into a browser pane's page is a real interaction
		}
		if (rec.cancelled) {
			return "pointercancel fired mid-press — a gesture or pointer capture consumed the interaction";
		}
		const pressPathMutation = rec.mutations[0];
		if (pressPathMutation) {
			const afterRelease =
				rec.upAtMs !== null && pressPathMutation.atMs > rec.upAtMs;
			if (afterRelease && rec.interactive) {
				// e.g. a menu item that acts on pointerup and unmounts — the click
				// retargets but the control almost certainly ran its handler.
				return `press element unmounted AFTER release (${pressPathMutation.node} ${pressPathMutation.kind} at +${pressPathMutation.atMs.toFixed(0)}ms) — probably handled on pointerup, verify`;
			}
			const moved = rec.mutations.some(
				(m) =>
					m.kind === "added" &&
					rec.mutations.some(
						(other) => other.kind === "removed" && other.node === m.node,
					),
			);
			return `${moved ? "DOM ancestor moved/reordered" : "press element (or ancestor) removed"} mid-press: ${pressPathMutation.node} ${pressPathMutation.kind} at +${pressPathMutation.atMs.toFixed(0)}ms — Chromium drops/retargets the click when this happens`;
		}
		if (rec.occludedInteractive) {
			return `click blocked by overlay — top hit ${rec.hitStack[0] ?? "<?>"} covers ${rec.occludedInteractive}`;
		}
		const stopped = rec.interventions.find((i) => i.method.startsWith("stop"));
		if (stopped) {
			return `${stopped.eventType} propagation stopped (${stopped.method}) by handler on ${stopped.handler}`;
		}
		if (rec.upAtMs === null) {
			return "pointerup never reached this document — native drag, focus steal, or a webview took the pointer";
		}
		if (rec.captures.length > 0) {
			return `pointer captured mid-press by ${rec.captures.join(", ")} — later events retargeted away from the control`;
		}
		if (
			rec.pointerdownDefaultPrevented &&
			rec.seenTargets.mousedown === undefined
		) {
			const who = rec.interventions.find(
				(i) => i.method === "preventDefault" && i.eventType === "pointerdown",
			);
			return `preventDefault() on pointerdown suppressed the compatibility mouse events${who ? ` (called by handler on ${who.handler})` : ""}`;
		}
		if (
			rec.clickTarget === null &&
			rec.seenTargets.pointerup !== undefined &&
			rec.seenTargets.pointerup !== rec.seenTargets.pointerdown
		) {
			return `no click dispatched — press target ${rec.seenTargets.pointerdown ?? "<?>"} and release target ${rec.seenTargets.pointerup} diverged`;
		}
		if (rec.clickTarget !== null && rec.interactive) {
			return `click retargeted to non-interactive ${rec.clickTarget} although the press was on ${rec.interactiveDescription}`;
		}
		if (rec.clickTarget === null && rec.interactive) {
			return "no click dispatched after press on an interactive element — cause not captured, inspect the raw record";
		}
		return null;
	}

	private report(cause: string, rec: PressRecord): void {
		this.reports.push({ cause, record: rec });
		if (this.reports.length > MAX_REPORTS) this.reports.shift();
		console.groupCollapsed(
			`%c${TAG} DEAD CLICK%c on ${rec.interactiveDescription ?? rec.pressDescription} — ${cause}`,
			"color:#fff;background:#c0392b;padding:1px 4px;border-radius:2px",
			"",
		);
		console.log("press target:", rec.pressTarget);
		console.log("point:", rec.point);
		console.log("hit stack at press:", rec.hitStack);
		console.log("event targets seen:", rec.seenTargets);
		console.log("reached window (bubble):", rec.reachedWindow);
		if (rec.mutations.length)
			console.log("press-path mutations:", rec.mutations);
		if (rec.interventions.length)
			console.log("stopPropagation/preventDefault calls:", rec.interventions);
		if (rec.captures.length) console.log("setPointerCapture by:", rec.captures);
		console.log("click target:", rec.clickTarget ?? "<no click event fired>");
		console.groupEnd();
		this.auditWebviewOcclusion();
	}

	/**
	 * Clicks over a <webview> that covers host UI never reach this document at
	 * all, so no per-event forensics can see them. Instead: sample points over
	 * every visible webview and flag any spot where the webview is the top hit
	 * with clickable host UI directly underneath (stale bounds, or a menu
	 * painting behind the webview overlay).
	 */
	auditWebviewOcclusion(): void {
		const now = performance.now();
		for (const webview of Array.from(document.querySelectorAll("webview"))) {
			const style = window.getComputedStyle(webview);
			if (style.visibility === "hidden" || style.pointerEvents === "none")
				continue;
			const rect = webview.getBoundingClientRect();
			const insets = parseClipInsets(style.clipPath ?? "") ?? {
				top: 0,
				right: 0,
				bottom: 0,
				left: 0,
			};
			const left = rect.left + insets.left;
			const right = rect.right - insets.right;
			const top = rect.top + insets.top;
			const bottom = rect.bottom - insets.bottom;
			if (right - left < 8 || bottom - top < 8) continue;
			const xs = [left + 3, (left + right) / 2, right - 3];
			const ys = [top + 3, (top + bottom) / 2, bottom - 3];
			for (const x of xs) {
				for (const y of ys) {
					const stack = document.elementsFromPoint(x, y);
					if (stack[0] !== webview) continue;
					const under = stack
						.slice(1)
						.find((el) => el.matches(AUDIT_UNDERLAY_SELECTOR));
					if (!under) continue;
					const key = `${describe(webview)}::${describe(under)}`;
					const lastAt = this.auditReported.get(key);
					if (lastAt !== undefined && now - lastAt < 30_000) continue;
					this.auditReported.set(key, now);
					console.warn(
						`${TAG} webview overlay is covering clickable host UI at (${Math.round(x)}, ${Math.round(y)}): ${describe(under)} — clicks there go to the guest page and die silently`,
						{ webview, under },
					);
				}
			}
		}
	}

	dump(): void {
		console.log(
			`${TAG} presses: ${this.presses}, resolved clicks: ${this.resolved}, dead clicks reported: ${this.reports.length}`,
		);
		console.table(
			this.reports.map(({ cause, record }) => ({
				on: record.interactiveDescription ?? record.pressDescription,
				cause,
			})),
		);
	}

	clear(): void {
		this.reports.length = 0;
		this.auditReported.clear();
	}

	private patchEventMethods(): void {
		const forensics = this;
		for (const method of [
			"stopPropagation",
			"stopImmediatePropagation",
			"preventDefault",
		] as const) {
			const original = Event.prototype[method];
			Event.prototype[method] = function patched(this: Event) {
				const rec = forensics.active;
				if (rec && TRACKED_EVENTS.has(this.type)) {
					rec.interventions.push({
						method,
						eventType: this.type,
						handler: describe(this.currentTarget),
						stack: shortStack(),
					});
				}
				return original.call(this);
			};
		}
	}

	private patchPointerCapture(): void {
		const forensics = this;
		const original = Element.prototype.setPointerCapture;
		Element.prototype.setPointerCapture = function patched(
			this: Element,
			pointerId: number,
		) {
			forensics.active?.captures.push(describe(this));
			return original.call(this, pointerId);
		};
	}
}

declare global {
	interface Window {
		__clickForensics?: ClickForensics;
	}
}

export function initClickForensics(): void {
	const override = localStorage.getItem("click-forensics");
	if (override === "off") return;
	if (env.NODE_ENV !== "development" && override !== "on") return;
	if (window.__clickForensics) return; // HMR / double-boot guard
	const forensics = new ClickForensics();
	window.__clickForensics = forensics;
	forensics.start();
}
