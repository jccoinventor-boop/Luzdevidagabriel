import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createHandler } from "./handler.mjs";

const handler = createHandler({
  getEnv: (key: string) => Deno.env.get(key),
  fetchFn: fetch
});

Deno.serve(handler);
