/* Minimal stand-in for the Obsidian API, enough to exercise the view in jsdom. */
type ElInfo = { cls?: string; text?: string; type?: string; attr?: Record<string, string> };

function apply(el: HTMLElement, info?: ElInfo | string) {
	if (!info) return;
	if (typeof info === "string") { el.className = info; return; }
	if (info.cls) el.className = info.cls;
	if (info.text) el.textContent = info.text;
	if (info.type) el.setAttribute("type", info.type);
	for (const [k, v] of Object.entries(info.attr ?? {})) el.setAttribute(k, v);
}

export function installDomExtensions(win: any) {
	const P = win.HTMLElement.prototype, N = win.Node.prototype;
	N.createEl = function (tag: string, info?: ElInfo) { const el = win.document.createElement(tag); apply(el, info); this.appendChild(el); return el; };
	N.createDiv = function (info?: ElInfo) { return this.createEl("div", info); };
	N.createSpan = function (info?: ElInfo) { return this.createEl("span", info); };
	N.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
	P.addClass = function (c: string) { this.classList.add(c); };
	P.removeClass = function (c: string) { this.classList.remove(c); };
	P.toggleClass = function (c: string, on: boolean) { this.classList.toggle(c, on); };
	P.hasClass = function (c: string) { return this.classList.contains(c); };
	P.setCssProps = function (props: Record<string, string>) { for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v); };
	P.setText = function (t: string) { this.textContent = t; };
	P.hide = function () { this.style.display = "none"; };
	P.show = function () { this.style.display = ""; };
	P.isShown = function () { return this.style.display !== "none"; };
	P.scrollIntoView = function () { (win as any).__scrolledTo = this.getAttribute("data-ref"); };
}

export class ItemView {
	contentEl: HTMLElement; app: any; leaf: any;
	constructor(leaf: any) { this.leaf = leaf; this.app = leaf.app; this.contentEl = document.createElement("div"); document.body.appendChild(this.contentEl); }
	registerDomEvent(el: any, type: string, cb: any, opts?: any) { el.addEventListener(type, cb, opts); }
	async setState() {}
}
export const menus: Menu[] = [];
export class Menu {
	items: { title: string; cb?: () => void; checked?: boolean }[] = [];
	addItem(fn: (i: any) => void) {
		const rec: any = { title: "" };
		const item = { setTitle(t: string) { rec.title = t; return item; }, setIcon() { return item; }, setChecked(c: boolean) { rec.checked = c; return item; }, onClick(cb: () => void) { rec.cb = cb; return item; } };
		fn(item); this.items.push(rec); return this;
	}
	addSeparator() { return this; }
	showAtMouseEvent() { menus.push(this); }
}
export const notices: string[] = [];
export class Notice { constructor(m: string) { notices.push(m); } }
export function setIcon(el: HTMLElement, name: string) { el.setAttribute("data-icon", name); }
export function sanitizeHTMLToDom(html: string) {
	const t = document.createElement("template");
	t.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, "");
	return t.content;
}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export function requestUrl() { throw new Error("not available in tests"); }
