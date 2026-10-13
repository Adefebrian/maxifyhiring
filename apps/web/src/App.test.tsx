import { afterEach, describe, expect, test } from "bun:test";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { Api, AppSummary, Stats } from "./api";
import { App, parseRoute } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG_DASH = String.fromCharCode(0x2014);
const NOW = "2026-10-13T01:00:00.000Z";

function app(over: Partial<AppSummary>): AppSummary {
  return {
    id: "APP-001",
    ref: "WEB-1001",
    name: "Ayu Lestari",
    email: "ayu@example.com",
    roleCode: "BE",
    roleTitle: "Backend Engineer",
    state: "interview_scheduled",
    owner: "interviewer:Fajar Nugroho",
    nextAction: "Interview Ayu Lestari",
    nextActionDue: "2026-10-14T02:00:00.000Z",
    score: 97,
    duplicateOf: null,
    submittedAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const ITEMS = [
  app({}),
  app({ id: "APP-009", name: "Kevin Tanoto", state: "human_review", owner: "hm:Dimas", nextActionDue: "2026-10-12T01:00:00.000Z" }),
  app({ id: "APP-011", name: "Rudi Hartono", state: "invalid", owner: "recruiter:Rina" }),
];

const STATS: Stats = {
  now: NOW,
  total: 3,
  byState: { interview_scheduled: 1, human_review: 1, invalid: 1 } as Stats["byState"],
  decisions: { rule: 5, jev: 0, human: 0 },
  jevVerified: 0,
  unverified: 1,
  humanQueue: 1,
};

function fakeApi(): Api {
  return {
    stats: async () => STATS,
    applications: async () => ({ items: ITEMS }),
    application: async () => {
      throw new Error("not used");
    },
    schedule: async () => ({ now: NOW, interviewers: [], interviews: [], grid: [] }),
    audit: async () => ({ items: [] }),
    queue: async () => ({ items: [] }),
    decide: async () => {
      throw new Error("not used");
    },
    advance: async () => ({ now: NOW, done: [], noShows: [] }),
    reset: async () => ({ processed: 3, invariants: { ok: true } }),
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(): Promise<HTMLDivElement> {
  location.hash = "#/pipeline";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App api={fakeApi()} />);
  });
  // Let the fake API promises resolve and React commit.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("<App />", () => {
  test("opens on the Pipeline screen", async () => {
    const c = await mount();
    expect(c.querySelector("h1")?.textContent).toBe("Pipeline");
  });

  test("renders inside the app-shell with 3 to 5 destinations", async () => {
    const c = await mount();
    expect(c.querySelector(".shell header")).toBeTruthy();
    const items = c.querySelectorAll(".shell nav a");
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(c.querySelectorAll('.shell nav a[aria-current="page"]').length).toBe(1);
  });

  test("groups applications by state, people first, and flags overdue against the sim clock", async () => {
    const c = await mount();
    const titles = Array.from(c.querySelectorAll(".group-title")).map((h) => h.childNodes[0]?.textContent);
    expect(titles).toEqual(["Human review", "Invalid", "Interview scheduled"]);
    const overdue = c.querySelectorAll(".due[data-overdue]");
    expect(overdue.length).toBe(1);
    expect(overdue[0]?.textContent).toContain("Overdue by");
    expect(c.querySelector('a.rec[href="#/app/APP-009"]')).toBeTruthy();
  });

  test("never renders a long dash", async () => {
    const c = await mount();
    expect(c.textContent ?? "").not.toContain(LONG_DASH);
  });
});

describe("parseRoute", () => {
  test("reads screens, case ids, and filter params", () => {
    expect(parseRoute("").name).toBe("pipeline");
    expect(parseRoute("#/app/APP-001")).toEqual({ name: "app", id: "APP-001", params: {} });
    expect(parseRoute("#/audit?verified=false")).toEqual({ name: "audit", params: { verified: "false" } });
    expect(parseRoute("#/pipeline?state=invalid").params.state).toBe("invalid");
    expect(parseRoute("#/nowhere").name).toBe("pipeline");
  });
});
