# Acceptance results

Run on 2026-11-15 against PostgreSQL 16, Node 22 and Chromium (Playwright 1.63), with synthetic data only.

```bash
npm run test:all
```

| Suite | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | clean |
| Unit (impact engine, sentence generator, legacy import) | `npm test` | 23 of 23 passed |
| API integration, real database | `npm test` | 23 of 23 passed |
| Production build | `npm run build` | succeeded |
| Browser, against the production build | `npm run test:e2e` | 23 of 23 passed |
| Backup and restore cycle | `npm run verify:backup` | restored and verified |
| Real provider | `npm run check:provider` | **not run: no credentials** |

No acceptance test is failing. Two checks are blocked or unverified; they are listed at the end.

## By acceptance area

Test files: `tests/e2e/01-foundation.spec.ts` (E1), `02-research-loop.spec.ts` (E2), `03-scenarios-research.spec.ts` (E3), `tests/api/api.test.ts` (API), `tests/unit/*.test.ts` (U).

| Area | Status | Where it is exercised |
| --- | --- | --- |
| Start and persistence | Pass | E1: empty project and synthetic project created in the UI, edited, reloaded, signed out and in again, both intact and independent. A save interrupted at the network level leaves a draft; after reload it is offered back and restores. Two sessions writing the same map get a conflict banner; both resolutions (keep mine on top, use theirs) are exercised and nothing is overwritten silently. API: 409 with the current revision; revisions cannot be updated in the database. |
| Import and recovery | Pass | E1: the bundled v0.7 export imports through the UI with a preview showing 6 nodes, 6 connections, 3 notes, the per-record decisions, then 63 min/case, 84 h/month, route 51 + 120 = 171. A file with a dangling reference, a duplicate ID and a non-numeric duration is rejected with field paths and nothing is created; so is invalid JSON. U: ten rejection cases including `1e999`. API: export and re-import of a workspace with two scenarios, accepted, rejected and needs-evidence candidates and research runs compares equal, with IDs, pinned revisions and note anchors preserved. Replace requires the typed project name and writes a restorable backup. |
| Map and spacing | Pass | E1 at 1440, 1140, 780 and 390 px: no label covers a node, a scope tag or another label (bounding boxes compared); external nodes carry a dashed border and an `EXTERNAL` text tag, internal ones do not; no dashed rectangle wider than half the canvas exists; canvas controls, legend, Add and the branch selector are inside the viewport and clear of the inspector; the legend lists all five relationship types. A dense map (11 links, one of each type between the same nodes, an 80-character label) stays collision-free through a drag onto another node, Tidy and Undo; the five types have five distinct line/marker styles and text sub-labels; moving a node creates no operational revision. The close-up PNG was used as the visual reference by eye. |
| Connection hierarchy | Pass | E1: “Triage application” shows the transfer, Coordinator as explicit performer (“the receiver”), submitted → ready for placement, and the exact sentence from the spec. Performance, Evidence and Edit are closed until opened. Changing action, result and both states updates the inspector sentence, the edit preview, the timeline step and the exports. Sender, third-party and unknown performers each produce their own sentence; an unknown performer stays unknown after reload. U: token types per segment. |
| Fieldwork and synthesis | Pass | E2: session started; note captured on the selected connection with Ctrl+Enter, inheriting the source, without leaving the map; a second note captured unassigned and attached later; supporting and contradicting notes linked to an insight and both clicked through; opportunity and scenario created from the insight; filters by source, type and attachment, grouping by collection and map item, sticky category and anchor click-through. Multiline paste offers a split preview. |
| Observation in context | Pass | E2: two episodes for the same role and handoff, one with protected time and a good match, one with interruptions and a missed detail, each with action, conditions, outcome, hidden effort and an optional participant clarification. They are separate records with their own anchors. The board shows task and conditions and contains no scoring or deficit wording; API: an unknown `rating` field is dropped. |
| Open-ended synthesis | Pass | E2: an insight saved with no evidence, target, category or title and reloaded; evidence attached later, one link re-typed and one detached, the insight text revised, with the notes byte-for-byte unchanged; used in a recommendation, which the decision view and the brief show as “Hypothesis to test” with observations, interpretation and gaps in separate columns. |
| Strengthening the existing workflow | Pass | E3: a scenario for protected matching time and easier capacity checks; the practice to preserve, workload by role with the burden moved to program leads flagged as “absorbs work”, a smallest reversible option, working-condition and placement-quality indicators with a rollback trigger, unknowns, and a reversal note all reach the brief. The export contains no participant roles and no unapproved source IDs. |
| Timeline | Pass | E3: the explicit route plays to the end and stops; scrubbing to a handoff shows its input → output state; working and waiting are distinguished in the step text and on the token; an alternate route with a deliberate repeat is built step by step, with the branch chosen explicitly; loop wraps; either route can be selected; an unmeasured route is labelled illustrative with elapsed “Incomplete”; a disconnected route is flagged and cannot be played. |
| Scenario and evidence isolation | Pass | E3 and API: baseline → A → B; a duration changed in A; e2 deleted in B; B compared with its parent and with the original baseline; note t1 still targets e2, is attached on the baseline and in A, and is shown as historical in B; the removed handoff lists downstream links, a broken route and the unreachable outcome; after the live baseline is edited, both branches still compare against their original pinned revisions. |
| Opportunity and report | Pass | E2: status quo, process change, existing tool and bespoke option compared on one opportunity with benefits, human costs, effort, unknowns and a guardrail. Brief PDF, map PDF, XLSX, CSV and workspace JSON are downloaded through the browser; the PDFs start with `%PDF-`, the XLSX is opened with a spreadsheet library and its rows read, the CSV and JSON are parsed. Provenance shows approved source IDs; an unapproved excerpt, an internal note and a participant role are absent. |
| Wide and deep research | Pass with the fixture provider | E3 and API: a wide run returns citations with URLs and retrieval dates, a coverage assessment and follow-up questions; a deep run uses only approved excerpts and the pinned revision and returns structured candidates, a contradiction and a measurement gap; output is validated against the import schema; invalid output, time-out, cancellation while queued and while running, retry, and restart after a dead process are exercised; the bundled skill examples import manually; drafts wait for acceptance; a double click plus three replayed accepts produce one connection and one audit entry. |
| Privacy and operation | Pass | API and E3: an outsider gets 404 for the project, its evidence, research, revisions and every export, and cannot enqueue jobs or import candidates; a reader gets 403 on eight kinds of write and a read-only UI; a note ID from another project is refused as agent input and as a link target; unapproved notes are refused as agent input and never appear in provider input or exports; the backup cycle restores and verifies; the production build is what the browser tests run. |
| Keyboard and mobile | Pass | E3: a node and a connection added using only the keyboard; a connection started from a port with Enter; a focused line shows focus on the line itself and has a full text name; closing the drawer returns focus to the element that opened it; every node and connection appears in a text outline with its type name. At 390 px with touch: a note captured on a tapped edge, the sheet closed, and the map still at the same view with the same selection. |

