import { app } from "./core/app";

export { app };
export type { AppType } from "./core/app";

// Listen only when run directly, never when imported by tests. No
// `export default app`: Bun would auto-serve it on top of Bun.serve below.
if (import.meta.main) {
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3461);
  Bun.serve({ fetch: app.fetch, port });
  // eslint-disable-next-line no-console
  console.log(`api listening on :${port}`);
  if (process.env.SEED_ON_BOOT === "0") {
    // Resume anything a previous crash left in an automated state.
    const res = await app.request("/api/pipeline/run", { method: "POST" });
    // eslint-disable-next-line no-console
    console.log(`resume on boot: HTTP ${res.status}`, await res.text());
  } else {
    const res = await app.request("/api/pipeline/reset", { method: "POST" });
    const body = (await res.json()) as { processed: number; invariants: { ok: boolean } };
    // eslint-disable-next-line no-console
    console.log(`seeded ${body.processed} applications, invariants ${body.invariants.ok ? "OK" : "FAILED"}`);
  }
}
