import { ItemView, Menu, Notice, ViewStateResult, WorkspaceLeaf, sanitizeHTMLToDom, setIcon } from "obsidian";
import type SefariaReaderPlugin from "./main";
import type { NameCompletion, SearchHit, TocNode } from "./api";
import {
	ContentsEntry,
	Passage,
	Segment,
	buildContents,
	loadPassage,
	parseSefariaUrl,
	sefariaUrl,
	stripHebrewMarks,
} from "./refs";
import { HEBREW_FONTS, LAYOUTS } from "./settings";

export const VIEW_TYPE_SEFARIA = "sefaria-reader";

type Entry =
	| { kind: "home" }
	| { kind: "text"; ref: string }
	| { kind: "search"; query: string }
	| { kind: "library"; path: string[] }
	| { kind: "book"; title: string };

interface Suggestion {
	kind: "ref" | "book" | "search";
	label: string;
	value: string;
}

const SEARCH_PAGE = 20;

export class SefariaView extends ItemView {
	private history: Entry[] = [];
	private pos = -1;
	/** Guards against out-of-order async renders. */
	private renderToken = 0;
	private suggestToken = 0;
	private suggestTimer: number | null = null;
	private suggestions: Suggestion[] = [];
	private suggestIndex = 0;

	private inputEl!: HTMLInputElement;
	private suggestEl!: HTMLElement;
	private backBtn!: HTMLElement;
	private fwdBtn!: HTMLElement;
	private bodyEl!: HTMLElement;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: SefariaReaderPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_SEFARIA;
	}

	getDisplayText(): string {
		const cur = this.current();
		if (cur?.kind === "text") return cur.ref;
		if (cur?.kind === "book") return cur.title;
		return "Sefaria";
	}

	getIcon(): string {
		return "book-open";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("sefaria-reader");

		const bar = root.createDiv({ cls: "sefaria-bar" });
		this.backBtn = this.iconButton(bar, "arrow-left", "Back", () => void this.go(-1));
		this.fwdBtn = this.iconButton(bar, "arrow-right", "Forward", () => void this.go(1));

		const searchWrap = bar.createDiv({ cls: "sefaria-search" });
		this.inputEl = searchWrap.createEl("input", {
			type: "text",
			cls: "sefaria-input",
			attr: {
				placeholder: "Reference, title or search words",
				spellcheck: "false",
				dir: "auto",
				"aria-label": "Open a text or search Sefaria",
			},
		});
		this.suggestEl = searchWrap.createDiv({ cls: "sefaria-suggest" });
		this.suggestEl.hide();

		this.iconButton(bar, "library", "Browse the library", () => void this.navigate({ kind: "library", path: [] }));
		this.iconButton(bar, "columns-2", "Layout", (evt) => this.layoutMenu(evt));

		this.bodyEl = root.createDiv({ cls: "sefaria-body" });

		this.registerDomEvent(this.inputEl, "input", () => this.queueSuggest());
		this.registerDomEvent(this.inputEl, "keydown", (evt) => this.onInputKey(evt));
		this.registerDomEvent(this.inputEl, "blur", () => {
			// let a click on a suggestion land first
			window.setTimeout(() => this.closeSuggest(), 150);
		});
		this.registerDomEvent(this.bodyEl, "click", (evt) => this.onBodyClick(evt));
		this.registerDomEvent(this.bodyEl, "contextmenu", (evt) => this.onBodyContext(evt));

		this.applySettings();
		if (this.pos < 0) await this.navigate({ kind: "home" });
	}

	async onClose(): Promise<void> {
		if (this.suggestTimer !== null) window.clearTimeout(this.suggestTimer);
	}

	getState(): Record<string, unknown> {
		return { entry: this.current() ?? { kind: "home" } };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const entry = (state as { entry?: Entry } | null)?.entry;
		if (entry && typeof entry === "object" && "kind" in entry) {
			const cur = this.current();
			if (!cur || JSON.stringify(cur) !== JSON.stringify(entry)) await this.navigate(entry);
		}
		await super.setState(state, result);
	}

	/** Re-read plugin settings (layout, sizes, marks) and redraw. */
	applySettings(): void {
		const s = this.plugin.settings;
		const root = this.contentEl;
		for (const l of LAYOUTS) root.removeClass("sefaria-layout-" + l.id);
		root.addClass("sefaria-layout-" + s.layout);
		for (const f of HEBREW_FONTS) root.removeClass("sefaria-hefont-" + f.id);
		root.addClass("sefaria-hefont-" + s.hebrewFont);
		const custom = s.customHebrewFont.replace(/["\\;{}]/g, "");
		root.setCssProps({
			"--sefaria-he-size": s.hebrewSize + "px",
			"--sefaria-en-size": s.englishSize + "px",
			"--sefaria-he-custom": custom ? `"${custom}"` : "serif",
		});
		if (this.current()?.kind === "text") void this.render();
	}

	focusInput(): void {
		this.inputEl?.focus();
		this.inputEl?.select();
	}

	// ---------------------------------------------------------------- public entry points

	async openRef(ref: string): Promise<void> {
		await this.navigate({ kind: "text", ref });
	}

	/** Resolve free text: a Sefaria URL, a reference, a book title, or search words. */
	async openQuery(raw: string): Promise<void> {
		const query = raw.trim();
		if (!query) return;
		const fromUrl = parseSefariaUrl(query);
		if (fromUrl) return this.openRef(fromUrl);
		const token = ++this.renderToken;
		this.showLoading(`Looking up “${query}”…`);
		try {
			const name = await this.plugin.api.resolveName(query, 1);
			if (token !== this.renderToken) return;
			if (name.is_ref && name.ref) {
				if (name.is_book) return this.navigate({ kind: "book", title: name.ref });
				return this.openRef(name.ref);
			}
		} catch {
			// fall through to full-text search
			if (token !== this.renderToken) return;
		}
		await this.navigate({ kind: "search", query });
	}

	// ---------------------------------------------------------------- history

	private current(): Entry | undefined {
		return this.history[this.pos];
	}

	private async navigate(entry: Entry): Promise<void> {
		const cur = this.current();
		if (!cur || JSON.stringify(cur) !== JSON.stringify(entry)) {
			this.history = this.history.slice(0, this.pos + 1);
			this.history.push(entry);
			if (this.history.length > 100) this.history.shift();
			this.pos = this.history.length - 1;
		}
		await this.render();
	}

	private async go(delta: number): Promise<void> {
		const next = this.pos + delta;
		if (next < 0 || next >= this.history.length) return;
		this.pos = next;
		await this.render();
	}

	// ---------------------------------------------------------------- rendering

	private async render(): Promise<void> {
		const entry = this.current();
		if (!entry || !this.bodyEl) return;
		const token = ++this.renderToken;
		this.backBtn.toggleClass("is-disabled", this.pos <= 0);
		this.fwdBtn.toggleClass("is-disabled", this.pos >= this.history.length - 1);
		this.closeSuggest();
		try {
			switch (entry.kind) {
				case "home":
					this.renderHome();
					break;
				case "text":
					await this.renderText(entry.ref, token);
					break;
				case "search":
					await this.renderSearch(entry.query, token);
					break;
				case "library":
					await this.renderLibrary(entry.path, token);
					break;
				case "book":
					await this.renderBook(entry.title, token);
					break;
			}
		} catch (e) {
			if (token !== this.renderToken) return;
			this.renderError(e, entry);
		}
		if (token === this.renderToken) {
			// keep the saved workspace state in step
			this.app.workspace.requestSaveLayout();
		}
	}

	private showLoading(message: string): void {
		this.bodyEl.empty();
		this.bodyEl.createDiv({ cls: "sefaria-status", text: message });
	}

	private renderError(e: unknown, entry: Entry): void {
		this.bodyEl.empty();
		const box = this.bodyEl.createDiv({ cls: "sefaria-status sefaria-error" });
		box.createDiv({ text: e instanceof Error ? e.message : String(e) });
		if (entry.kind === "text") {
			const btn = box.createEl("button", { text: `Search all texts for “${entry.ref}”` });
			btn.addEventListener("click", () => void this.navigate({ kind: "search", query: entry.ref }));
		}
	}

	private renderHome(): void {
		this.bodyEl.empty();
		const home = this.bodyEl.createDiv({ cls: "sefaria-home" });
		home.createEl("p", {
			text: "Type a reference (Berakhot 2a, Genesis 1:1-5, בראשית א), a title, or any words to search the library.",
		});
		home.createEl("p", { text: "Links to sefaria.org texts in your notes open here." });
		const row = home.createDiv({ cls: "sefaria-chips" });
		for (const ref of ["Genesis 1", "Berakhot 2a", "Pirkei Avot 1", "Mishneh Torah, Repentance 1"]) {
			row.createEl("a", { cls: "sefaria-chip", text: ref, attr: { "data-open-ref": ref, href: "#" } });
		}
	}

	private async renderText(ref: string, token: number): Promise<void> {
		this.showLoading(`Loading ${ref}…`);
		let passage: Passage;
		try {
			passage = await loadPassage(this.plugin.api, ref);
		} catch (e) {
			if (token !== this.renderToken) return;
			// "Zohar", "Siddur Ashkenaz": no single first page, show the book's contents instead
			if (e instanceof Error && (e as { complexBook?: boolean }).complexBook) {
				this.history[this.pos] = { kind: "book", title: ref.replace(/_/g, " ") };
				return this.render();
			}
			throw e;
		}
		if (token !== this.renderToken) return;

		// remember the canonical form so the tab title and saved state are tidy
		this.history[this.pos] = { kind: "text", ref: passage.ref };
		const s = this.plugin.settings;
		const body = this.bodyEl;
		body.empty();

		const head = body.createDiv({ cls: "sefaria-head" });
		const titles = head.createDiv({ cls: "sefaria-titles" });
		titles.createDiv({ cls: "sefaria-title", text: passage.ref });
		titles.createDiv({ cls: "sefaria-title-he", text: passage.heRef, attr: { dir: "rtl", lang: "he" } });
		const nav = head.createDiv({ cls: "sefaria-nav" });
		this.navLink(nav, passage.prev, "chevron-left", "Previous");
		const toc = nav.createEl("a", {
			cls: "sefaria-navlink",
			attr: { href: "#", "data-open-book": passage.book, "aria-label": `Contents of ${passage.book}` },
		});
		setIcon(toc, "list");
		this.navLink(nav, passage.next, "chevron-right", "Next");

		let firstHighlight: HTMLElement | null = null;
		let count = 0;
		for (const block of passage.blocks) {
			if (passage.blocks.length > 1) {
				body.createDiv({ cls: "sefaria-block-title", text: block.ref });
			}
			const wrap = body.createDiv({ cls: "sefaria-text" });
			for (const seg of block.segments) {
				count++;
				const el = this.renderSegment(wrap, seg, s.showVowels, s.showCantillation);
				if (passage.highlight.has(seg.ref)) {
					el.addClass("is-highlight");
					if (!firstHighlight) firstHighlight = el;
				}
			}
		}
		if (count === 0) {
			body.createDiv({ cls: "sefaria-status", text: "Sefaria has no text for this section." });
		}

		const foot = body.createDiv({ cls: "sefaria-foot" });
		const footNav = foot.createDiv({ cls: "sefaria-footnav" });
		if (passage.prev) {
			footNav.createEl("a", { text: "‹ " + passage.prev, attr: { href: "#", "data-open-ref": passage.prev } });
		}
		if (passage.next) {
			footNav.createEl("a", {
				cls: "sefaria-footnext",
				text: passage.next + " ›",
				attr: { href: "#", "data-open-ref": passage.next },
			});
		}
		for (const v of passage.versions) {
			const line = foot.createDiv({ cls: "sefaria-version" });
			line.setText(
				`${v.language === "he" ? "Source" : "English"}: ${v.title}` + (v.license ? ` (${v.license})` : "")
			);
		}
		foot.createEl("a", {
			cls: "sefaria-external",
			text: "Open on sefaria.org",
			attr: { href: sefariaUrl(passage.ref), "data-external": "1" },
		});

		if (firstHighlight) {
			firstHighlight.scrollIntoView({ block: "center" });
		} else {
			body.scrollTop = 0;
		}
	}

	private renderSegment(parent: HTMLElement, seg: Segment, vowels: boolean, cantillation: boolean): HTMLElement {
		const el = parent.createDiv({ cls: "sefaria-seg", attr: { "data-ref": seg.ref } });
		el.createEl("a", {
			cls: "sefaria-seg-num",
			text: seg.label,
			attr: { href: "#", "aria-label": `${seg.ref}: copy and more` },
		});
		const cols = el.createDiv({ cls: "sefaria-seg-cols" });
		if (seg.he) {
			const he = cols.createDiv({ cls: "sefaria-he", attr: { dir: "rtl", lang: "he" } });
			he.appendChild(sanitizeHTMLToDom(stripHebrewMarks(seg.he, vowels, cantillation)));
		}
		if (seg.en) {
			const en = cols.createDiv({ cls: "sefaria-en", attr: { dir: "ltr", lang: "en" } });
			en.appendChild(sanitizeHTMLToDom(seg.en));
		}
		return el;
	}

	private navLink(parent: HTMLElement, ref: string | null, icon: string, label: string): void {
		const a = parent.createEl("a", { cls: "sefaria-navlink", attr: { href: "#" } });
		setIcon(a, icon);
		if (ref) {
			a.setAttribute("data-open-ref", ref);
			a.setAttribute("aria-label", `${label}: ${ref}`);
		} else {
			a.addClass("is-disabled");
		}
	}

	private async renderSearch(query: string, token: number): Promise<void> {
		this.showLoading(`Searching for “${query}”…`);
		const api = this.plugin.api;
		// Titles that match, alongside full-text hits.
		const [nameRes, page] = await Promise.all([
			api.resolveName(query, 6).catch(() => null),
			api.search(query, 0, SEARCH_PAGE),
		]);
		if (token !== this.renderToken) return;
		const body = this.bodyEl;
		body.empty();
		body.createDiv({
			cls: "sefaria-results-head",
			text: `${page.total.toLocaleString()} result${page.total === 1 ? "" : "s"} for “${query}”`,
		});

		const titles = this.refCompletions(nameRes?.completion_objects);
		if (titles.length > 0) {
			const row = body.createDiv({ cls: "sefaria-chips" });
			for (const t of titles) {
				row.createEl("a", { cls: "sefaria-chip", text: t.title, attr: { href: "#", "data-open-book": t.key } });
			}
		}

		const list = body.createDiv({ cls: "sefaria-results" });
		const seen = new Set<string>();
		const add = (hits: SearchHit[]) => {
			for (const h of hits) {
				if (seen.has(h.ref)) continue;
				seen.add(h.ref);
				const item = list.createEl("a", { cls: "sefaria-result", attr: { href: "#", "data-open-ref": h.ref } });
				item.createDiv({ cls: "sefaria-result-ref", text: h.ref });
				const snip = item.createDiv({ cls: "sefaria-result-snippet", attr: { dir: "auto" } });
				snip.appendChild(sanitizeHTMLToDom(h.snippet));
				item.createDiv({ cls: "sefaria-result-version", text: h.version });
			}
		};
		add(page.hits);
		if (page.hits.length === 0) {
			body.createDiv({ cls: "sefaria-status", text: "No results. Try fewer or different words." });
			return;
		}

		let loaded = page.hits.length;
		if (loaded < page.total) {
			const more = body.createEl("button", { cls: "sefaria-more", text: "More results" });
			more.addEventListener("click", () => {
				void (async () => {
					more.disabled = true;
					more.setText("Loading…");
					try {
						const next = await api.search(query, loaded, SEARCH_PAGE);
						if (token !== this.renderToken) return;
						add(next.hits);
						loaded += next.hits.length;
						if (next.hits.length === 0 || loaded >= next.total) more.remove();
					} catch (e) {
						new Notice(e instanceof Error ? e.message : String(e));
					} finally {
						more.disabled = false;
						more.setText("More results");
					}
				})();
			});
		}
		body.scrollTop = 0;
	}

	private async renderLibrary(path: string[], token: number): Promise<void> {
		this.showLoading("Loading the library…");
		const toc = await this.plugin.api.getLibrary();
		if (token !== this.renderToken) return;
		let nodes: TocNode[] = toc;
		for (const name of path) {
			const next = nodes.find((n) => n.category === name);
			if (!next?.contents) break;
			nodes = next.contents;
		}
		const body = this.bodyEl;
		body.empty();

		const crumbs = body.createDiv({ cls: "sefaria-crumbs" });
		const crumb = (label: string, p: string[], last: boolean) => {
			if (last) {
				crumbs.createSpan({ cls: "sefaria-crumb-current", text: label });
			} else {
				crumbs.createEl("a", { text: label, attr: { href: "#", "data-open-path": JSON.stringify(p) } });
				crumbs.createSpan({ cls: "sefaria-crumb-sep", text: "›" });
			}
		};
		crumb("Library", [], path.length === 0);
		path.forEach((name, i) => crumb(name, path.slice(0, i + 1), i === path.length - 1));

		const list = body.createDiv({ cls: "sefaria-list" });
		for (const n of nodes) {
			if (n.category) {
				const a = list.createEl("a", {
					cls: "sefaria-list-item is-category",
					attr: { href: "#", "data-open-path": JSON.stringify([...path, n.category]) },
				});
				a.createSpan({ cls: "sefaria-list-en", text: n.category });
				if (n.heCategory) a.createSpan({ cls: "sefaria-list-he", text: n.heCategory, attr: { dir: "rtl" } });
			} else if (n.title) {
				const a = list.createEl("a", {
					cls: "sefaria-list-item",
					attr: { href: "#", "data-open-book": n.title },
				});
				a.createSpan({ cls: "sefaria-list-en", text: n.title });
				if (n.heTitle) a.createSpan({ cls: "sefaria-list-he", text: n.heTitle, attr: { dir: "rtl" } });
			}
		}
		body.scrollTop = 0;
	}

	private async renderBook(title: string, token: number): Promise<void> {
		this.showLoading(`Loading ${title}…`);
		const index = await this.plugin.api.getIndex(title);
		if (token !== this.renderToken) return;
		this.history[this.pos] = { kind: "book", title: index.title };
		const body = this.bodyEl;
		body.empty();

		const head = body.createDiv({ cls: "sefaria-head" });
		const titles = head.createDiv({ cls: "sefaria-titles" });
		titles.createDiv({ cls: "sefaria-title", text: index.title });
		if (index.heTitle) {
			titles.createDiv({ cls: "sefaria-title-he", text: index.heTitle, attr: { dir: "rtl", lang: "he" } });
		}
		if (index.categories?.length) {
			const cats = body.createDiv({ cls: "sefaria-crumbs" });
			index.categories.forEach((c, i) => {
				cats.createEl("a", {
					text: c,
					attr: { href: "#", "data-open-path": JSON.stringify(index.categories?.slice(0, i + 1)) },
				});
				if (i < (index.categories?.length ?? 0) - 1) cats.createSpan({ cls: "sefaria-crumb-sep", text: "›" });
			});
		}
		if (index.enShortDesc) body.createEl("p", { cls: "sefaria-desc", text: index.enShortDesc });

		const root = buildContents(index.schema, null);
		const wrap = body.createDiv({ cls: "sefaria-contents" });
		if (root.children) {
			for (const child of root.children) this.renderContents(wrap, child, 0);
		} else {
			this.renderContents(wrap, { ...root, label: "" }, 0);
		}
		body.scrollTop = 0;
	}

	private renderContents(parent: HTMLElement, entry: ContentsEntry, depth: number): void {
		const node = parent.createDiv({ cls: "sefaria-toc-node" });
		if (entry.children) {
			const det = node.createEl("details");
			if (depth === 0 && entry.children.length <= 12) det.setAttribute("open", "");
			const sum = det.createEl("summary", { text: entry.label });
			if (entry.heLabel) sum.createSpan({ cls: "sefaria-list-he", text: entry.heLabel, attr: { dir: "rtl" } });
			for (const child of entry.children) this.renderContents(det, child, depth + 1);
			return;
		}
		if (entry.sections) {
			if (entry.label) node.createDiv({ cls: "sefaria-toc-label", text: entry.label });
			const grid = node.createDiv({ cls: "sefaria-grid" });
			for (const sec of entry.sections) {
				grid.createEl("a", { text: sec.label, attr: { href: "#", "data-open-ref": sec.ref } });
			}
			return;
		}
		if (entry.ref) {
			const a = node.createEl("a", {
				cls: "sefaria-list-item",
				attr: { href: "#", "data-open-ref": entry.ref },
			});
			a.createSpan({ cls: "sefaria-list-en", text: entry.label });
			if (entry.heLabel) a.createSpan({ cls: "sefaria-list-he", text: entry.heLabel, attr: { dir: "rtl" } });
		}
	}

	// ---------------------------------------------------------------- body interaction

	private onBodyClick(evt: MouseEvent): void {
		const target = evt.target as HTMLElement | null;
		if (!target) return;

		const marker = target.closest("sup.footnote-marker");
		if (marker) {
			const note = marker.nextElementSibling;
			if (note?.classList.contains("footnote")) note.classList.toggle("is-open");
			evt.preventDefault();
			return;
		}

		const a = target.closest("a");
		if (!a) return;

		if (a.classList.contains("sefaria-seg-num")) {
			evt.preventDefault();
			const seg = a.closest<HTMLElement>(".sefaria-seg");
			if (seg) this.segmentMenu(seg, evt);
			return;
		}
		if (a.classList.contains("is-disabled")) {
			evt.preventDefault();
			return;
		}
		const openRef = a.getAttribute("data-open-ref");
		if (openRef) {
			evt.preventDefault();
			void this.openRef(openRef);
			return;
		}
		const openBook = a.getAttribute("data-open-book");
		if (openBook) {
			evt.preventDefault();
			void this.navigate({ kind: "book", title: openBook });
			return;
		}
		const openPath = a.getAttribute("data-open-path");
		if (openPath) {
			evt.preventDefault();
			let path: string[] = [];
			try {
				path = JSON.parse(openPath) as string[];
			} catch {
				// keep root
			}
			void this.navigate({ kind: "library", path });
			return;
		}
		if (a.getAttribute("data-external")) {
			evt.preventDefault();
			this.plugin.openExternal(a.getAttribute("href") ?? "");
			return;
		}
		// Links inside Sefaria's own text: cross-references carry data-ref or a site-relative href.
		const dataRef = a.getAttribute("data-ref");
		const href = a.getAttribute("href") ?? "";
		const inner = dataRef || (href.startsWith("/") ? parseSefariaUrl("https://www.sefaria.org" + href) : parseSefariaUrl(href));
		evt.preventDefault();
		if (inner) {
			void this.openRef(inner);
		} else if (/^https?:/i.test(href)) {
			this.plugin.openExternal(href);
		}
	}

	private onBodyContext(evt: MouseEvent): void {
		const seg = (evt.target as HTMLElement | null)?.closest<HTMLElement>(".sefaria-seg");
		if (!seg) return;
		// keep the native menu when the user has selected text to copy
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed) return;
		evt.preventDefault();
		this.segmentMenu(seg, evt);
	}

	private plainText(el: Element | null): string {
		if (!el) return "";
		const clone = el.cloneNode(true) as HTMLElement;
		clone.querySelectorAll(".footnote, .footnote-marker").forEach((n) => n.remove());
		return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
	}

	private segmentMenu(seg: HTMLElement, evt: MouseEvent): void {
		const ref = seg.getAttribute("data-ref") ?? "";
		const he = this.plainText(seg.querySelector(".sefaria-he"));
		const en = this.plainText(seg.querySelector(".sefaria-en"));
		const menu = new Menu();
		const copy = (title: string, text: string) => {
			if (!text) return;
			menu.addItem((item) =>
				item
					.setTitle(title)
					.setIcon("copy")
					.onClick(() => void this.copy(text))
			);
		};
		copy("Copy Hebrew", he);
		copy("Copy English", en);
		if (he && en) copy("Copy both", `${he}\n${en}`);
		copy("Copy both with reference", [he, en, `(${ref})`].filter(Boolean).join("\n"));
		menu.addSeparator();
		copy("Copy reference", ref);
		copy("Copy link", `[${ref}](${sefariaUrl(ref)})`);
		menu.addItem((item) =>
			item
				.setTitle("Open on sefaria.org")
				.setIcon("external-link")
				.onClick(() => this.plugin.openExternal(sefariaUrl(ref)))
		);
		menu.showAtMouseEvent(evt);
	}

	private async copy(text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			new Notice("Copied");
		} catch {
			new Notice("Could not copy to the clipboard");
		}
	}

	private layoutMenu(evt: MouseEvent): void {
		const s = this.plugin.settings;
		const menu = new Menu();
		for (const l of LAYOUTS) {
			menu.addItem((item) =>
				item
					.setTitle(l.label)
					.setChecked(s.layout === l.id)
					.onClick(() => {
						s.layout = l.id;
						void this.plugin.saveSettings();
					})
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Vowels")
				.setChecked(s.showVowels)
				.onClick(() => {
					s.showVowels = !s.showVowels;
					void this.plugin.saveSettings();
				})
		);
		menu.addItem((item) =>
			item
				.setTitle("Cantillation marks")
				.setChecked(s.showCantillation)
				.onClick(() => {
					s.showCantillation = !s.showCantillation;
					void this.plugin.saveSettings();
				})
		);
		menu.showAtMouseEvent(evt);
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, onClick: (evt: MouseEvent) => void): HTMLElement {
		const btn = parent.createDiv({ cls: "clickable-icon sefaria-btn", attr: { "aria-label": label } });
		setIcon(btn, icon);
		this.registerDomEvent(btn, "click", (evt) => {
			if (!btn.hasClass("is-disabled")) onClick(evt);
		});
		return btn;
	}

	// ---------------------------------------------------------------- search box suggestions

	private refCompletions(objs: NameCompletion[] | undefined): NameCompletion[] {
		const seen = new Set<string>();
		const out: NameCompletion[] = [];
		for (const o of objs ?? []) {
			if (o.type !== "ref" || seen.has(o.key)) continue;
			seen.add(o.key);
			out.push(o);
		}
		return out;
	}

	private queueSuggest(): void {
		if (this.suggestTimer !== null) window.clearTimeout(this.suggestTimer);
		const query = this.inputEl.value.trim();
		if (query.length < 2 || parseSefariaUrl(query)) {
			this.suggestToken++;
			this.closeSuggest();
			return;
		}
		this.suggestTimer = window.setTimeout(() => void this.loadSuggest(query), 250);
	}

	private async loadSuggest(query: string): Promise<void> {
		const token = ++this.suggestToken;
		let items: Suggestion[] = [];
		let recognised = false;
		try {
			const res = await this.plugin.api.resolveName(query, 7);
			if (token !== this.suggestToken) return;
			if (res.is_ref && res.ref) {
				recognised = true;
				items.push({ kind: res.is_book ? "book" : "ref", label: res.ref, value: res.ref });
			}
			for (const c of this.refCompletions(res.completion_objects)) {
				if (items.some((i) => i.value === c.key)) continue;
				items.push({ kind: "book", label: c.title === c.key ? c.key : `${c.title} → ${c.key}`, value: c.key });
			}
		} catch {
			if (token !== this.suggestToken) return;
			items = [];
			recognised = false;
		}
		const search: Suggestion = { kind: "search", label: `Search all texts for “${query}”`, value: query };
		// A recognised reference goes first so Enter opens it; otherwise Enter searches.
		if (recognised) items.push(search);
		else items.unshift(search);
		if (this.inputEl.value.trim() !== query) return;
		this.suggestions = items;
		this.suggestIndex = 0;
		this.drawSuggest();
	}

	private drawSuggest(): void {
		const el = this.suggestEl;
		el.empty();
		if (this.suggestions.length === 0) {
			el.hide();
			return;
		}
		this.suggestions.forEach((s, i) => {
			const row = el.createDiv({ cls: "sefaria-suggest-item" + (i === this.suggestIndex ? " is-selected" : "") });
			const icon = row.createSpan({ cls: "sefaria-suggest-icon" });
			setIcon(icon, s.kind === "search" ? "search" : s.kind === "book" ? "book" : "corner-down-right");
			row.createSpan({ text: s.label, attr: { dir: "auto" } });
			// mousedown, so it fires before the input's blur
			row.addEventListener("mousedown", (evt) => {
				evt.preventDefault();
				this.choose(s);
			});
		});
		el.show();
	}

	private closeSuggest(): void {
		this.suggestions = [];
		this.suggestEl?.empty();
		this.suggestEl?.hide();
	}

	private choose(s: Suggestion): void {
		this.suggestToken++;
		this.closeSuggest();
		this.inputEl.value = s.value;
		if (s.kind === "search") void this.navigate({ kind: "search", query: s.value });
		else if (s.kind === "book") void this.navigate({ kind: "book", title: s.value });
		else void this.openRef(s.value);
	}

	private onInputKey(evt: KeyboardEvent): void {
		const open = this.suggestions.length > 0;
		if (evt.key === "ArrowDown" && open) {
			evt.preventDefault();
			this.suggestIndex = (this.suggestIndex + 1) % this.suggestions.length;
			this.drawSuggest();
		} else if (evt.key === "ArrowUp" && open) {
			evt.preventDefault();
			this.suggestIndex = (this.suggestIndex - 1 + this.suggestions.length) % this.suggestions.length;
			this.drawSuggest();
		} else if (evt.key === "Escape" && open) {
			evt.preventDefault();
			this.closeSuggest();
		} else if (evt.key === "Enter" && !evt.isComposing) {
			evt.preventDefault();
			if (this.suggestTimer !== null) window.clearTimeout(this.suggestTimer);
			const typed = this.inputEl.value.trim();
			if (open && this.suggestIndex > 0) {
				this.choose(this.suggestions[this.suggestIndex]);
			} else {
				// Nothing picked explicitly: let Sefaria decide whether this is a reference or search words.
				this.suggestToken++;
				this.closeSuggest();
				void this.openQuery(typed);
			}
		}
	}
}