## Calculation fixtures

All asserted both in the engine (`tests/unit/impact.test.ts`) and through the UI (E1, E3).

| Fixture | Expected | Actual |
| --- | --- | --- |
| v0.7 baseline | 63 min/case, 84 h/month; route 51 active + 120 waiting = 171; e5 in workload, off the route; values tagged unverified | same |
| Same volume, e3 22 → 10 | 51 min/case, 68 h/month, 16 h released, route 159, cash unknown | same |
| Changed volume, 100 cases | 85 h vs 84 h (+1 h at modeled volumes); −16 h at the shared volume of 80; both with denominators | same |
| Unknown input, e3 cleared | known subtotal 41 min, one missing activity, headline and elapsed comparison incomplete | same |
| Sourced zero | counted as a value: 41 min, complete | same |
| Ranges; unit and currency mismatch | a range, never a point; mismatched units and currencies are not added | same |
| Cash and people | 400 − 80 = 320/month, 960 one-time, 3-month payback; a role-level contact concern with missing data reaches the report with its validation plan and no invented number | same |

## Blocked or unverified

| Item | Depends on | Effect |
| --- | --- | --- |
| Real research provider end to end | An API key. Run `npm run check:provider` with `RESEARCH_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. | The adapter compiles against the current SDK and its output goes through the same validation as the fixture, but no live request has been made. Agent jobs should stay off (`RESEARCH_PROVIDER=none`) until the check passes. Everything else, including manual candidate import and review, does not depend on it. |
| Docker Compose path | A host with Docker. | `Dockerfile` and `docker-compose.yml` were written, not executed. The Node path they wrap is what all tests run. |

Checked by the author rather than by a person in the intended tool, which the pilot team should repeat once: opening the PDFs in a desktop viewer and the XLSX in Excel or LibreOffice (here: rendered with `pdftoppm`, text-extracted with `pdftotext`, parsed with exceljs); the visual match with the v0.7 close-up; touch behaviour on a real phone (here: Chromium touch emulation at 390 px); colour contrast (tokens carry text labels and non-colour cues, but no formal WCAG audit was run).

## Known limits against the spec

- **Groups**: a node can be a group and other nodes can be assigned to it, but the canvas does not draw containment.
- **Disjoint routes**: effort and elapsed time are reported per route. Routes carry a case-weight field, but there is no combined, weighted view.
- **Parallel work and queues** are not modeled; elapsed time is sequential on one explicit route, as the spec allows.
- **Accounts**: email and password only. No password reset, invitations by email or single sign-on.
- **Reference fidelity**: the hover “peek” card of v0.7 was replaced by native tooltips plus the inspector.

## Readiness for the pilot

Against `ACCEPTANCE.md`, every listed area passes on synthetic data, and the calculation fixtures match exactly. On that basis the application is ready for a pilot on a private instance, using researcher capture, manual candidate import and review, scenarios and exports.

Two conditions before real fieldwork goes in: run the provider check with real credentials if agent jobs are wanted (otherwise leave the provider off), and have the team do one pass of the person-in-the-loop checks above on their own devices. The actual workflow, participants, measured baselines, hosting and client policy remain open decisions outside this build.
