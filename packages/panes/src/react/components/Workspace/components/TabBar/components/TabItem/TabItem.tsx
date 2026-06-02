import { Button } from "@superset/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { OverflowFadeText } from "@superset/ui/overflow-fade-text";
import { cn } from "@superset/ui/utils";
import { PencilIcon, XIcon } from "lucide-react";
import {
	memo,
	type ReactNode,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { useDrag, useDrop } from "react-dnd";
import type { StoreApi } from "zustand/vanilla";
import type { WorkspaceStore } from "../../../../../../../core/store";
import type { Tab } from "../../../../../../../types";
import type { PaneRegistry, RendererContext } from "../../../../../../types";
import { pickTabTitlePane } from "../../../../utils/resolveTabTitle";
import { useTabTitle } from "../../../../utils/useTabTitle";
import { PANE_DRAG_TYPE } from "../../../Tab/components/Pane/components/PaneHeader";
import { TabRenameInput } from "./components/TabRenameInput";

export const TAB_DRAG_TYPE = "tab";

interface TabItemProps<TData> {
	tab: Tab<TData>;
	tabs: Tab<TData>[];
	store: StoreApi<WorkspaceStore<TData>>;
	registry: PaneRegistry<TData>;
	index: number;
	isActive: boolean;
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onCloseOtherTabs: (tabId: string) => void;
	onCloseAll: () => void;
	onRenameTab: (tabId: string, title: string | undefined) => void;
	renderIcon?: (tab: Tab<TData>) => ReactNode;
	renderAccessory?: (tab: Tab<TData>) => ReactNode;
}

function TabItemInner<TData>({
	tab,
	tabs,
	store,
	registry,
	index,
	isActive,
	onSelectTab,
	onCloseTab,
	onCloseOtherTabs,
	onCloseAll,
	onRenameTab,
	renderIcon,
	renderAccessory,
}: TabItemProps<TData>) {
	const [isEditing, setIsEditing] = useState(false);
	const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
	const [editValue, setEditValue] = useState("");
	const title = useTabTitle(tab, tabs, registry);
	const fallbackIcon = useMemo(() => {
		const pane = pickTabTitlePane(tab);
		if (!pane) return null;
		const definition = registry[pane.kind];
		if (!definition?.getIcon) return null;
		const context: RendererContext<TData> = {
			pane: { ...pane, parentDirection: null },
			tab: { ...tab, position: index },
			isActive,
			store,
			actions: {
				close: () => {
					store.getState().closePane({ tabId: tab.id, paneId: pane.id });
				},
				focus: () =>
					store.getState().setActivePane({ tabId: tab.id, paneId: pane.id }),
				setTitle: (nextTitle) =>
					store.getState().setPaneTitleOverride({
						tabId: tab.id,
						paneId: pane.id,
						titleOverride: nextTitle,
					}),
				pin: () =>
					store.getState().setPanePinned({
						paneId: pane.id,
						pinned: true,
					}),
				updateData: (data) =>
					store.getState().setPaneData({ paneId: pane.id, data }),
				split: (position, newPane) =>
					store.getState().splitPane({
						tabId: tab.id,
						paneId: pane.id,
						position: position === "down" ? "bottom" : "right",
						newPane,
					}),
			},
			components: { PaneHeaderActions: () => null },
		};
		return definition.getIcon(context);
	}, [index, isActive, registry, store, tab]);
	const icon = renderIcon?.(tab) ?? fallbackIcon;
	const accessory = renderAccessory?.(tab);

	const startEditing = () => {
		setEditValue(title);
		setIsEditing(true);
	};

	const stopEditing = () => {
		setIsEditing(false);
	};

	const saveEdit = () => {
		const nextTitle = editValue.trim();
		if (nextTitle.length === 0) {
			onRenameTab(tab.id, undefined);
		} else if (nextTitle !== title) {
			onRenameTab(tab.id, nextTitle);
		}
		stopEditing();
	};
	const selectTab = useCallback(() => {
		onSelectTab(tab.id);
	}, [onSelectTab, tab.id]);
	const closeTab = useCallback(() => {
		onCloseTab(tab.id);
	}, [onCloseTab, tab.id]);
	const closeOtherTabs = useCallback(() => {
		onCloseOtherTabs(tab.id);
	}, [onCloseOtherTabs, tab.id]);

	const nodeRef = useRef<HTMLDivElement>(null);

	const [{ isDragging }, connectDrag] = useDrag(
		() => ({
			type: TAB_DRAG_TYPE,
			item: { tabId: tab.id, index },
			collect: (monitor) => ({
				isDragging: monitor.isDragging(),
			}),
		}),
		[tab.id, index],
	);

	// Existing pane-to-tab drop (hovering a pane over a tab switches to it)
	const [{ isOver: isPaneOver }, connectPaneDrop] = useDrop(
		() => ({
			accept: PANE_DRAG_TYPE,
			hover: () => {
				if (!isActive) selectTab();
			},
			collect: (monitor) => ({
				isOver: monitor.isOver(),
			}),
		}),
		[isActive, selectTab],
	);

	const setRef = useCallback(
		(node: HTMLDivElement | null) => {
			(nodeRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
			connectDrag(node);
			connectPaneDrop(node);
		},
		[connectDrag, connectPaneDrop],
	);

	return (
		<ContextMenu onOpenChange={setIsContextMenuOpen}>
			<ContextMenuTrigger asChild>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: mousedown selects tab immediately before drag threshold */}
				<div
					ref={setRef}
					className={cn(
						"group relative flex h-full w-full items-center border-r border-border transition-colors",
						isActive
							? "bg-border/30 text-foreground"
							: "text-muted-foreground/70 hover:bg-tertiary/20 hover:text-muted-foreground",
						isPaneOver && "bg-primary/5",
						isDragging && "opacity-30",
					)}
					onMouseDown={(event) => {
						if (event.button === 0) selectTab();
					}}
				>
					{isEditing ? (
						<div className="flex h-full w-full shrink-0 items-center px-2">
							<TabRenameInput
								className="w-full min-w-0 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
								maxLength={64}
								onCancel={stopEditing}
								onChange={setEditValue}
								onSubmit={saveEdit}
								value={editValue}
							/>
						</div>
					) : (
						<>
							<button
								className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-3 pr-1 text-left text-xs transition-colors"
								onAuxClick={(event) => {
									if (event.button === 1) {
										event.preventDefault();
										closeTab();
									}
								}}
								onDoubleClick={startEditing}
								title={isDragging ? undefined : title}
								type="button"
							>
								{icon && <span className="shrink-0">{icon}</span>}
								<OverflowFadeText className="flex-1">{title}</OverflowFadeText>
							</button>
							<div className="relative flex h-full w-7 shrink-0 items-center justify-center">
								{accessory && (
									<span className="pointer-events-none absolute inset-0 flex items-center justify-center leading-none opacity-100 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
										{accessory}
									</span>
								)}
								<Button
									aria-label="Close"
									className={cn(
										"pointer-events-none size-5 cursor-pointer text-current opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
										isActive ? "hover:bg-foreground/10" : "hover:bg-muted",
									)}
									onClick={(event) => {
										event.stopPropagation();
										closeTab();
									}}
									onMouseDown={(event) => {
										event.stopPropagation();
									}}
									size="icon"
									title="Close"
									type="button"
									variant="ghost"
								>
									<XIcon className="size-3.5" />
								</Button>
							</div>
						</>
					)}
				</div>
			</ContextMenuTrigger>
			{isContextMenuOpen && (
				<ContextMenuContent>
					<ContextMenuItem onSelect={startEditing}>
						<PencilIcon className="mr-2 size-4" />
						Rename
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem onSelect={closeTab}>
						<XIcon className="mr-2 size-4" />
						Close
					</ContextMenuItem>
					<ContextMenuItem onSelect={closeOtherTabs}>
						Close Others
					</ContextMenuItem>
					<ContextMenuItem onSelect={onCloseAll}>Close All</ContextMenuItem>
				</ContextMenuContent>
			)}
		</ContextMenu>
	);
}

export const TabItem = memo(TabItemInner) as typeof TabItemInner;
