#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
. scripts/_pg.sh

parse_database_url "$DATABASE_URL"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
FILE="$BACKUP_DIR/${PG_DB}_${STAMP}.dump"
TMP="$FILE.partial"
trap 'rm -f "$TMP"' EXIT

echo "backup: pg_dump -Fc $PG_DB → $FILE" >&2
PGPASSWORD="$PG_PASSWORD" docker compose exec -T -e PGPASSWORD db \
  pg_dump -h 127.0.0.1 -U "$PG_USER" -d "$PG_DB" -Fc --no-password > "$TMP"

docker compose exec -T db pg_restore --list < "$TMP" > /dev/null
mv "$TMP" "$FILE"

SIZE="$(wc -c < "$FILE" | tr -d ' ')"
echo "backup: OK, $SIZE bytes" >&2
echo "$FILE"
