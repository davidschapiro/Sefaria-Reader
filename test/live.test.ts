/* Runs against the real Sefaria API and renders the view in jsdom. Needs network. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { SefariaApi } from "../src/api";
import { loadPassage } from "../src/refs";
import { DEFAULT_SETTINGS } from "../src/settings";
import { installDomExtensions, menus } from "./obsidian-stub";

const api = new SefariaApi(async (req) => {
	const res = await fetch(req.url, {
		method: req.method ?? "GET",
		body: req.body,
		headers: req.body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
	});
	return { status: res.status, text: await res.text() };
});

let SefariaView: typeof import("../src/view").SefariaView;
let dom: JSDOM;
const opened: string[] = [];

before(async () => {
	dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
	const g = globalThis as any;
	g.window = dom.window; g.document = dom.window.document;
	g.HTMLElement = dom.window.HTMLElement; g.Node = dom.window.Node;
	installDomExtensions(dom.window);
	SefariaView = (await import("../src/view")).SefariaView;
});

function makeView(settings = { ...DEFAULT_SETTINGS }) {
	const app = { workspace: { requestSaveLayout() {} } };
	const plugin: any = { api, settings, saveSettings: async () => {}, openExternal: (u: string) => opened.push(u) };
	const view: any = new SefariaView({ app } as any, plugin);
	return { view, plugin, el: view.contentEl as HTMLElement };
}
const click = (el: Element) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
const q = (el: Element, sel: string) => [...el.querySelectorAll(sel)] as HTMLElement[];

test("API: passages of every shape", async () => {
	const tanakh = await loadPassage(api, "Genesis.1.3-5");
	assert.equal(tanakh.ref, "Genesis 1:3-5");
	assert.equal(tanakh.blocks[0].segments.length, 31);
	assert.deepEqual([...tanakh.highlight], ["Genesis 1:3", "Genesis 1:4", "Genesis 1:5"]);
	assert.ok(tanakh.blocks[0].segments[0].he.includes("ב") && tanakh.blocks[0].segments[0].en.length > 10);
	assert.equal(tanakh.next, "Genesis 2");

	const talmud = await loadPassage(api, "Berakhot 2a:5-2b:3");
	assert.deepEqual(talmud.blocks.map((b) => b.ref), ["Berakhot 2a", "Berakhot 2b"]);
	assert.ok(talmud.highlight.has("Berakhot 2a:5") && talmud.highlight.has("Berakhot 2b:3") && !talmud.highlight.has("Berakhot 2a:4"));
	assert.equal(talmud.next, "Berakhot 3a");

	const book = await loadPassage(api, "Mishneh Torah, Mourning");
	assert.equal(book.ref, "Mishneh Torah, Mourning 1");

	const rashi = await loadPassage(api, "Rashi on Genesis 1:1:1");
	assert.equal(rashi.blocks[0].ref, "Rashi on Genesis 1:1");
	assert.deepEqual([...rashi.highlight], ["Rashi on Genesis 1:1:1"]);

	const siddur = await loadPassage(api, "Siddur Ashkenaz, Weekday, Shacharit, Preparatory Prayers, Modeh Ani");
	assert.ok(siddur.blocks[0].segments.length >= 1);
	assert.match(siddur.blocks[0].segments[0].ref, /Modeh Ani 1$/);

	await assert.rejects(loadPassage(api, "Zohar"), (e: any) => e.complexBook === true);
	await assert.rejects(loadPassage(api, "Nonexistent 3"), /Could not find/);
});

test("API: name resolution, search, library, index", async () => {
	const ref = await api.resolveName("brachot 2a");
	assert.equal(ref.is_ref, true); assert.equal(ref.ref, "Berakhot 2a");
	const he = await api.resolveName("בראשית א");
	assert.equal(he.ref, "Genesis 1");
	const words = await api.resolveName("love your neighbor");
	assert.equal(words.is_ref, false);
	const page = await api.search("love your neighbor", 0, 5);
	assert.ok(page.total > 10 && page.hits.length === 5 && page.hits[0].snippet.includes("<b>"));
	const page2 = await api.search("love your neighbor", 5, 5);
	assert.notEqual(page2.hits[0].ref + page2.hits[0].version, page.hits[0].ref + page.hits[0].version);
	const heb = await api.search("ואהבת לרעך כמוך", 0, 5);
	assert.ok(heb.hits.length > 0);
	const lib = await api.getLibrary();
	assert.ok(lib.some((c) => c.category === "Tanakh") && lib.some((c) => c.category === "Talmud"));
	const idx = await api.getIndex("Berakhot");
	assert.equal(idx.schema.addressTypes?.[0], "Talmud");
});

test("View: open a segment, highlight, navigate, layout and marks", async () => {
	const { view, plugin, el } = makeView();
	await view.onOpen();
	assert.ok(el.querySelector(".sefaria-home"));
	await view.openRef("Genesis.1.3");
	assert.equal(el.querySelector(".sefaria-title")!.textContent, "Genesis 1:3");
	assert.equal(q(el, ".sefaria-seg").length, 31);
	assert.deepEqual(q(el, ".sefaria-seg.is-highlight").map((s) => s.dataset.ref), ["Genesis 1:3"]);
	assert.equal((dom.window as any).__scrolledTo, "Genesis 1:3");
	const heText = el.querySelector(".sefaria-he")!.textContent!;
	assert.ok(/[ְ-ּ]/.test(heText), "vowels shown by default");
	assert.ok(!/[֑-֯]/.test(heText), "cantillation hidden by default");
	assert.equal(el.querySelector(".sefaria-he")!.getAttribute("dir"), "rtl");
	assert.ok(el.querySelector(".sefaria-foot")!.textContent!.includes("Miqra according to the Masorah"));
	assert.ok(el.classList.contains("sefaria-layout-stacked"));
	assert.ok(el.classList.contains("sefaria-hefont-taamey"), "Taamey Frank is the default Hebrew font");

	// footnote toggles
	const marker = el.querySelector("sup.footnote-marker")!;
	click(marker);
	assert.ok(marker.nextElementSibling!.classList.contains("is-open"));

	// segment menu copies plain text without footnotes
	click(q(el, ".sefaria-seg")[0].querySelector(".sefaria-seg-num")!);
	const titles = menus[menus.length - 1].items.map((i) => i.title);
	assert.deepEqual(titles, ["Copy Hebrew", "Copy English", "Copy both", "Copy both with reference", "Copy reference", "Copy link", "Open on sefaria.org"]);
	let copied = "";
	Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (t: string) => { copied = t; } } } });
	menus[menus.length - 1].items[3].cb!(); await new Promise((r) => setTimeout(r, 10));
	assert.match(copied, /\(Genesis 1:1\)$/);
	assert.ok(!copied.includes("In contrast to others"), "footnote text left out of copies");
	menus[menus.length - 1].items[5].cb!(); await new Promise((r) => setTimeout(r, 10));
	assert.equal(copied, "[Genesis 1:1](https://www.sefaria.org/Genesis.1.1)");

	// next chapter, then back
	click(el.querySelector(".sefaria-footnext")!);
	await new Promise((r) => setTimeout(r, 3000));
	assert.equal(el.querySelector(".sefaria-title")!.textContent, "Genesis 2");
	await view.go(-1);
	assert.equal(el.querySelector(".sefaria-title")!.textContent, "Genesis 1:3");
	assert.deepEqual(view.getState(), { entry: { kind: "text", ref: "Genesis 1:3" } });

	// settings: Hebrew only, cantillation on
	plugin.settings.layout = "he"; plugin.settings.showCantillation = true;
	plugin.settings.hebrewFont = "custom"; plugin.settings.customHebrewFont = 'SBL Hebrew"; x';
	view.applySettings(); await new Promise((r) => setTimeout(r, 200));
	assert.ok(el.classList.contains("sefaria-layout-he") && !el.classList.contains("sefaria-layout-stacked"));
	assert.ok(/[֑-֯]/.test(el.querySelector(".sefaria-he")!.textContent!));

	assert.ok(el.classList.contains("sefaria-hefont-custom") && !el.classList.contains("sefaria-hefont-taamey"));
	assert.equal(el.style.getPropertyValue("--sefaria-he-custom"), '"SBL Hebrew x"', "quotes and semicolons are stripped");

	// text size sliders: live CSS update, no re-render, saved once after dragging
	let saves = 0;
	plugin.saveSettings = async () => { saves++; view.applySettings(); };
	const firstSeg = el.querySelector(".sefaria-seg");
	click(el.querySelector('[data-icon="a-large-small"]')!);
	assert.notEqual((el.querySelector(".sefaria-size") as HTMLElement).style.display, "none");
	const heSlider = el.querySelector('.sefaria-size input[aria-label="Hebrew text size"]') as HTMLInputElement;
	assert.equal(heSlider.value, "20");
	for (const v of ["24", "28", "31"]) { heSlider.value = v; heSlider.dispatchEvent(new dom.window.Event("input")); }
	assert.equal(el.style.getPropertyValue("--sefaria-he-size"), "31px");
	assert.equal(plugin.settings.hebrewSize, 31);
	assert.equal(heSlider.nextElementSibling!.textContent, "31");
	await new Promise((r) => setTimeout(r, 600));
	assert.equal(saves, 1, "debounced to one save");
	assert.equal(el.querySelector(".sefaria-seg"), firstSeg, "passage not re-rendered");

	// external link goes to the browser, not back into the reader
	click(el.querySelector(".sefaria-external")!);
	assert.equal(opened[opened.length - 1], "https://www.sefaria.org/Genesis.1.3");
});

test("View: free text becomes a reference, a book page, or search results", async () => {
	const { view, el } = makeView();
	await view.onOpen();
	await view.openQuery("brachot 2a");
	assert.equal(el.querySelector(".sefaria-title")!.textContent, "Berakhot 2a");

	await view.openQuery("https://www.sefaria.org/Pirkei_Avot.1.2?lang=bi");
	assert.equal(el.querySelector(".sefaria-title")!.textContent, "Pirkei Avot 1:2");
	assert.equal(q(el, ".is-highlight").length, 1);

	await view.openQuery("Berakhot");
	assert.equal(el.querySelector(".sefaria-title")!.textContent, "Berakhot");
	const grid = q(el, ".sefaria-grid a");
	assert.equal(grid[0].textContent, "2a"); assert.equal(grid[grid.length - 1].textContent, "64a");

	await view.openQuery("Zohar");
	assert.ok(q(el, ".sefaria-toc-node").length > 3, "complex book shows a contents tree");

	await view.openQuery("love your neighbor as yourself");
	assert.match(el.querySelector(".sefaria-results-head")!.textContent!, /results for/);
	const results = q(el, ".sefaria-result");
	assert.ok(results.length >= 5);
	const firstRef = results[0].getAttribute("data-open-ref")!;
	click(results[0]); await new Promise((r) => setTimeout(r, 4000));
	assert.ok(q(el, ".sefaria-seg.is-highlight").some((s) => s.dataset.ref === firstRef), "clicked hit is highlighted in context");

	await view.openRef("Nonexistent 3");
	assert.ok(el.querySelector(".sefaria-error"));
});

test("View: library browsing and suggestions", async () => {
	const { view, el } = makeView();
	await view.onOpen();
	click(el.querySelector('[data-icon="library"]')!); await new Promise((r) => setTimeout(r, 6000));
	const cats = q(el, ".sefaria-list-item.is-category").map((a) => a.querySelector(".sefaria-list-en")!.textContent);
	assert.ok(cats.includes("Tanakh") && cats.includes("Midrash"));
	click(q(el, ".sefaria-list-item.is-category")[0]); await new Promise((r) => setTimeout(r, 200));
	click(q(el, ".sefaria-list-item.is-category")[0]); await new Promise((r) => setTimeout(r, 200));
	assert.equal(el.querySelector(".sefaria-list-item .sefaria-list-en")!.textContent, "Genesis");
	click(el.querySelector(".sefaria-list-item")!); await new Promise((r) => setTimeout(r, 3000));
	assert.equal(q(el, ".sefaria-grid a").length, 50);

	const input = el.querySelector("input")!;
	input.value = "shabbat 31a";
	input.dispatchEvent(new dom.window.Event("input")); await new Promise((r) => setTimeout(r, 3000));
	let items = q(el, ".sefaria-suggest-item").map((i) => i.textContent);
	assert.equal(items[0], "Shabbat 31a"); assert.match(items[items.length - 1]!, /^Search all texts/);
	input.value = "hillel golden rule";
	input.dispatchEvent(new dom.window.Event("input")); await new Promise((r) => setTimeout(r, 3000));
	items = q(el, ".sefaria-suggest-item").map((i) => i.textContent);
	assert.match(items[0]!, /^Search all texts/);
	input.value = "shabbat 31a";
	input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter" })); await new Promise((r) => setTimeout(r, 4000));
	assert.equal(el.querySelector(".sefaria-title")!.textContent, "Shabbat 31a");

	// snapshot for visual inspection
	mkdirSync("/tmp/snap", { recursive: true });
	writeFileSync("/tmp/snap/talmud.html", el.outerHTML);
});
