/**
 * Thin client for the public Sefaria API (https://developers.sefaria.org).
 * Transport is injected so the same code runs inside Obsidian (requestUrl)
 * and in Node tests (fetch).
 */

export interface HttpRequest {
	url: string;
	method?: "GET" | "POST";
	body?: string;
}
export interface HttpResponse {
	status: number;
	text: string;
}
export type Http = (req: HttpRequest) => Promise<HttpResponse>;

export type Jagged = string | Jagged[];

export interface TextVersion {
	language: string;
	actualLanguage?: string;
	versionTitle: string;
	versionSource?: string;
	license?: string;
	direction?: string;
	text: Jagged;
}

export interface TextResponse {
	ref: string;
	heRef: string;
	sectionRef: string;
	firstAvailableSectionRef?: string;
	sections: string[];
	toSections: string[];
	textDepth: number;
	isSpanning?: boolean;
	spanningRefs?: string[] | null;
	next: string | null;
	prev: string | null;
	book: string;
	indexTitle: string;
	heIndexTitle?: string;
	primary_category?: string;
	versions: TextVersion[];
}

export interface NameCompletion {
	title: string;
	key: string;
	type: string;
}

export interface NameResponse {
	is_ref: boolean;
	is_book?: boolean;
	ref?: string;
	book?: string;
	completion_objects?: NameCompletion[];
}

export interface SearchHit {
	ref: string;
	heRef: string;
	version: string;
	lang: string;
	path: string;
	snippet: string;
}

export interface SearchPage {
	total: number;
	hits: SearchHit[];
}

export interface TocNode {
	category?: string;
	heCategory?: string;
	title?: string;
	heTitle?: string;
	enShortDesc?: string;
	contents?: TocNode[];
}

export interface SchemaNode {
	nodeType?: string;
	title?: string;
	heTitle?: string;
	key?: string;
	default?: boolean;
	depth?: number;
	lengths?: number[];
	addressTypes?: string[];
	sectionNames?: string[];
	nodes?: SchemaNode[];
}

export interface IndexRecord {
	title: string;
	heTitle?: string;
	categories?: string[];
	enShortDesc?: string;
	schema: SchemaNode;
}

export class SefariaError extends Error {
	status?: number;
	/** True when Sefaria refused a book-level ref because the book has a complex structure. */
	complexBook: boolean;
	constructor(message: string, status?: number) {
		super(message);
		this.name = "SefariaError";
		this.status = status;
		this.complexBook = /complex/i.test(message) && /book-level/i.test(message);
	}
}

const MAX_CACHE = 60;

export class SefariaApi {
	private textCache = new Map<string, TextResponse>();
	private indexCache = new Map<string, IndexRecord>();
	private library: TocNode[] | null = null;

	constructor(
		private http: Http,
		private base = "https://www.sefaria.org"
	) {}

	private async json<T>(path: string, body?: unknown): Promise<T> {
		let res: HttpResponse;
		try {
			res = await this.http({
				url: this.base + path,
				method: body === undefined ? "GET" : "POST",
				body: body === undefined ? undefined : JSON.stringify(body),
			});
		} catch (e) {
			throw new SefariaError(
				"Could not reach Sefaria. Check your internet connection. (" +
					(e instanceof Error ? e.message : String(e)) +
					")"
			);
		}
		let data: unknown;
		try {
			data = JSON.parse(res.text);
		} catch {
			throw new SefariaError(`Sefaria returned an unexpected response (HTTP ${res.status}).`, res.status);
		}
		if (data && typeof data === "object" && !Array.isArray(data)) {
			const err = (data as { error?: unknown }).error;
			if (typeof err === "string") throw new SefariaError(err, res.status);
		}
		if (res.status >= 400) throw new SefariaError(`Sefaria returned HTTP ${res.status}.`, res.status);
		return data as T;
	}

	/** Source text plus the default English translation for a ref. */
	async getText(ref: string): Promise<TextResponse> {
		const key = ref.trim();
		const hit = this.textCache.get(key);
		if (hit) {
			// refresh LRU position
			this.textCache.delete(key);
			this.textCache.set(key, hit);
			return hit;
		}
		const data = await this.json<TextResponse>(
			`/api/v3/texts/${encodeURIComponent(key)}?version=source&version=english`
		);
		if (!data || !Array.isArray(data.versions)) {
			throw new SefariaError(`No text found for “${ref}”.`);
		}
		this.textCache.set(key, data);
		if (this.textCache.size > MAX_CACHE) {
			const oldest = this.textCache.keys().next().value;
			if (oldest !== undefined) this.textCache.delete(oldest);
		}
		return data;
	}

	/** Parse free text as a ref and return title completions. */
	async resolveName(query: string, limit = 8): Promise<NameResponse> {
		return this.json<NameResponse>(`/api/name/${encodeURIComponent(query.trim())}?limit=${limit}`);
	}

	/** Full-text search across the library. */
	async search(query: string, start = 0, size = 20): Promise<SearchPage> {
		interface Raw {
			hits?: {
				total?: number | { value?: number };
				hits?: {
					_source?: Partial<SearchHit>;
					highlight?: Record<string, string[]>;
				}[];
			};
		}
		const raw = await this.json<Raw>("/api/search-wrapper", {
			query,
			type: "text",
			field: "naive_lemmatizer",
			slop: 10,
			start,
			size,
			source_proj: ["ref", "heRef", "version", "lang", "path"],
			sort_method: "score",
			sort_fields: ["pagesheetrank"],
		});
		const total = raw.hits?.total;
		const hits = (raw.hits?.hits ?? [])
			.filter((h) => h._source?.ref)
			.map((h) => {
				const s = h._source ?? {};
				const hl = h.highlight ? Object.values(h.highlight)[0] ?? [] : [];
				return {
					ref: s.ref ?? "",
					heRef: s.heRef ?? "",
					version: s.version ?? "",
					lang: s.lang ?? "",
					path: s.path ?? "",
					snippet: hl.join(" … "),
				};
			});
		return {
			total: typeof total === "number" ? total : total?.value ?? hits.length,
			hits,
		};
	}

	/** The full table of contents (about 4 MB; fetched once per session). */
	async getLibrary(): Promise<TocNode[]> {
		if (!this.library) this.library = await this.json<TocNode[]>("/api/index");
		return this.library;
	}

	/** Index record (structure) of a single book. */
	async getIndex(title: string): Promise<IndexRecord> {
		const hit = this.indexCache.get(title);
		if (hit) return hit;
		const data = await this.json<IndexRecord>(`/api/v2/index/${encodeURIComponent(title)}`);
		if (!data || !data.schema) throw new SefariaError(`No book found for “${title}”.`);
		this.indexCache.set(title, data);
		return data;
	}
}
