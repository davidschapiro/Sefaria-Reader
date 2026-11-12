# Sefaria Reader

Read Jewish texts from the [Sefaria](https://www.sefaria.org) library in an Obsidian sidebar, in Hebrew and English, next to the note you are writing.

This is an unofficial plugin. It is not affiliated with or endorsed by Sefaria.

## What it does

- **Opens Sefaria links in the sidebar.** Click a `sefaria.org` text link in a note and the passage opens in the reader instead of the browser. The linked verse or line is highlighted in the context of its whole chapter or page.
- **Search bar.** Type a reference (`Berakhot 2a`, `Genesis 1:1-5`, `בראשית א`), a title, or any words. A reference opens directly, a title opens the book's contents, and anything else runs a full-text search with a results list to pick from.
- **Library browser.** Walk the categories down to a book and pick a chapter, daf or siman.
- **Layouts.** Hebrew above English, side by side, Hebrew only, or English only.
- **Hebrew fonts:** Taamey Frank (the font Sefaria uses) and Noto Sans Hebrew are bundled, so Hebrew looks the same on every device. You can also use your theme font or any installed font.
- **Text size:** the Aa button in the reader opens sliders for Hebrew and English; changes apply instantly and keep your place.
- **Vowels and cantillation** can each be switched off. Text you copy matches what is displayed.
- **Copy helpers.** Click a segment number (or right-click a segment) to copy the Hebrew, the English, both, the reference, or a Markdown link. Ordinary select-and-copy works too.
- **Footnotes** in translations expand when you click their marker.

## Usage

- Ribbon icon or command **Sefaria Reader: Open reader**.
- Command **Sefaria Reader: Open selection or link at cursor**, also in the editor's right-click menu when text is selected.
- `obsidian://sefaria?ref=Genesis.1.1` opens a reference from outside Obsidian.
- Links to Sefaria sheets, topics and other site pages still open in the browser. Link interception can be turned off in the settings.

## Network use

The plugin needs an internet connection. It sends requests only to `https://www.sefaria.org/api/` (texts, name lookup, search, table of contents). No account, no API key, no telemetry. Nothing is written to your vault.

## Text licenses

Texts and translations belong to their respective rights holders. The version title and license of what you are reading are shown at the foot of each passage; follow them when you reuse text.

## Installing

From Obsidian: Settings → Community plugins → Browse → search for "Sefaria Reader" (once it is listed).

By hand: copy `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/sefaria-reader/`, then enable **Sefaria Reader** under Settings → Community plugins.

## Credits and licenses

- Plugin code: MIT, see `LICENSE`.
- Bundled fonts (embedded in `styles.css`, subset to Hebrew):
  - Taamey Frank CLM, © 2009–2010 Yoram Gnat, [Culmus project](https://culmus.sourceforge.io/), GNU GPL v2.
  - Noto Sans Hebrew, © 2024 The Noto Project Authors, SIL Open Font License 1.1.
- Texts: from the Sefaria library via its public API, each under its own license.

## Releasing

Bump `version` in `manifest.json` and `package.json`, add it to `versions.json`, update `RELEASE_NOTES.md`, and push to `main`. The Release workflow builds, tests and publishes the GitHub release automatically.

## Development

```
npm install --legacy-peer-deps
npm run dev        # watch build
npm run build      # type-check and production build
npx eslint src     # Obsidian's review rules
npm test           # offline logic tests
npm run test:live  # also tests against the live Sefaria API and renders the view in jsdom
```

## Roadmap

- Commentaries and cross-references for a selected segment
- Choice of translation and source version
