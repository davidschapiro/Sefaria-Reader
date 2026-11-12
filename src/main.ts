import { Editor, Notice, Plugin, WorkspaceLeaf, requestUrl } from "obsidian";
import { SefariaApi } from "./api";
import { parseSefariaUrl } from "./refs";
import { DEFAULT_SETTINGS, SefariaReaderSettings, SefariaSettingTab } from "./settings";
import { SefariaView, VIEW_TYPE_SEFARIA } from "./view";

const URL_IN_TEXT = /https?:\/\/[^\s)\]>"']+/g;

export default class SefariaReaderPlugin extends Plugin {
	settings: SefariaReaderSettings = { ...DEFAULT_SETTINGS };
	api!: SefariaApi;
	private nativeOpen: ((url?: string | URL, target?: string, features?: string) => Window | null) | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.api = new SefariaApi(async (req) => {
			const res = await requestUrl({
				url: req.url,
				method: req.method ?? "GET",
				body: req.body,
				contentType: req.body ? "application/json; charset=utf-8" : undefined,
				throw: false,
			});
			return { status: res.status, text: res.text };
		});

		this.registerView(VIEW_TYPE_SEFARIA, (leaf) => new SefariaView(leaf, this));

		this.addRibbonIcon("book-open", "Open Sefaria reader", () => {
			void this.activateView().then((v) => v?.focusInput());
		});

		this.addCommand({
			id: "open",
			name: "Open reader",
			callback: () => {
				void this.activateView().then((v) => v?.focusInput());
			},
		});

		this.addCommand({
			id: "open-selection",
			name: "Open selection or link at cursor",
			editorCallback: (editor) => {
				const query = this.queryFromEditor(editor);
				if (!query) {
					new Notice("Select a reference or place the cursor on a Sefaria link first.");
					return;
				}
				void this.openQuery(query);
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				const selection = editor.getSelection().trim();
				if (!selection || selection.length > 200) return;
				menu.addItem((item) =>
					item
						.setTitle("Open in Sefaria reader")
						.setIcon("book-open")
						.onClick(() => void this.openQuery(selection))
				);
			})
		);

		// obsidian://sefaria?ref=Genesis.1.1
		this.registerObsidianProtocolHandler("sefaria", (params) => {
			const ref = params.ref || params.q;
			if (ref) void this.openQuery(ref);
		});

		this.addSettingTab(new SefariaSettingTab(this.app, this));
		this.installLinkInterception();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<SefariaReaderSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SEFARIA)) {
			if (leaf.view instanceof SefariaView) leaf.view.applySettings();
		}
	}

	/** Open a URL in the system browser, bypassing our own link interception. */
	openExternal(url: string): void {
		if (!url) return;
		if (this.nativeOpen) this.nativeOpen(url, "_blank");
		else window.open(url, "_blank");
	}

	async activateView(): Promise<SefariaView | null> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_SEFARIA)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE_SEFARIA, active: true });
		}
		await workspace.revealLeaf(leaf);
		await leaf.loadIfDeferred();
		return leaf.view instanceof SefariaView ? leaf.view : null;
	}

	async openRef(ref: string): Promise<void> {
		const view = await this.activateView();
		await view?.openRef(ref);
	}

	async openQuery(query: string): Promise<void> {
		const view = await this.activateView();
		await view?.openQuery(query);
	}

	private queryFromEditor(editor: Editor): string | null {
		const selection = editor.getSelection().trim();
		if (selection) return selection;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		for (const m of line.matchAll(URL_IN_TEXT)) {
			const start = m.index ?? 0;
			if (cursor.ch >= start && cursor.ch <= start + m[0].length && parseSefariaUrl(m[0])) return m[0];
		}
		// cursor anywhere on a line with exactly one Sefaria link
		const links = [...line.matchAll(URL_IN_TEXT)].map((m) => m[0]).filter((u) => parseSefariaUrl(u));
		return links.length === 1 ? links[0] : null;
	}

	/**
	 * Route clicks on sefaria.org text links into the reader.
	 * Reading view renders real anchors; the editor opens links through window.open.
	 */
	private installLinkInterception(): void {
		this.registerDomEvent(
			activeDocument,
			"click",
			(evt: MouseEvent) => {
				if (!this.settings.interceptLinks || evt.defaultPrevented) return;
				const target = evt.target as HTMLElement | null;
				const a = target?.closest?.("a.external-link") as HTMLAnchorElement | null;
				if (!a || a.closest(".sefaria-reader")) return;
				const ref = parseSefariaUrl(a.getAttribute("href") ?? "");
				if (!ref) return;
				evt.preventDefault();
				evt.stopPropagation();
				void this.openRef(ref);
			},
			{ capture: true }
		);

		// Keep the original so it can be restored on unload and used for genuinely external links.
		const original = Object.getOwnPropertyDescriptor(window, "open");
		const native = window.open.bind(window);
		this.nativeOpen = native;
		window.open = (url?: string | URL, target?: string, features?: string): Window | null => {
			if (this.settings.interceptLinks && url) {
				const ref = parseSefariaUrl(String(url));
				if (ref) {
					void this.openRef(ref);
					return null;
				}
			}
			return native(url, target, features);
		};
		this.register(() => {
			if (original) Object.defineProperty(window, "open", original);
			else Reflect.deleteProperty(window, "open");
			this.nativeOpen = null;
		});
	}
}
