#!/usr/bin/env bash
# Tested restore procedure: back up DATABASE_URL, restore into a scratch database, compare every table, clean up.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
scratch="weave_restore_check_$$"
admin="${DATABASE_URL%/*}/postgres"
target="${DATABASE_URL%/*}/$scratch"
file="$(mktemp -t weave-backup-XXXXXX.dump)"
cleanup() { psql "$admin" -qc "drop database if exists $scratch" >/dev/null 2>&1 || true; rm -f "$file"; }
trap cleanup EXIT
"$(dirname "$0")/backup.sh" "$file" >/dev/null
psql "$admin" -qc "create database $scratch"
TARGET_DATABASE_URL="$target" "$(dirname "$0")/restore.sh" "$file" >/dev/null
counts() { psql "$1" -Atc "select string_agg(t || '=' || (xpath('/row/c/text()', query_to_xml('select count(*) as c from ' || quote_ident(t), false, true, '')))[1]::text, ' ' order by t) from (select tablename t from pg_tables where schemaname='public') x"; }
a="$(counts "$DATABASE_URL")"; b="$(counts "$target")"
sums() { psql "$1" -Atc "select md5(string_agg(id || md5(model::text), ',' order by project_id, id)) from revisions"; }
if [ "$a" != "$b" ] || [ "$(sums "$DATABASE_URL")" != "$(sums "$target")" ]; then echo "MISMATCH"; echo "source:   $a"; echo "restored: $b"; exit 1; fi
echo "Backup restored and verified: $a"
