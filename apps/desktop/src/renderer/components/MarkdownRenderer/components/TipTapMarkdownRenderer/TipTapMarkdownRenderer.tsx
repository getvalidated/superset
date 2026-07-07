import "highlight.js/styles/github-dark.css";

import { cn } from "@superset/ui/utils";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { type MutableRefObject, useEffect, useRef } from "react";
import { useMarkdownStyle } from "renderer/stores";
import { defaultConfig } from "../../styles/default/config";
import { tufteConfig } from "../../styles/tufte/config";
import { resolveMarkdownLink } from "../../utils/resolveMarkdownLink";
import { slugifyHeading } from "../../utils/slugifyHeading";
import { SelectionContextMenu } from "../SelectionContextMenu";
import { BubbleMenuToolbar } from "./components/BubbleMenuToolbar";
import { createMarkdownExtensions } from "./createMarkdownExtensions";

const styleConfigs = {
	default: defaultConfig,
	tufte: tufteConfig,
} as const;

export interface MarkdownEditorAdapter {
	focus(): void;
	getValue(): string;
	setValue(value: string): void;
	dispose(): void;
}

export interface MarkdownRelativeLinkTarget {
	path: string;
	anchor?: string;
}

interface TipTapMarkdownRendererProps {
	value: string;
	style?: keyof typeof styleConfigs;
	className?: string;
	editable?: boolean;
	editorRef?: MutableRefObject<MarkdownEditorAdapter | null>;
	onChange?: (value: string) => void;
	onSave?: () => void;
	/**
	 * Workspace-relative path of the file being rendered. Required to resolve
	 * relative links (`./file.md`, `../dir/file.md`) that are clicked.
	 */
	currentFilePath?: string;
	/**
	 * Called when a relative link to another file is followed. The renderer
	 * handles in-page anchors itself; external links open in the browser.
	 */
	onOpenRelativeLink?: (target: MarkdownRelativeLinkTarget) => void;
}

function scrollToHeadingAnchor(container: HTMLElement, anchor: string): void {
	const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
	for (const heading of headings) {
		if (slugifyHeading(heading.textContent ?? "") === anchor) {
			heading.scrollIntoView({ behavior: "smooth", block: "start" });
			return;
		}
	}
}

function getEditorMarkdown(editor: Editor): string {
	const storage = editor.storage as unknown as Record<
		string,
		{ getMarkdown?: () => string }
	>;

	return storage.markdown?.getMarkdown?.() ?? "";
}

function createMarkdownEditorAdapter(editor: Editor): MarkdownEditorAdapter {
	let disposed = false;

	return {
		focus() {
			editor.commands.focus();
		},
		getValue() {
			return getEditorMarkdown(editor);
		},
		setValue(value) {
			editor.commands.setContent(value, { emitUpdate: false });
		},
		dispose() {
			if (disposed) return;
			disposed = true;
		},
	};
}

export function TipTapMarkdownRenderer({
	value,
	style: styleProp,
	className,
	editable = false,
	editorRef,
	onChange,
	onSave,
	currentFilePath,
	onOpenRelativeLink,
}: TipTapMarkdownRendererProps) {
	const globalStyle = useMarkdownStyle();
	const style = styleProp ?? globalStyle;
	const config = styleConfigs[style];
	const articleRef = useRef<HTMLElement | null>(null);
	const onChangeRef = useRef(onChange);
	const onSaveRef = useRef(onSave);
	const onOpenRelativeLinkRef = useRef(onOpenRelativeLink);
	const currentFilePathRef = useRef(currentFilePath);

	onChangeRef.current = onChange;
	onSaveRef.current = onSave;
	onOpenRelativeLinkRef.current = onOpenRelativeLink;
	currentFilePathRef.current = currentFilePath;

	const editor = useEditor({
		immediatelyRender: false,
		editable,
		extensions: createMarkdownExtensions({
			editable,
			onSaveRef,
		}),
		content: value,
		editorProps: {
			attributes: {
				class: cn("focus:outline-none", editable && "min-h-[100px]"),
			},
		},
		onUpdate: ({ editor: currentEditor }) => {
			onChangeRef.current?.(getEditorMarkdown(currentEditor));
		},
	});

	useEffect(() => {
		if (!editor) {
			return;
		}

		const currentValue = getEditorMarkdown(editor);
		if (currentValue === value) {
			return;
		}

		editor.commands.setContent(value, { emitUpdate: false });
	}, [editor, value]);

	useEffect(() => {
		if (!editor) {
			return;
		}

		editor.setEditable(editable, false);
	}, [editable, editor]);

	useEffect(() => {
		if (!editorRef || !editor) {
			return;
		}

		const adapter = createMarkdownEditorAdapter(editor);
		editorRef.current = adapter;

		return () => {
			if (editorRef.current === adapter) {
				editorRef.current = null;
			}
			adapter.dispose();
		};
	}, [editor, editorRef]);

	useEffect(() => {
		const article = articleRef.current;
		if (!article) {
			return;
		}

		const handleClick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			const anchorEl = target?.closest("a");
			if (!anchorEl) {
				return;
			}

			const href = anchorEl.getAttribute("href");
			if (!href) {
				return;
			}

			// In the editable file viewer, a plain click positions the cursor so
			// link text stays editable — navigate on modifier-click instead. In a
			// read-only viewer every click navigates, matching GitHub/GitBook.
			const shouldNavigate = !editable || event.metaKey || event.ctrlKey;
			if (!shouldNavigate) {
				return;
			}

			const resolved = resolveMarkdownLink(
				currentFilePathRef.current ?? "",
				href,
			);

			if (resolved.kind === "external") {
				// Read-only renderers already open external links via TipTap's
				// openOnClick; only the editable viewer needs an explicit open.
				if (editable) {
					event.preventDefault();
					window.open(resolved.href, "_blank", "noopener,noreferrer");
				}
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			if (resolved.kind === "anchor") {
				scrollToHeadingAnchor(article, resolved.anchor);
				return;
			}

			onOpenRelativeLinkRef.current?.({
				path: resolved.path,
				anchor: resolved.anchor,
			});
		};

		article.addEventListener("click", handleClick);
		return () => article.removeEventListener("click", handleClick);
	}, [editable]);

	const content = (
		<div
			className={cn(
				"markdown-renderer h-full overflow-y-auto select-text",
				config.wrapperClass,
				className,
			)}
		>
			{editable && editor && (
				<BubbleMenu
					editor={editor}
					options={{
						placement: "top",
						offset: { mainAxis: 8 },
					}}
					shouldShow={({ editor: e, from, to }) => {
						if (from === to) return false;
						if (e.isActive("codeBlock")) return false;
						return true;
					}}
				>
					<BubbleMenuToolbar editor={editor} />
				</BubbleMenu>
			)}
			<article ref={articleRef} className={config.articleClass}>
				<EditorContent editor={editor} />
			</article>
		</div>
	);

	if (editable) {
		return content;
	}

	return (
		<SelectionContextMenu selectAllContainerRef={articleRef}>
			{content}
		</SelectionContextMenu>
	);
}
