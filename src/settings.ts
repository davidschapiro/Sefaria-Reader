import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type SefariaReaderPlugin from "./main";

export type Layout = "stacked" | "side" | "he" | "en";
export type HebrewFont = "taamey" | "sans" | "theme" | "custom";

export const HEBREW_FONTS: { id: HebrewFont; label: string }[] = [
	{ id: "taamey", label: "Taamey Frank (as on Sefaria)" },
	{ id: "sans", label: "Noto Sans Hebrew (sans-serif)" },
	{ id: "theme", label: "Same as your Obsidian text font" },
	{ id: "custom", label: "Custom (an installed font)" },
];

export const LAYOUTS: { id: Layout; label: string }[] = [
	{ id: "stacked", label: "Hebrew above English" },
	{ id: "side", label: "Side by side" },
	{ id: "he", label: "Hebrew only" },
	{ id: "en", label: "English only" },
];

export interface SefariaReaderSettings {
	layout: Layout;
	hebrewFont: HebrewFont;
	customHebrewFont: string;
	hebrewSize: number;
	englishSize: number;
	showVowels: boolean;
	showCantillation: boolean;
	interceptLinks: boolean;
}

export const DEFAULT_SETTINGS: SefariaReaderSettings = {
	layout: "stacked",
	hebrewFont: "taamey",
	customHebrewFont: "",
	hebrewSize: 20,
	englishSize: 15,
	showVowels: true,
	showCantillation: false,
	interceptLinks: true,
};

export class SefariaSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: SefariaReaderPlugin
	) {
		super(app, plugin);
	}

	/** Declarative settings (Obsidian 1.13+): rendered by Obsidian and included in settings search. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;
		const options = (list: { id: string; label: string }[]) =>
			Object.fromEntries(list.map((x) => [x.id, x.label]));
		return [
			{
				name: "Open Sefaria links in the reader",
				desc:
					"Clicking a sefaria.org text link in a note opens it in the sidebar instead of the browser. " +
					"Links to sheets, topics and other site pages still open in the browser.",
				control: { type: "toggle", key: "interceptLinks" },
			},
			{
				name: "Layout",
				desc: "How Hebrew and English are arranged.",
				control: { type: "dropdown", key: "layout", options: options(LAYOUTS) },
			},
			{
				name: "Hebrew font",
				desc: "Taamey Frank and Noto Sans Hebrew come with the plugin and support vowels and cantillation.",
				aliases: ["typeface"],
				control: { type: "dropdown", key: "hebrewFont", options: options(HEBREW_FONTS) },
			},
			{
				name: "Custom Hebrew font",
				desc: "Name of a font installed on this device, for example SBL Hebrew or Frank Ruehl CLM.",
				visible: () => s.hebrewFont === "custom",
				control: { type: "text", key: "customHebrewFont", placeholder: "Font name" },
			},
			{
				name: "Show vowels",
				desc: "Display nikud in Hebrew text. Copied text matches what is displayed.",
				aliases: ["nikud", "niqqud"],
				control: { type: "toggle", key: "showVowels" },
			},
			{
				name: "Show cantillation marks",
				desc: "Display te'amim in biblical text. Copied text matches what is displayed.",
				aliases: ["te'amim", "trope", "accents"],
				control: { type: "toggle", key: "showCantillation" },
			},
			{
				name: "Hebrew text size",
				aliases: ["font size"],
				control: { type: "slider", key: "hebrewSize", min: 12, max: 40, step: 1 },
			},
			{
				name: "English text size",
				aliases: ["font size"],
				control: { type: "slider", key: "englishSize", min: 10, max: 30, step: 1 },
			},
		];
	}

	getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		s[key] = key === "customHebrewFont" && typeof value === "string" ? value.trim() : value;
		await this.plugin.saveSettings();
		// show or hide the custom font field
		if (key === "hebrewFont") this.update();
	}

	/** Fallback for Obsidian versions before 1.13. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = async () => {
			await this.plugin.saveSettings();
		};

		new Setting(containerEl)
			.setName("Open Sefaria links in the reader")
			.setDesc(
				"Clicking a sefaria.org text link in a note opens it in the sidebar instead of the browser. " +
					"Links to sheets, topics and other site pages still open in the browser."
			)
			.addToggle((t) =>
				t.setValue(s.interceptLinks).onChange(async (v) => {
					s.interceptLinks = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName("Layout")
			.setDesc("How Hebrew and English are arranged.")
			.addDropdown((d) => {
				for (const l of LAYOUTS) d.addOption(l.id, l.label);
				d.setValue(s.layout).onChange(async (v) => {
					s.layout = v as Layout;
					await save();
				});
			});

		new Setting(containerEl)
			.setName("Hebrew font")
			.setDesc("Taamey Frank and Noto Sans Hebrew come with the plugin and support vowels and cantillation.")
			.addDropdown((d) => {
				for (const f of HEBREW_FONTS) d.addOption(f.id, f.label);
				d.setValue(s.hebrewFont).onChange(async (v) => {
					s.hebrewFont = v as HebrewFont;
					await save();
					this.display();
				});
			});

		if (s.hebrewFont === "custom") {
			new Setting(containerEl)
				.setName("Custom Hebrew font")
				.setDesc("Name of a font installed on this device, for example SBL Hebrew or Frank Ruehl CLM.")
				.addText((t) =>
					t
						.setPlaceholder("Font name")
						.setValue(s.customHebrewFont)
						.onChange(async (v) => {
							s.customHebrewFont = v.trim();
							await save();
						})
				);
		}

		new Setting(containerEl)
			.setName("Show vowels")
			.setDesc("Display nikud in Hebrew text. Copied text matches what is displayed.")
			.addToggle((t) =>
				t.setValue(s.showVowels).onChange(async (v) => {
					s.showVowels = v;
					await save();
				})
			);

		new Setting(containerEl)
			.setName("Show cantillation marks")
			.setDesc("Display te'amim in biblical text. Copied text matches what is displayed.")
			.addToggle((t) =>
				t.setValue(s.showCantillation).onChange(async (v) => {
					s.showCantillation = v;
					await save();
				})
			);

		new Setting(containerEl).setName("Hebrew text size").addSlider((sl) =>
			sl
				.setLimits(12, 40, 1)
				.setValue(s.hebrewSize)
				.onChange(async (v) => {
					s.hebrewSize = v;
					await save();
				})
		);

		new Setting(containerEl).setName("English text size").addSlider((sl) =>
			sl
				.setLimits(10, 30, 1)
				.setValue(s.englishSize)
				.onChange(async (v) => {
					s.englishSize = v;
					await save();
				})
		);
	}
}
