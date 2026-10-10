#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
. scripts/_pg.sh

parse_database_url "$DATABASE_URL"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
DUMP="$(ls -1 "$BACKUP_DIR"/*.dump 2>/dev/null | sort | tail -n 1 || true)"
if [ -z "$DUMP" ]; then
  echo "drill: у $BACKUP_DIR немає жодного *.dump — спершу запусти scripts/backup.sh" >&2
  exit 1
fi

DRILL_IMAGE="${DRILL_IMAGE:-postgres:16-alpine}"
NAME="marketplace-restore-drill"
VOLUME="marketplace-restore-drill-pgdata"

now() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time'; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }

cleanup() {
  docker rm -f "$NAME" > /dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" > /dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

echo "drill: dump    = $DUMP ($(wc -c < "$DUMP" | tr -d ' ') bytes)"

BEFORE="$(PGPASSWORD="$PG_PASSWORD" docker compose exec -T -e PGPASSWORD db \
  psql -h 127.0.0.1 -U "$PG_USER" -d "$PG_DB" -X -v ON_ERROR_STOP=1 -tA -c "$(control_sql)")"

T0="$(now)"
docker volume create "$VOLUME" > /dev/null
docker run -d --name "$NAME" \
  -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB="$PG_DB" \
  -v "$VOLUME":/var/lib/postgresql/data \
  "$DRILL_IMAGE" > /dev/null

for _ in $(seq 1 120); do
  docker exec "$NAME" pg_isready -h 127.0.0.1 -U drill -d "$PG_DB" -q 2>/dev/null && break
  sleep 0.5
done
docker exec "$NAME" pg_isready -h 127.0.0.1 -U drill -d "$PG_DB" -q
T1="$(now)"

docker cp "$DUMP" "$NAME":/tmp/drill.dump > /dev/null
docker exec "$NAME" pg_restore -h 127.0.0.1 -U drill -d "$PG_DB" \
  --no-owner --no-acl --exit-on-error /tmp/drill.dump
T2="$(now)"

AFTER="$(docker exec "$NAME" psql -h 127.0.0.1 -U drill -d "$PG_DB" -X -v ON_ERROR_STOP=1 -tA -c "$(control_sql)")"
T3="$(now)"

echo "drill: before  = $BEFORE"
echo "drill: after   = $AFTER"
echo "drill: timing  = container $(elapsed "$T0" "$T1")s, pg_restore $(elapsed "$T1" "$T2")s, total RTO $(elapsed "$T0" "$T3")s"

if [ "$BEFORE" = "(no tables) | orders(count|sum_total)=absent" ]; then
  echo "drill: WARN джерело порожнє — для змістовного drill-у спершу npm run migrate && npm run seed" >&2
fi

if [ "$BEFORE" != "$AFTER" ]; then
  echo "MISMATCH"
  exit 1
fi
echo "MATCH"
