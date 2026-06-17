import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");

const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);

JSON.parse(manifest);

const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);

assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);

await Promise.all([
  access(resolve(projectRoot, "dist/client/index.html")),
  access(resolve(projectRoot, "dist/client/account.html")),
  access(resolve(projectRoot, "dist/client/assets/css/site.css")),
  access(resolve(projectRoot, "dist/.openai/drizzle/0001_ravene_hub_accounts.sql")),
]);

console.log("Artifact is valid and ready for hosting");
