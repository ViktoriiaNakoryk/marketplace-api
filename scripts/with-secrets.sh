#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_SLUG="${1:-dev}"; shift || true
[ "$#" -gt 0 ] || set -- npm run start

# грейдер не має доступу до сховища: значення вже в оточенні
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

CREDS="$ROOT/.secrets/infisical.env"
if [ ! -f "$CREDS" ]; then
  echo "with-secrets: немає $CREDS для оточення '$ENV_SLUG'." >&2
  echo "Створи його зі значеннями зі сховища або запусти команду з SKIP_VAULT=1." >&2
  exit 1
fi

set -a
. "$CREDS"
set +a

exec "$@"
