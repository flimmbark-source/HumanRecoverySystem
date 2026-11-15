#!/usr/bin/env bash
# Restores a backup into the database named by TARGET_DATABASE_URL. The target must exist and be empty.
# Usage: TARGET_DATABASE_URL=postgres://… scripts/restore.sh backups/weave-….dump
set -euo pipefail
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL (an empty database)}"
file="${1:?Usage: scripts/restore.sh <backup-file>}"
existing=$(psql "$TARGET_DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")
if [ "$existing" != "0" ]; then echo "Refusing to restore: the target database is not empty ($existing tables)." >&2; exit 1; fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_DATABASE_URL" "$file"
echo "Restored $file"
