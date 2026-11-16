import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

function readRuntimeEnv(env: unknown, key: string): string | undefined {
  if (!env || typeof env !== "object") return undefined;
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function writeProcessEnv(key: string, value: string | undefined) {
  if (!value || typeof process === "undefined") return;
  process.env[key] ||= value;
}

function hydrateBackendEnv(env: unknown) {
  const supabaseUrl =
    readRuntimeEnv(env, "SUPABASE_URL") ??
    readRuntimeEnv(env, "VITE_SUPABASE_URL") ??
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL;
  const publishableKey =
    readRuntimeEnv(env, "SUPABASE_PUBLISHABLE_KEY") ??
    readRuntimeEnv(env, "VITE_SUPABASE_PUBLISHABLE_KEY") ??
    readRuntimeEnv(env, "VITE_SUPABASE_ANON_KEY") ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY;

  writeProcessEnv("SUPABASE_URL", supabaseUrl);
  writeProcessEnv("VITE_SUPABASE_URL", supabaseUrl);
  writeProcessEnv("SUPABASE_PUBLISHABLE_KEY", publishableKey);
  writeProcessEnv("VITE_SUPABASE_PUBLISHABLE_KEY", publishableKey);
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      hydrateBackendEnv(env);
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
