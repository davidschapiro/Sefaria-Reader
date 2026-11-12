// Bundles the TypeScript tests with esbuild and runs them with node:test.
// `node test/run.mjs`       offline logic tests
// `node test/run.mjs live`  also tests against the real Sefaria API and renders the view in jsdom
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const live = process.argv[2] === "live";
const entries = [path.join(here, "logic.test.ts")];
if (live) entries.push(path.join(here, "live.test.ts"));

await esbuild.build({
	entryPoints: entries,
	bundle: true,
	platform: "node",
	format: "esm",
	outdir: path.join(here, "..", ".test-build"),
	outExtension: { ".js": ".mjs" },
	alias: { obsidian: path.join(here, "obsidian-stub.ts") },
	external: ["jsdom", "node:*"],
	logLevel: "warning",
});
const files = entries.map((e) => path.join(here, "..", ".test-build", path.basename(e).replace(/\.ts$/, ".mjs")));
const res = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(res.status ?? 1);
