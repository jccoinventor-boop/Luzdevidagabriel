import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const DEFAULT_SUPABASE_URL = "https://bakcrmthmbbdnqmktfhy.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_91uUIn4MaVGlMscsRS9d-Q_7KzMF7SQ";

function publicSupabaseConfig() {
  const rawUrl = String(process.env.PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim().replace(/\/+$/, "");
  const key = String(process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY).trim();
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("PUBLIC_SUPABASE_URL no es una URL válida");
  }
  if (url.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/i.test(url.hostname) || url.pathname !== "/") {
    throw new Error("PUBLIC_SUPABASE_URL debe ser el origen HTTPS de un proyecto Supabase");
  }
  if (!/^(?:sb_publishable_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(key)) {
    throw new Error("PUBLIC_SUPABASE_PUBLISHABLE_KEY no tiene un formato público válido");
  }
  return {
    api: `${url.origin}/functions/v1/gabriel-public-api`,
    key
  };
}

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
const publicConfig = publicSupabaseConfig();
const appPath = "dist/app.js";
const appSource = await readFile(appPath, "utf8");
const configuredApp = appSource
  .replace("__GABRIEL_PUBLIC_API_URL__", publicConfig.api)
  .replace("__GABRIEL_PUBLIC_API_KEY__", publicConfig.key);
if (configuredApp.includes("__GABRIEL_PUBLIC_API_")) {
  throw new Error("No se pudo configurar la API pública del sitio");
}
await writeFile(appPath, configuredApp);
const candidate = process.env.COMMIT_REF || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || "local";
const release = /^[0-9a-f]{7,40}$/i.test(candidate) ? candidate.toLowerCase() : "local";
const context = String(process.env.CONTEXT || process.env.VERCEL_ENV || "local").slice(0, 40);
await writeFile("dist/release.json", `${JSON.stringify({ status: "ok", release, context }, null, 2)}\n`);
console.log("Sitio generado en dist/");
