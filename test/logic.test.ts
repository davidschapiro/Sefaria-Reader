import { test } from "node:test";
import assert from "node:assert/strict";
import { SefariaApi, TextResponse } from "../src/api";
import { buildContents, flattenSection, loadPassage, parseSefariaUrl, referenceLink, sectionLabels, sefariaUrl, stripHebrewMarks, textWithReference } from "../src/refs";

test("parseSefariaUrl accepts text links and rejects site pages", () => {
	assert.equal(parseSefariaUrl("https://www.sefaria.org/Genesis.1.1?lang=bi&with=all"), "Genesis.1.1");
	assert.equal(parseSefariaUrl("https://www.sefaria.org.il/Rashi_on_Genesis.1.1.1"), "Rashi_on_Genesis.1.1.1");
	assert.equal(parseSefariaUrl("https://sefaria.org/Mishneh_Torah%2C_Mourning.14.1"), "Mishneh_Torah,_Mourning.14.1");
	assert.equal(parseSefariaUrl("https://www.sefaria.org/Berakhot.2a.5-2b.3"), "Berakhot.2a.5-2b.3");
	assert.equal(parseSefariaUrl("https://www.sefaria.org/sheets/12345"), null);
	assert.equal(parseSefariaUrl("https://www.sefaria.org/topics/shabbat"), null);
	assert.equal(parseSefariaUrl("https://www.sefaria.org/"), null);
	assert.equal(parseSefariaUrl("https://example.org/Genesis.1"), null);
	assert.equal(parseSefariaUrl("https://evil-sefaria.org/Genesis.1"), null);
	assert.equal(parseSefariaUrl("Genesis 1:1"), null);
});

test("sefariaUrl builds canonical links", () => {
	assert.equal(sefariaUrl("Genesis 1:3"), "https://www.sefaria.org/Genesis.1.3");
	assert.equal(sefariaUrl("Genesis 1:3-2:2"), "https://www.sefaria.org/Genesis.1.3-2.2");
	assert.equal(sefariaUrl("Berakhot 2a:5"), "https://www.sefaria.org/Berakhot.2a.5");
	assert.equal(sefariaUrl("Mishneh Torah, Mourning 14:1"), "https://www.sefaria.org/Mishneh_Torah,_Mourning.14.1");
	assert.equal(sefariaUrl("Pirkei Avot"), "https://www.sefaria.org/Pirkei_Avot");
	assert.equal(parseSefariaUrl(sefariaUrl("Rashi on Genesis 1:1:1")), "Rashi_on_Genesis.1.1.1");
});

test("copy with reference links the reference to Sefaria", () => {
	assert.equal(referenceLink("Hosea 12:14"), "[(Hosea 12:14)](https://www.sefaria.org/Hosea.12.14)");
	assert.equal(
		textWithReference("וּבְנָבִיא נִשְׁמָר׃", "Through a prophet they were guarded.", "Hosea 12:14"),
		"וּבְנָבִיא נִשְׁמָר׃\nThrough a prophet they were guarded.\n[(Hosea 12:14)](https://www.sefaria.org/Hosea.12.14)"
	);
	assert.equal(textWithReference("", "Only English", "Genesis 1:1"), "Only English\n[(Genesis 1:1)](https://www.sefaria.org/Genesis.1.1)");
});

test("stripHebrewMarks removes cantillation and vowels independently", () => {
	const full = "בְּרֵאשִׁ֖ית בָּרָ֣א";
	assert.equal(stripHebrewMarks(full, true, false), "בְּרֵאשִׁית בָּרָא");
	assert.equal(stripHebrewMarks(full, false, false), "בראשית ברא");
	assert.equal(stripHebrewMarks(full, true, true), full);
	assert.equal(stripHebrewMarks("<b>אֱלֹהִ֑ים</b>", false, false), "<b>אלהים</b>");
});

function resp(over: Partial<TextResponse>): TextResponse {
	return { ref: "X 1", heRef: "", sectionRef: "X 1", sections: ["1"], toSections: ["1"], textDepth: 2, next: null, prev: null, book: "X", indexTitle: "X", versions: [], ...over };
}

test("flattenSection pairs languages and skips empty segments", () => {
	const segs = flattenSection(resp({
		ref: "Genesis 1",
		versions: [
			{ language: "he", versionTitle: "H", text: ["א", "", "ג"] },
			{ language: "en", versionTitle: "E", text: ["one", "", "three", "four"] },
		],
	}));
	assert.deepEqual(segs.map((s) => s.ref), ["Genesis 1:1", "Genesis 1:3", "Genesis 1:4"]);
	assert.deepEqual(segs.map((s) => s.label), ["1", "3", "4"]);
	assert.equal(segs[2].he, "");
	assert.equal(segs[2].en, "four");
});

