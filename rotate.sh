#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

NEW_PASSWORD="app-$(openssl rand -hex 8)"

echo "1. ALTER ROLE у Postgres…"
docker compose exec -T db psql -U admin -d marketplace \
  -c "ALTER ROLE appuser WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null

echo "2. Оновлюю файл-секрет…"
printf '%s' "${NEW_PASSWORD}" > secrets/db_password

echo "3. Закриваю старі зʼєднання appuser…"
docker compose exec -T db psql -U admin -d marketplace -tA \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = 'appuser';"

echo "Готово: новий пароль ${NEW_PASSWORD:0:6}… уже в БД і у файлі. Застосунок НЕ рестартував."