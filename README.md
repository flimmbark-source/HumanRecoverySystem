# Weave Operational Studio

A research workspace for understanding how one workflow in an organization actually runs: map it, observe the work, develop insights, connect evidence, test a small change on a branch, and export an anonymized decision brief.

Built from the handoff in `reference/handoff/` (product spec, acceptance tests, the v0.7 prototype, the research skill and the import fixture). **All demo and test data is synthetic.**

- Acceptance status and known gaps: [`docs/ACCEPTANCE-RESULTS.md`](docs/ACCEPTANCE-RESULTS.md)
- Deployment and operations: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- Android app: [`docs/ANDROID.md`](docs/ANDROID.md)

## Stack

TypeScript throughout. React + Vite client (the v0.7 SVG canvas is ported, not replaced by a graph library), Hono API on Node 22, PostgreSQL 16 with plain SQL migrations, cookie sessions with scrypt password hashes, and a database-backed job queue for research jobs (`FOR UPDATE SKIP LOCKED`, leases, bounded retries). PDFs are produced with pdfkit and spreadsheets with exceljs. The research provider is Claude through the official SDK, selected by configuration.

```
src/shared/    model schema, sentence generator, impact engine, routes, diff, legacy import, candidate validation, layout
src/server/    API, auth, store, research jobs, providers, reports, migrate, seed
src/client/    React app
src/device/    the API and its database (PGlite) in a Web Worker, for the Android app
android/       the Android WebView shell and its build script
migrations/    SQL migrations
tests/         unit, API (real PostgreSQL) and browser (Playwright) tests
reference/     the original handoff, unchanged
```

## Weave on an Android phone

