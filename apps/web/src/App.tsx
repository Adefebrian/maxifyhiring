import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@maxifyhiring/ui";
import { createApi, type Api } from "./api";
import { Glyph } from "./icons";
import { useLoad } from "./parts";
import { Audit } from "./screens/Audit";
import { Decisions } from "./screens/Decisions";
import { Detail } from "./screens/Detail";
import { Pipeline } from "./screens/Pipeline";
import { Schedule } from "./screens/Schedule";

// Hash routes: #/pipeline (default), #/app/APP-001, #/schedule, #/decisions,
// #/audit. A query after the route pre-sets filters (#/audit?verified=false).
export interface Route {
  name: "pipeline" | "app" | "schedule" | "decisions" | "audit";
  id?: string;
  params: Record<string, string>;
}

export function parseRoute(hash: string, pathname = "/"): Route {
  // The hash wins; a bare path (/schedule, /app/APP-001, served by the SPA
  // fallback) is read when there is no hash route, so every screen also has
  // a plain URL that a reload or a crawler can open.
  const fromHash = hash.replace(/^#\/?/, "");
  const raw = fromHash || pathname.replace(/^\//, "") + (typeof location === "undefined" ? "" : location.search);
  const [path = "", qs = ""] = raw.split("?");
  const params = Object.fromEntries(new URLSearchParams(qs));
  const [head, id] = path.split("/");
  if (head === "app" && id) return { name: "app", id: decodeURIComponent(id), params };
  if (head === "schedule" || head === "decisions" || head === "audit") return { name: head, params };
  return { name: "pipeline", params };
}

function useRoute(): Route {
  const read = () => (typeof location === "undefined" ? parseRoute("") : parseRoute(location.hash, location.pathname));
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => {
      setRoute(read());
      window.scrollTo?.({ top: 0 });
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export function App({ api: injected }: { api?: Api } = {}) {
  const api = useMemo(() => injected ?? createApi(), [injected]);
  const route = useRoute();
  const [version, setVersion] = useState(0);
  // The sim clock and the human queue count feed the shell badge and every
  // due line; any screen that changes them bumps `version`.
  const stats = useLoad(() => api.stats(), `stats-${version}`);
  const changed = () => setVersion((v) => v + 1);
  const now = stats.data?.now ?? null;
  const queue = stats.data?.humanQueue ?? 0;

  const destinations = [
    { id: "pipeline", label: "Pipeline", href: "#/pipeline", icon: <Glyph name="pipeline" size={24} /> },
    { id: "decisions", label: "Decisions", href: "#/decisions", icon: <Glyph name="decide" size={24} />, badge: queue },
    { id: "schedule", label: "Schedule", href: "#/schedule", icon: <Glyph name="calendar" size={24} /> },
    { id: "audit", label: "Audit", href: "#/audit", icon: <Glyph name="audit" size={24} /> },
  ];
  const current = route.name === "app" ? "pipeline" : route.name;
  const key = `${route.name}-${route.id ?? ""}-${JSON.stringify(route.params)}`;

  return (
    <AppShell
      title="maxifyhiring"
      brandHref="#/pipeline"
      destinations={destinations}
      current={current}
      spy={false}
      archetype={{ header: "rail", bar: "bar" }}
    >
      {route.name === "pipeline" ? <Pipeline key={key} api={api} initialState={route.params.state ?? ""} onChanged={changed} /> : null}
      {route.name === "app" && route.id ? <Detail key={key} api={api} id={route.id} now={now} onChanged={changed} /> : null}
      {route.name === "schedule" ? <Schedule key={key} api={api} onChanged={changed} /> : null}
      {route.name === "decisions" ? <Decisions key={key} api={api} now={now} onChanged={changed} /> : null}
      {route.name === "audit" ? <Audit key={key} api={api} initial={route.params} /> : null}
    </AppShell>
  );
}
