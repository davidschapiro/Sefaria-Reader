import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
		// The community review runs these too; recommended doesn't enable them.
		rules: {
			"obsidianmd/no-unsupported-api": "error",
		},
	},
	{ ignores: ["main.js", "node_modules/", "test/", ".test-build/", "*.mjs"] },
]);
