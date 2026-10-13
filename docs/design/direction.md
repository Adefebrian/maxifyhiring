# maxifyhiring direction: web app

Seed: product "maxifyhiring", screen "web app", key e4dd8956, kind direction, pool 3, pick 1, reroll 0
Decided: 2026-10-13. Mode: operate. JEV: ui.experience modern (0.99); ui.direction_screen two rounds (refill once), survivors c3 fit 2.77, c4 fit 2.53, c7 fit 2.69

## Brief
Audience: recruiters (Rina) and hiring managers (Dimas, Maya, Sari) on a laptop several times a day, hiring managers also on a phone between meetings; plus a demo audience judging the agent.
Job: see where every application stands, who owns the next action and when it is due against the sim clock, and make the human calls the agent refuses to make alone.
Mechanism: an agent routes each application by rule or JEV, stamps every soft call verified or UNVERIFIED BY JEV, and hands borderline cases to a person with the reason on record.
Rut: a colourful ATS kanban with avatar cards and coloured columns; its opposite, a dark AI-ops dashboard with glowing charts.

## Direction
Form: court docket and case file (original rank 4). Each application is a case; each ruling is signed by who decided (rule, JEV, human) with a verified seal and a reason; the docket is plain dated rows.
Preset: D2 single_signal_ledger (JAL Core knob set, not a design system)
Thesis: accountability is the product. Every screen answers who decided, on what grounds, and who acts next by when. Refuses the kanban card wall.
Own world: near-monochrome ink on a cool page, one blue that only fills the single primary action of a view, status tints only for real state (overdue, invalid, unverified, verified), tabular figures for every time and count, records as hairline-divided rows.
Story: understand where the queue stands, believe the agent's calls because each shows its reason and stamp, then decide the cases it handed over.
First viewport: 375: app-shell header, page title with the sim clock line, the six-count stat card (2 by 3), then the first state group of rows; bottom bar Pipeline, Decisions, Schedule, Audit. 1280: rail header with the four destinations, title and Reset action on one line, stat card as one row of six, toolbar, then grouped docket rows with column headers.
Signature moment: none (product UI, tier 1 cap).
Nav / Footer archetype: header rail, bottom bar (Material bar). Overrides D2's island plus split because a 4-destination tool has no single conversion action to load into the bar.
Compositions: product screens, no marketing kit compositions. Hand-written layout inside the app shell: page header, StatRow card, toolbar, grouped record rows, DataTable, dialog. Reason: daily-use app screens, the kit compositions are marketing bands.

## Knobs (the only values this file may set)
| Knob | Value | Token or mechanism | Reason |
|---|---|---|---|
| Type pairing | Geist / Geist / Geist Mono | --kit-font-sans, --kit-font-display, --kit-font-mono | ui.type_pairing geist, 0.73 |
| Accent | #1d5fa8, HSL 212 | --color-accent, --color-accent-contrast | D2 allows blue at 225 or lower; green 160 was rejected because it sits 15 degrees from the success status that marks "Verified" |
| Accent role | filled_primary | --color-primary (+ hover, active re-derived) | one filled action per view: Record decision, Export JSON |
| Primary fill | accent | --color-primary | |
| Canvas | cool #f7f8f8 | --color-page (D2 block) | |
| Tracking | display -0.025em, heading -0.02em | --tracking-display, --tracking-heading | |
| Display ceiling | --text-4 for page titles | product screens | |
| Radius tier | cards 12, controls 8 | --radius-12, --radius-8 | |
| Hairline | --color-border | | |
| Density | default | data-density | ui.density compact 0.48 (low confidence), runner-up default taken per catalog |
| Motion intensity | tier 1 stats, board, clock, sheet; tier 0 audit | kit_css (product UI precheck) | motion.intensity |
| Media role | none | | no assets, none needed |

## Law (fixed, restated, not editable here)
JAL Core tokens and components. White-first page; dark only as an explicit dark mode. No gradients,
no blurred shadows, no glow or neon, no side stripes or accent bars, no emoji, no em-dash, no
eyebrow labels, no purple/violet/indigo, no overlap, 44px controls, mobile app-shell below 640px.

## Candidates (as screened)
| Rank | Form | Preset | slop | fit | Result |
|---|---|---|---|---|---|
| 1 | Kanban ATS board | D5 | 0.90 | 1.46 | dropped |
| 2 | Recruiter inbox triage | D1 | 0.55 | 1.35 | dropped |
| 3 | Departure board and flight strips | D3 | 0.29 | 2.77 | pool |
| 4 | Court docket and case file | D2 | 0.37 | 2.53 | drawn |
| 5 | Hospital ward whiteboard | D8 | 0.58 | 2.02 | dropped, refilled |
| 6 | Lab notebook | D1 | 0.66 | 0.86 | dropped, refilled |
| 7 | Parts catalogue | D10 | 0.74 | 0.63 | dropped, refilled |
| 5r | Newsroom budget sheet | D5 | 0.68 | 2.10 | dropped |
| 6r | Kitchen ticket rail | D10 | 0.67 | 2.03 | dropped |
| 7r | Parcel tracking waybill | D1 | 0.34 | 2.69 | pool |

## Decision ledger
| Decision | Source | Why |
|---|---|---|
| Pipeline board is grouped docket rows, column headers from 1024px | ui.region_gate board rows | Kanban columns of 16 and 2 items leave dead columns; rows keep every group scannable |
| New application form not built | ui.region_gate newapp relevance 0.92 | dropped by veto |
| Detail is one column capped at 880px | layout doctrine | a side column beside a long docket leaves dead space |
| Icons are inline SVG through Icon | koboyo MCP has no key in this session | fallback, flagged in the build report |

## Open decisions
Applicant names and roles come from seeded data; real data may need longer-name handling in the week view.

## Finish
Verdict: pending the fresh critic gate.
