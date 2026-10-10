#!/usr/bin/env bash
set -euo pipefail

BROKER="${PACT_BROKER_URL:-http://127.0.0.1:9292}"
PACTICIPANT="${1:?usage: pact-tag.sh <pacticipant> <version> <tag>}"
VERSION="${2:?version is required}"
TAG="${3:?tag is required}"

AUTH=()
[ -n "${PACT_BROKER_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $PACT_BROKER_TOKEN")

CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT ${AUTH[@]+"${AUTH[@]}"} \
  -H 'Content-Type: application/json' \
  "$BROKER/pacticipants/$PACTICIPANT/versions/$VERSION/tags/$TAG")"

echo "tag: $PACTICIPANT@$VERSION ← $TAG (HTTP $CODE)"
case "$CODE" in 2??) ;; *) exit 1 ;; esac
