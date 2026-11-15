#!/usr/bin/env bash
# Full database backup (custom format). Usage: scripts/backup.sh [output-file]
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
out="${1:-backups/weave-$(date -u +%Y%m%dT%H%M%SZ).dump}"
mkdir -p "$(dirname "$out")"
pg_dump --format=custom --no-owner --no-privileges --file="$out" "$DATABASE_URL"
echo "Backup written to $out"