The Android app runs the client, the API and the database on the phone, with no server. It uses the network only for Claude requests you start from the archive. On the phone, download **[Weave.apk](https://github.com/flimmbark-source/HumanRecoverySystem/releases/latest/download/Weave.apk)** from the [latest release](https://github.com/flimmbark-source/HumanRecoverySystem/releases/latest) and open it. Android 8 or later. See [`docs/ANDROID.md`](docs/ANDROID.md) for what differs from the server, backups, the build and the signing key.

## Try Weave in GitHub Codespaces

From this branch on GitHub, choose **Code → Codespaces → Create codespace**. Weave starts automatically on creation and when the Codespace resumes. If the browser tab does not open, use **Ports → Weave (5173) → Open in Browser**. Keep the port private.

**Demo login:** `owner@weave.test` / `weave-demo-1`.

For an existing Codespace, pull this branch and run `npm start`. It starts the demo if needed and prints the forwarded link. If PostgreSQL tools are missing, back up any existing database and run **Codespaces: Rebuild Container** once from the Command Palette. Startup logs are in `.weave-codespace/app.log`.

The demo database lives in the ignored `.weave-codespace/` directory. To use another database, create `.weave-codespace/no-autostart` before starting the Codespace, then run `npm run dev` with your existing `DATABASE_URL`. The manual foreground demo command is `npm run codespace`.

## Local setup

Requires Node 22+ and PostgreSQL 14+.

```bash
npm install
```

```bash
cp .env.example .env
```

Create a database and a role (adjust if you already have one, and edit `DATABASE_URL` in `.env` to match):

```bash
psql -U postgres -c "create user weave with password 'weave' createdb" -c "create database weave owner weave" -c "create database weave_test owner weave"
```

```bash
npm run migrate
```

```bash
npm run seed
```

```bash
npm run dev
```

Open http://localhost:5173. The seed creates a synthetic project and four accounts, all with the password `weave-demo-1`:

| Account | Access to the synthetic project |
| --- | --- |
| `owner@weave.test` | owner |
| `researcher@weave.test` | researcher (can edit) |
| `reader@weave.test` | reader |
| `outsider@weave.test` | none (for checking isolation) |

To run the production build locally instead:

```bash
npm run build
```

```bash
npm start
```

That serves the app and API together on http://localhost:8787.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API on :8787 and Vite on :5173 with reload |
| `npm run build` | Typecheck, client build, server bundle into `dist/` |
| `npm start` | Start the demo in Codespaces with default settings, or serve the compiled app locally or with a configured database |
| `npm run worker` | Run the job worker as its own process (set `RUN_WORKER=0` on the web process) |
| `npm run migrate` | Apply pending migrations |
| `npm run seed` | Create the synthetic accounts and project (safe to repeat) |
| `npm test` | Unit and API tests against `weave_test` (**resets that database**) |
| `npm run test:e2e` | Browser tests against the production build (**resets `weave_test`**; run `npm run build` first) |
| `npm run test:pglite` | The API tests again, on PGlite (the database in the Android app) |
| `npm run build:device` | Build the client, API and database that run on a phone into `dist/device` |
| `npm run test:device` | Browser tests of `dist/device` at phone size (run `npm run build:device` first) |
| `npm run test:all` | Typecheck, unit + API on PostgreSQL and on PGlite, build, browser tests, device build and its tests |
| `npm run verify:backup` | Back up `DATABASE_URL`, restore into a scratch database, compare, clean up |
| `npm run check:provider` | Optional live check of the real research provider (needs credentials) |

Tests use `postgres://weave:weave@localhost:5432/weave_test` unless `TEST_DATABASE_URL` / `E2E_DATABASE_URL` say otherwise. They never touch the database in `DATABASE_URL`.

## Importing the supplied v0.7 fixture

1. Sign in and go to **Projects** (the Weave mark, top left, from inside a project).
2. Choose **Import…**.
3. Select `reference/handoff/fixtures/synthetic-volunteer-placement-v0.7.json`.
4. Read the preview. It should say **6 nodes · 6 connections · 3 notes · 2 note links · 0 scenarios**, and list the records that need attention: the `Capacity approval` dependency (`e6`) carries a defaulted `0` that the prototype never counted, several waiting times are `0` with no recorded basis, and every figure is an unverified sample input.
5. Give the new project a name and choose **Import as a new project**, then **Open the project**.

Expected after import: 63 min per case and 84 h per month in the overview, tagged as unverified; in **Timeline**, the route `Main route` (e1→e2→e3→e4) shows 51 min active, 120 min waiting, 171 min elapsed, with `Check availability` flagged as a link that affects the route without being part of it.

Import always creates a new project. Replacing an existing project is a separate, owner-only action under **Project → Backup and transfer**: it previews the file, requires the project name to be typed, and stores a backup of the current contents first.

A file with dangling references, duplicate IDs, malformed records or non-finite numbers is rejected whole, with the path of each problem; nothing is written.

The same route works from the API: `POST /api/import/preview` then `POST /api/import` with `{ "data": <file contents>, "name": "…" }`.

## Research provider

Set in `.env`:

| `RESEARCH_PROVIDER` | Behavior |
| --- | --- |
| `none` (default) | No agent jobs. Capture, manual review and **Import agent findings** all work. |
| `anthropic` | Real provider. Needs `ANTHROPIC_API_KEY`. Wide jobs use public web search; deep jobs receive only excerpts a researcher approved plus the structure of the pinned map revision. |
| `fixture` | Deterministic synthetic output for demos and tests, labelled as synthetic wherever it appears. |

Limits: `RESEARCH_BUDGET_SECONDS` (wall clock per job), `RESEARCH_MAX_ATTEMPTS`, `RESEARCH_MAX_SEARCHES`, `RESEARCH_MODEL`. Whatever the provider returns is validated against the candidate schema and the model revision before anything appears in the review inbox, and nothing changes the map, the notes or the register until a researcher accepts it. Agents have no write path of their own.

The v1 candidate contract is the bundled `schema.json`, validated verbatim. Version 2 adds provenance fields (`sourceUrl`, `retrievedAt`, `sourceDate`) and three review-only kinds: `contradiction`, `measurement_target` and `assessment`. See `src/shared/candidates.ts`.

## How the main guarantees are met

- **Revisions are immutable.** Every model save appends a revision and moves the branch head only if the caller saw the current head; otherwise it gets a conflict with the newer version and keeps its draft. A database trigger rejects any update to a revision.
- **Layout is not content.** Node positions live on the branch and never create an operational revision. Tidy and drags are undoable.
- **One record for timing.** Performer, action, duration, waiting and recurrence live on the activity only, so a connection and its activity cannot disagree or be counted twice.
- **Scenarios are pinned.** A scenario stores the revision it branched from. Editing the live baseline later does not move any comparison.
- **Evidence is never rewritten by a scenario.** Notes belong to the project and keep their anchor. Where a scenario removes the target, the note is shown as historical there and still attached on the baseline.
- **Missing is not zero.** An empty duration is unknown. Headline figures appear only when every included input is known; otherwise the result reads incomplete, with a known-only subtotal shown separately.
- **Effort, elapsed time, cash and human effects stay separate.** Released time is capacity. Cash is counted only from an item with a documented mechanism, in one currency.
- **Leadership exports** use the title and interpretation prepared in Decide, plus approved excerpts and anonymous source IDs. Insight drafts and workspace opportunity titles remain in the workspace and its full JSON backup.
- **Projects are private.** Every query is scoped by project membership; an unknown or inaccessible project ID is a 404. Readers cannot mutate anything.

## Measuring research effort

**Brief → Research effort in this workspace** reports, per phase (capture, synthesis, report), the number of actions and the active time, counting consecutive actions less than five minutes apart as continuous work. It is derived from the activity log, so a pilot team can repeat the same walkthrough and compare runs. A comparison with a previous manual workflow is unmeasured until a comparable timed manual run exists.
