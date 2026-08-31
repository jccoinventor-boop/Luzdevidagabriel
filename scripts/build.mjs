import { cp, mkdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
const candidate = process.env.COMMIT_REF || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local";
const release = /^[0-9a-f]{7,40}$/i.test(candidate) ? candidate.toLowerCase() : "local";
const context = String(process.env.CONTEXT || process.env.VERCEL_ENV || "local").slice(0, 40);
await writeFile("dist/release.json", `${JSON.stringify({ status: "ok", release, context }, null, 2)}\n`);
console.log("Sitio generado en dist/");