test("flattenSection handles nested commentary and address-less nodes", () => {
	const rashi = flattenSection(resp({
		ref: "Rashi on Genesis 1", textDepth: 3,
		versions: [{ language: "he", versionTitle: "H", text: [["a", "b"], [], ["c"]] }],
	}));
	assert.deepEqual(rashi.map((s) => s.ref), ["Rashi on Genesis 1:1:1", "Rashi on Genesis 1:1:2", "Rashi on Genesis 1:3:1"]);
	assert.equal(rashi[2].label, "3:1");
	const node = flattenSection(resp({
		ref: "Siddur Ashkenaz, Weekday, Shacharit, Modeh Ani", sections: [], toSections: [], textDepth: 1,
		versions: [{ language: "he", versionTitle: "H", text: ["a", "b"] }],
	}));
	assert.deepEqual(node.map((s) => s.ref), ["Siddur Ashkenaz, Weekday, Shacharit, Modeh Ani 1", "Siddur Ashkenaz, Weekday, Shacharit, Modeh Ani 2"]);
});

test("loadPassage loads the whole section and highlights the requested range", async () => {
	const urls: string[] = [];
	const store: Record<string, TextResponse> = {
		"Genesis 1:2-3": resp({ ref: "Genesis 1:2-3", sectionRef: "Genesis 1", sections: ["1", "2"], toSections: ["1", "3"], versions: [{ language: "he", versionTitle: "H", text: ["b", "c"] }] }),
		"Genesis 1": resp({ ref: "Genesis 1", sectionRef: "Genesis 1", next: "Genesis 2", versions: [{ language: "he", versionTitle: "H", license: "CC0", text: ["a", "b", "c", "d"] }, { language: "en", versionTitle: "E", text: ["1", "2", "3", "4"] }] }),
	};
	const api = new SefariaApi(async (req) => {
		urls.push(req.url);
		const ref = decodeURIComponent(req.url.split("/api/v3/texts/")[1].split("?")[0]);
		return store[ref] ? { status: 200, text: JSON.stringify(store[ref]) } : { status: 404, text: JSON.stringify({ error: "nope" }) };
	});
	const p = await loadPassage(api, "Genesis 1:2-3");
	assert.equal(p.ref, "Genesis 1:2-3");
	assert.equal(p.blocks.length, 1);
	assert.equal(p.blocks[0].segments.length, 4);
	assert.deepEqual([...p.highlight], ["Genesis 1:2", "Genesis 1:3"]);
	assert.equal(p.next, "Genesis 2");
	assert.deepEqual(p.versions.map((v) => v.title), ["H", "E"]);
	await loadPassage(api, "Genesis 1");
	assert.equal(urls.length, 2, "section is served from cache the second time");
	await assert.rejects(loadPassage(api, "Nope 1"), /nope/);
});

test("sectionLabels and buildContents", () => {
	assert.deepEqual(sectionLabels({ depth: 2, lengths: [3, 40], addressTypes: ["Perek", "Pasuk"] }), ["1", "2", "3"]);
	assert.deepEqual(sectionLabels({ depth: 2, lengths: [5, 99], addressTypes: ["Talmud", "Integer"] }), ["2a", "2b", "3a"]);
	assert.deepEqual(sectionLabels({ depth: 1, lengths: [5] }), []);
	const c = buildContents({
		title: "Guide", nodes: [
			{ title: "Preface", nodeType: "JaggedArrayNode", depth: 1 },
			{ title: "Part 1", nodes: [
				{ title: "Introduction", depth: 1 },
				{ default: true, key: "default", title: "", depth: 2, lengths: [2], addressTypes: ["Perek", "Integer"], sectionNames: ["Chapter", "Paragraph"] },
			] },
		],
	}, null);
	assert.equal(c.children?.[0].ref, "Guide, Preface");
	assert.equal(c.children?.[1].children?.[0].ref, "Guide, Part 1, Introduction");
	assert.deepEqual(c.children?.[1].children?.[1].sections?.map((s) => s.ref), ["Guide, Part 1 1", "Guide, Part 1 2"]);
	assert.equal(c.children?.[1].children?.[1].label, "Chapters");
});
