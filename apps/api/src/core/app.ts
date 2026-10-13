// Assembles the Hono app: hardening middleware, health check, and the
// pipeline module wired with its database, JEV options, and the optional
// gpt-4o-mini summariser. `createApp()` takes its dependencies so tests and
// the reliability harness can inject an in-memory database and a fake fetch.
//
// Routes are chained so Hono's RPC typing (`hc<AppType>`) sees them.
import { Hono } from "hono";
import { createPipelineModule, type PipelineDeps } from "../modules/pipeline";
import { summarizeCv } from "../lib/ai";
import { openDb } from "./db";
import { applyHardening } from "./hardening";

export function createApp(deps: PipelineDeps) {
  const base = new Hono();
  applyHardening(base);
  base.onError((err, c) => {
    // eslint-disable-next-line no-console
    console.error("[api] unhandled", err instanceof Error ? err.message : err);
    return c.json({ error: "Internal error" }, 500);
  });
  return base.get("/health", (c) => c.json({ ok: true })).route("/api", createPipelineModule(deps));
}

export function defaultDeps(): PipelineDeps {
  return {
    db: openDb(process.env.DB_PATH ?? ":memory:"),
    jev: {},
    summarize: process.env.OPENAI_API_KEY ? summarizeCv : undefined,
  };
}

const app = createApp(defaultDeps());

export { app };
export type AppType = typeof app;
