-- Weave Operational Studio: initial schema.
-- Project-owned records use (project_id, id) keys so stable IDs survive export and import unchanged
-- and every query is naturally scoped to one project.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE org_members (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  meta jsonb NOT NULL DEFAULT '{}',
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Projects are private: only listed members can see one, regardless of organization.
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'reader')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE branches (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('baseline', 'scenario')),
  name text NOT NULL,
  hypothesis text NOT NULL DEFAULT '',
  parent_branch_id text,
  base_revision_id text,          -- pinned comparison revision; never changes after branching
  head_revision_id text NOT NULL,
  layout jsonb NOT NULL DEFAULT '{}',
  layout_version integer NOT NULL DEFAULT 1,
  origin jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'reviewed')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id)
);
CREATE UNIQUE INDEX one_baseline_per_project ON branches (project_id) WHERE kind = 'baseline';

-- Revisions are immutable. There is deliberately no UPDATE path for this table in the application.
CREATE TABLE revisions (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id text NOT NULL,
  branch_id text NOT NULL,
  parent_revision_id text,
  seq integer NOT NULL,
  summary text NOT NULL DEFAULT '',
  model jsonb NOT NULL,
  restored_from text,
  author text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, branch_id, seq),
  FOREIGN KEY (project_id, branch_id) REFERENCES branches(project_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE FUNCTION forbid_revision_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'revisions are immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER revisions_immutable BEFORE UPDATE ON revisions FOR EACH ROW EXECUTE FUNCTION forbid_revision_update();

-- Evidence and decision records: typed payload in `data`, validated by the application schema for each table.
CREATE TABLE sources (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE, id text NOT NULL, data jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1, created_by uuid REFERENCES users(id), ord bigserial,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (project_id, id)
);
CREATE TABLE notes (LIKE sources INCLUDING ALL);
ALTER TABLE notes ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
CREATE TABLE insights (LIKE sources INCLUDING ALL);
ALTER TABLE insights ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
CREATE TABLE links (LIKE sources INCLUDING ALL);
ALTER TABLE links ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
CREATE TABLE opportunities (LIKE sources INCLUDING ALL);
ALTER TABLE opportunities ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
CREATE TABLE options (LIKE sources INCLUDING ALL);
ALTER TABLE options ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX notes_target_idx ON notes (project_id, (data->>'targetId'));

CREATE TABLE research_runs (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('wide', 'deep')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'ready_for_review', 'failed', 'cancelled')),
  question text NOT NULL,
  provider text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}',
  result jsonb,
  error text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 2,
  budget_seconds integer NOT NULL DEFAULT 300,
  lease_until timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  ord bigserial,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX research_runs_queue_idx ON research_runs (status, created_at);

CREATE TABLE candidates (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id text NOT NULL,
  run_id text,
  origin text NOT NULL CHECK (origin IN ('agent', 'import', 'fixture')),
  schema_version integer NOT NULL,
  payload jsonb NOT NULL,           -- current (possibly reviewer-edited) proposal
  original_payload jsonb NOT NULL,  -- exactly what the agent or import supplied
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'needs_evidence')),
  base_revision_id text,
  duplicate_of text,
  reviewer_id uuid REFERENCES users(id),
  reviewer text NOT NULL DEFAULT '',
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  applied jsonb,
  ord bigserial,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  actor text NOT NULL DEFAULT '',
  action text NOT NULL,
  entity text NOT NULL DEFAULT '',
  entity_id text NOT NULL DEFAULT '',
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_project_idx ON audit_log (project_id, created_at DESC);
-- One acceptance per candidate, enforced by the database as well as by the transaction.
CREATE UNIQUE INDEX audit_candidate_accept_once ON audit_log (project_id, entity_id) WHERE action = 'candidate.accept';

CREATE TABLE view_state (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE project_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reason text NOT NULL,
  bundle jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
