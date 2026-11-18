/**
 * Pure logic: Sefaria URL handling, Hebrew mark stripping, and turning
 * API responses into a flat list of displayable segments.
 */
import type { Jagged, SchemaNode, SefariaApi, TextResponse, TextVersion } from "./api";

const SEFARIA_HOSTS = new Set(["sefaria.org", "www.sefaria.org", "sefaria.org.il", "www.sefaria.org.il"]);

/** First path segments on sefaria.org that are site pages, not texts. */
const RESERVED = new Set([
	"sheets", "topics", "texts", "collections", "profile", "search", "static", "api", "login", "logout",
	"register", "settings", "calendars", "community", "about", "help", "donate", "mobile", "notifications",
	"updates", "people", "person", "translations", "visualizations", "explore", "my", "account", "newsletter",
	"jobs", "team", "products", "developers", "educators", "ways-to-give", "torah-tab", "modtools", "activity",
	"daf-yomi", "terms", "privacy-policy", "metrics", "digitized-by-sefaria", "supporters", "testimonials",
	"remote-learning", "pesach", "enable_new_editor", "interface", "sefaria", "saved", "history", "plans",
	"texts-saved", "garden", "vgarden", "random", "add", "edit", "translate", "compare", "linker", "embed",
]);

/**
 * If `url` points at a text on sefaria.org, return the ref in Sefaria's URL
 * form (e.g. "Genesis.1.1"), which the API accepts directly. Otherwise null.
 */
export function parseSefariaUrl(url: string): string | null {
	let u: URL;
	try {
		u = new URL(url.trim());
	} catch {
		return null;
	}
	if (u.protocol !== "https:" && u.protocol !== "http:") return null;
	if (!SEFARIA_HOSTS.has(u.hostname.toLowerCase())) return null;
	const first = u.pathname.split("/").filter(Boolean)[0];
	if (!first) return null;
	let ref: string;
	try {
		ref = decodeURIComponent(first);
	} catch {
		return null;
	}
	if (RESERVED.has(ref.toLowerCase())) return null;
	return ref;
}

