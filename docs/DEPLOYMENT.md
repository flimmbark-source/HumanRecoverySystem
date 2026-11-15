# Deployment and operations

Hosting, the research provider, the repository home and client policy are still open decisions (see the product spec). This describes one concrete path that works today and what to change for another.

## Deployable path: one host with Docker Compose

`Dockerfile` builds a single image that serves the client and the API and runs the job worker. `docker-compose.yml` runs it next to PostgreSQL 16.

1. On the host, create a `.env` file next to `docker-compose.yml`:

   ```
   POSTGRES_PASSWORD=<long random string>
   SESSION_SECRET=<another long random string>
   ALLOW_SIGNUP=1
   RESEARCH_PROVIDER=none
   ```

2. Start it:

   ```bash
   docker compose up -d --build
   ```

3. Put TLS in front of port 8787 (Caddy, nginx, or the platform's proxy). Session cookies are `Secure` by default in production, so the app must be reached over HTTPS. For a plain-HTTP private preview only, set `COOKIE_SECURE=0`.
4. Have the pilot team create their accounts, then set `ALLOW_SIGNUP=0` and restart. Access to each project is granted by its owner under **Project → People with access**.
5. For a demo, seed the synthetic project:

   ```bash
   docker compose exec app node dist/server/seed.js
   ```

   Do not seed a real pilot instance: the seed accounts share a published password.

Migrations run at start-up under an advisory lock, before the server listens, so a new image version upgrades the schema on restart.

> This path was written but **not executed in the build environment** (no Docker daemon there). The same artefacts it uses — `npm run build`, `node dist/server/main.js`, the migrations and the seed — are what the browser test suite runs against.

### Without Docker

Any host with Node 22 and a PostgreSQL database works:

```bash
npm ci && npm run build
```

```bash
DATABASE_URL=postgres://… SESSION_SECRET=… NODE_ENV=production node dist/server/main.js
```

`dist/`, `migrations/`, `assets/`, `node_modules/` and `reference/handoff/reference/weave_research_skill/` must be present at runtime.

### Running the worker separately

By default the web process also runs research jobs. To scale or isolate them, set `RUN_WORKER=0` on the web process and run `node dist/server/worker.js` with the same environment. Several workers are safe: jobs are claimed with `FOR UPDATE SKIP LOCKED`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | local dev database | PostgreSQL connection string |
| `SESSION_SECRET` | none in production (required) | Mixed into stored session token hashes |
| `PORT` | `8787` | HTTP port |
| `COOKIE_SECURE` | `1` in production | Send the session cookie over HTTPS only |
| `ALLOW_SIGNUP` | `1` | Self-service account creation |
| `MAX_BODY_BYTES` | `2000000` | Largest accepted request body, imports included |
| `RESEARCH_PROVIDER` | `none` | `none`, `anthropic` or `fixture` |
| `ANTHROPIC_API_KEY` | – | Credentials for the real provider |
| `RESEARCH_MODEL` | `claude-opus-5-5` | Model used for research jobs |
| `RESEARCH_BUDGET_SECONDS` | `300` | Wall-clock cap per job |
| `RESEARCH_MAX_ATTEMPTS` | `2` | Attempts before a job is marked failed |
| `RESEARCH_MAX_SEARCHES` | `6` | Web searches allowed in one wide job |
| `RUN_WORKER` | `1` | Run the job worker inside the web process |
| `JOB_POLL_MS` | `2000` | How often the worker looks for queued jobs |

Secrets come from the environment only. Nothing secret is stored in the repository or sent to the browser.

## Turning on the real research provider

1. Set `RESEARCH_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`.
2. Check it against synthetic input before the team uses it:

   ```bash
   npm run check:provider
   ```

   It runs one wide and one deep job outside the queue and validates the output the same way the app does. It costs a small amount of provider usage.
3. Restart. **Research → provider status** shows the provider and model in use.

What leaves the workspace: for a wide job, the question, the project's scope text and the listed public topics; for a deep job, additionally the notes a researcher ticked (each must already be marked as an approved, de-identified excerpt, re-checked when the job runs), the anonymous source IDs of those notes, an optional insight, and the labels and links of the pinned map revision. Transcripts, participant roles and other notes are never sent. Requests opt in to the provider's server-side model fallback so a declined request is retried on another model rather than failing the job.

## Backup and restore

Two levels, both tested.

**Whole database** (all projects, accounts, history):

```bash
DATABASE_URL=postgres://… scripts/backup.sh backups/weave-$(date +%F).dump
```

```bash
TARGET_DATABASE_URL=postgres://…/weave_restored scripts/restore.sh backups/weave-2026-11-15.dump
```

`restore.sh` refuses to write into a database that already has tables. `npm run verify:backup` performs the full cycle against a scratch database and compares every table's row count and a checksum of all revisions; run it after changing the schema and periodically in production. With Compose, run the scripts in a container that has `pg_dump`, for example `docker compose exec db pg_dump -U weave -Fc weave > backups/weave.dump`.

**One project**: **Brief → Workspace backup (JSON)**, or `GET /api/projects/:id/export/workspace.json`. The file contains every branch, every revision, notes, sources, insights, links, opportunities, options, research runs and candidate decisions with their original IDs, and can be imported into any instance as a new project.

## Operational notes

- **Logs** contain request failures and job status by run ID. They never contain note text, excerpts, questions or request bodies.
- **Health check**: `GET /api/health` returns 200 when the database answers.
- **Restarts are safe for jobs.** A job that was running when the process died is picked up again when its lease expires, within its attempt budget; if it has none left it is marked failed with a visible reason.
- **No public links.** Exports are downloads for signed-in project members. There is no share-by-URL feature.
- **Sign-in protection** is basic: after eight failed attempts for one email, sign-in for it pauses for ten minutes (per process, in memory).
- **Not included yet**: password reset by email, single sign-on, per-IP rate limiting. For the pilot, put the instance behind the organization's VPN or access proxy if it is reachable from the internet; a forgotten password currently needs a database administrator.
