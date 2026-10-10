#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BROKER="${PACT_BROKER_URL:-http://127.0.0.1:9292}"
CONSUMER="${PACT_CONSUMER:-marketplace-web}"
PROVIDER="${PACT_PROVIDER:-marketplace-api}"
VERSION="${PACT_CONSUMER_VERSION:-$(git rev-parse --short HEAD)}"
FILE="pacts/${CONSUMER}-${PROVIDER}.json"

[ -f "$FILE" ] || { echo "publish: немає $FILE — спершу npm run test:contract" >&2; exit 1; }

AUTH=()
[ -n "${PACT_BROKER_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $PACT_BROKER_TOKEN")

BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

CODE="$(curl -sS -o "$BODY" -w '%{http_code}' -X PUT \
  ${AUTH[@]+"${AUTH[@]}"} -H 'Content-Type: application/json' \
  --data-binary @"$FILE" \
  "$BROKER/pacts/provider/$PROVIDER/consumer/$CONSUMER/version/$VERSION")"

echo "publish: $CONSUMER@$VERSION → $BROKER (HTTP $CODE)"
case "$CODE" in
  2??) ;;
  *) cat "$BODY" >&2; exit 1 ;;
esac
