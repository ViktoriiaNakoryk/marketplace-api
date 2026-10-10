#!/usr/bin/env bash
set -euo pipefail

BROKER="${PACT_BROKER_URL:-http://127.0.0.1:9292}"
PACTICIPANT="${1:?usage: can-i-deploy.sh <pacticipant> <version> (to <tag> | with <pacticipant> <version>)}"
VERSION="${2:?version is required}"
MODE="${3:-to}"

AUTH=()
[ -n "${PACT_BROKER_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $PACT_BROKER_TOKEN")

case "$MODE" in
  to)
    TAG="${4:-prod}"
    echo "can-i-deploy: $PACTICIPANT@$VERSION to $TAG"
    RESPONSE="$(curl -sS -G ${AUTH[@]+"${AUTH[@]}"} "$BROKER/can-i-deploy" \
      --data-urlencode "pacticipant=$PACTICIPANT" \
      --data-urlencode "version=$VERSION" \
      --data-urlencode "to=$TAG")"
    ;;
  with)
    OTHER="${4:?other pacticipant is required}"
    OTHER_VERSION="${5:?other version is required}"
    echo "can-i-deploy: $PACTICIPANT@$VERSION with $OTHER@$OTHER_VERSION"
    RESPONSE="$(curl -sS -G ${AUTH[@]+"${AUTH[@]}"} "$BROKER/matrix" \
      --data-urlencode "q[][pacticipant]=$PACTICIPANT" \
      --data-urlencode "q[][version]=$VERSION" \
      --data-urlencode "q[][pacticipant]=$OTHER" \
      --data-urlencode "q[][version]=$OTHER_VERSION" \
      --data-urlencode "latestby=cvpv")"
    ;;
  *)
    echo "can-i-deploy: unknown mode '$MODE'" >&2
    exit 2
    ;;
esac

printf '%s' "$RESPONSE" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const summary = JSON.parse(s).summary ?? {};
  console.log("can-i-deploy: " + JSON.stringify(summary));
  process.exit(summary.deployable === true ? 0 : 1);
});
'