/** Canonical sefaria.org URL for a human-readable ref such as "Genesis 1:3-5". */
export function sefariaUrl(ref: string): string {
	let s = ref.trim().replace(/ /g, "_").replace(/:/g, ".");
	const last = s.lastIndexOf("_");
	// "Mishneh_Torah,_Mourning_14.1" -> "Mishneh_Torah,_Mourning.14.1" (only when the tail is an address)
	if (last > -1 && /^\d/.test(s.slice(last + 1))) s = s.slice(0, last) + "." + s.slice(last + 1);
	return "https://www.sefaria.org/" + encodeURI(s).replace(/\?/g, "%3F").replace(/#/g, "%23");
}

/**
 * Copyable text of a rendered segment: footnotes dropped; line breaks (poetry, e.g. JPS
 * prophets and Psalms) kept as newlines, so copied poetry keeps its lines as on Sefaria.
 */
export function plainTextOf(el: Element | null): string {
	if (!el) return "";
	const clone = el.cloneNode(true) as Element;
	clone.querySelectorAll(".footnote, .footnote-marker").forEach((n) => n.remove());
	// <br> becomes a marker first, so newlines that are only whitespace in the HTML source stay spaces
	const BREAK = "\u0001";
	clone.querySelectorAll("br").forEach((n) => n.replaceWith(BREAK));
	return (clone.textContent ?? "")
		.split(BREAK)
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.join("\n");
}

/** Markdown link whose text is the reference in parentheses: [(Hosea 12:14)](https://www.sefaria.org/Hosea.12.14) */
export function referenceLink(ref: string): string {
	return `[(${ref})](${sefariaUrl(ref)})`;
}

/** Hebrew, English and the linked reference, one per line (empty parts skipped). */
export function textWithReference(he: string, en: string, ref: string): string {
	return [he, en, ref ? referenceLink(ref) : ""].filter(Boolean).join("\n");
}

const CANTILLATION = /[֑-֯]/g;
const VOWELS = /[ְ-ׇֽֿׁׂׅׄ]/g;

export function stripHebrewMarks(text: string, keepVowels: boolean, keepCantillation: boolean): string {
	let out = text;
	if (!keepCantillation) out = out.replace(CANTILLATION, "");
	if (!keepVowels) out = out.replace(VOWELS, "");
	return out;
}

export interface Segment {
	/** Full ref of this segment, e.g. "Genesis 1:3". */
	ref: string;
	/** Short label within its section, e.g. "3" or "1:2". */
	label: string;
	/** Raw HTML from Sefaria. */
	he: string;
	en: string;
}

export interface VersionInfo {
	language: string;
	title: string;
	license: string;
	source: string;
}

export interface SectionBlock {
	ref: string;
	heRef: string;
	segments: Segment[];
}

export interface Passage {
	/** The ref as the user asked for it (normalised by Sefaria). */
	ref: string;
	heRef: string;
	book: string;
	blocks: SectionBlock[];
	/** Refs of segments the request pointed at specifically. */
	highlight: Set<string>;
	prev: string | null;
	next: string | null;
	versions: VersionInfo[];
}

function pick(versions: TextVersion[], lang: string): TextVersion | undefined {
	return versions.find((v) => v.language === lang);
}

function nonEmpty(s: unknown): s is string {
	return typeof s === "string" && s.trim().length > 0;
}

/** Flatten the (possibly nested) text of a section-level response into segments. */
export function flattenSection(data: TextResponse): Segment[] {
	const he = pick(data.versions, "he")?.text;
	const en = pick(data.versions, "en")?.text;
	const out: Segment[] = [];
	const base = data.ref;
	// A ref with no address ("Siddur Ashkenaz, ..., Modeh Ani") takes its first number after a space.
	const firstSep = data.sections.length === 0 ? " " : ":";

	const walk = (h: Jagged | undefined, e: Jagged | undefined, ref: string, sep: string) => {
		const hArr = Array.isArray(h) ? h : null;
		const eArr = Array.isArray(e) ? e : null;
		if (!hArr && !eArr) {
			if (nonEmpty(h) || nonEmpty(e)) {
				out.push({
					ref,
					label: ref.length > base.length ? ref.slice(base.length + 1) : "",
					he: nonEmpty(h) ? h : "",
					en: nonEmpty(e) ? e : "",
				});
			}
			return;
		}
		const n = Math.max(hArr?.length ?? 0, eArr?.length ?? 0);
		for (let i = 0; i < n; i++) {
			walk(hArr?.[i], eArr?.[i], ref + sep + (i + 1), ":");
		}
	};
	walk(he, en, base, firstSep);
	return out;
}

function versionInfos(data: TextResponse): VersionInfo[] {
	return data.versions
		.filter((v) => v.language === "he" || v.language === "en")
		.map((v) => ({
			language: v.language,
			title: v.versionTitle,
			license: v.license ?? "",
			source: v.versionSource ?? "",
		}));
}

interface Single {
	block: SectionBlock;
	highlight: string[];
	section: TextResponse;
}

/** Load the section containing `d` and work out which segments `d` singles out. */
async function loadSingle(api: SefariaApi, d: TextResponse): Promise<Single> {
	const segmentLevel = d.textDepth > 0 && d.sections.length >= d.textDepth;
	let section = d;
	const highlight: string[] = [];
	if (segmentLevel && d.sectionRef && d.sectionRef !== d.ref) {
		section = await api.getText(d.sectionRef);
	}
	const segments = flattenSection(section);
	if (segmentLevel && section !== d) {
		const from = parseInt(d.sections[d.sections.length - 1], 10);
		const to = parseInt(d.toSections[d.toSections.length - 1] ?? "", 10);
		if (!isNaN(from)) {
			const end = isNaN(to) ? from : Math.max(from, to);
			const sep = section.sections.length === 0 ? " " : ":";
			for (let i = from; i <= end; i++) highlight.push(section.ref + sep + i);
		}
	}
	return {
		block: { ref: section.ref, heRef: section.heRef, segments },
		highlight,
		section,
	};
}

const MAX_SPAN = 12;

/**
 * Resolve any ref (book, section, segment, range, spanning range) into
 * whole sections ready for display, with the requested segments marked.
 */
export async function loadPassage(api: SefariaApi, ref: string): Promise<Passage> {
	let d = await api.getText(ref);

	// Book- or node-level ref of a multi-level text: show its first section rather than the whole book.
	if (
		d.sections.length === 0 &&
		d.textDepth > 1 &&
		d.firstAvailableSectionRef &&
		d.firstAvailableSectionRef !== d.ref
	) {
		d = await api.getText(d.firstAvailableSectionRef);
	}

	let singles: Single[];
	if (d.isSpanning && d.spanningRefs && d.spanningRefs.length > 0) {
		const parts = await Promise.all(d.spanningRefs.slice(0, MAX_SPAN).map((r) => api.getText(r)));
		singles = await Promise.all(parts.map((p) => loadSingle(api, p)));
	} else {
		singles = [await loadSingle(api, d)];
	}

	const first = singles[0].section;
	const last = singles[singles.length - 1].section;
	const versions: VersionInfo[] = [];
	for (const s of singles) {
		for (const v of versionInfos(s.section)) {
			if (!versions.some((x) => x.language === v.language && x.title === v.title)) versions.push(v);
		}
	}
	return {
		ref: d.ref,
		heRef: d.heRef,
		book: d.indexTitle || d.book,
		blocks: singles.map((s) => s.block),
		highlight: new Set(singles.flatMap((s) => s.highlight)),
		prev: first.prev ?? null,
		next: last.next ?? null,
		versions,
	};
}

export interface ContentsEntry {
	label: string;
	heLabel?: string;
	/** Ref to open when clicked; undefined for pure headings. */
	ref?: string;
	/** Numbered sections directly under this entry (chapters, dapim, simanim). */
	sections?: { label: string; ref: string }[];
	children?: ContentsEntry[];
}

/** Labels of the top-level sections of a text node, e.g. 1..50 or 2a..64a. */
export function sectionLabels(node: SchemaNode): string[] {
	const count = node.lengths?.[0];
	if (!count || (node.depth ?? 0) < 2) return [];
	const type = node.addressTypes?.[0];
	const labels: string[] = [];
	if (type === "Talmud") {
		// index 0 = 1a, 1 = 1b, 2 = 2a ...; printed tractates start at 2a
		for (let i = 2; i < count; i++) labels.push(`${Math.floor(i / 2) + 1}${i % 2 === 0 ? "a" : "b"}`);
	} else if (type === "Folio") {
		return [];
	} else {
		for (let i = 1; i <= count; i++) labels.push(String(i));
	}
	return labels;
}

/** Turn a book's schema into a navigable contents tree. */
export function buildContents(node: SchemaNode, parentRef: string | null): ContentsEntry {
	const isRoot = parentRef === null;
	const ownTitle = node.default ? "" : node.title ?? "";
	const ref = isRoot ? ownTitle : ownTitle ? `${parentRef}, ${ownTitle}` : parentRef;
	const entry: ContentsEntry = {
		label: ownTitle || (node.sectionNames?.[0] ? node.sectionNames[0] + "s" : "Text"),
		heLabel: node.heTitle,
	};
	if (node.nodes && node.nodes.length > 0) {
		entry.children = node.nodes.map((n) => buildContents(n, ref));
	} else {
		entry.ref = ref;
		const labels = sectionLabels(node);
		if (labels.length > 0) entry.sections = labels.map((l) => ({ label: l, ref: `${ref} ${l}` }));
	}
	return entry;
}
