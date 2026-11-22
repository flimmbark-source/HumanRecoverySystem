#!/usr/bin/env bash
set -euo pipefail

if ! command -v initdb >/dev/null || ! command -v pg_ctl >/dev/null; then
  echo "[weave] PostgreSQL tools are missing. Rebuild the Codespace container and try npm run codespace again." >&2
  exit 1
fi

# Keep the demo cluster in the mounted repo so it survives a container rebuild.
umask 077
data_dir="$PWD/.weave-codespace"
mkdir -p "$data_dir"
pg_dir="$data_dir/postgres"
db_port=55432

for secret_file in db-password session-secret; do
  if [[ ! -s "$data_dir/$secret_file" ]]; then
    node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))' > "$data_dir/$secret_file"
  fi
done

if [[ ! -s "$pg_dir/PG_VERSION" ]]; then
  initdb -D "$pg_dir" -U weave --auth-host=scram-sha-256 --auth-local=peer --pwfile="$data_dir/db-password" --no-locale --encoding=UTF8
fi

if ! pg_ctl -D "$pg_dir" status >/dev/null; then
  pg_ctl -D "$pg_dir" -l "$data_dir/postgres.log" -o "-h 127.0.0.1 -p $db_port -c unix_socket_directories=''" -w start
fi

export DATABASE_URL="postgres://weave:$(cat "$data_dir/db-password")@127.0.0.1:$db_port/postgres"
export SESSION_SECRET="$(cat "$data_dir/session-secret")"
export NODE_ENV=development PORT=8787 RESEARCH_PROVIDER=none ALLOW_DB_RESET=0
npm run seed
exec npm run dev
