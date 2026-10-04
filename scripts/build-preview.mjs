/**
 * Builds preview/dist/deflink-preview.html — a single self-contained, interactive preview
 * of the app (React + production components + compiled Tailwind, DEMO data, no server).
 */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const js = await build({
  entryPoints: ["preview/App.tsx"],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  jsx: "automatic",
  write: false,
  tsconfig: "tsconfig.json",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  logOverride: { "unsupported-directive": "silent" },
});
const cssSrc = await readFile("preview/preview.css", "utf8");
const css = await postcss([tailwind({ optimize: { minify: true } })]).process(cssSrc, { from: "preview/preview.css" });

const script = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<title>DefLink App Preview</title>
<meta name="description" content="Interactive preview of DefLink with fictional DEMO data.">
<style>${css.css}</style>
<div id="app"></div>
<script>${script}</script>
`;
await mkdir("preview/dist", { recursive: true });
await writeFile("preview/dist/deflink-preview.html", html);
console.log(`preview/dist/deflink-preview.html — ${(html.length / 1024).toFixed(0)} KB`);
