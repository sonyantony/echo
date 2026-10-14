#!/usr/bin/env bash
# Smoke test for the golden "orders" flow image: starts the mock fulfilment service, runs the
# image, checks its health endpoint and that POST /orders returns the mapped response.
#
#   pipeline/smoke-test-orders.sh [image]     (default: echo-flow-orders:1.0.0, built with --local-image)
#
# Needs Docker and Java. Uses host networking so the flow reaches the mock on localhost:9090.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
IMAGE="${1:-echo-flow-orders:1.0.0}"
CAMEL_VERSION="$(grep -E '^camel.version=' "$ROOT/runtime-template/versions.properties" | cut -d= -f2-)"
QUARKUS_VERSION="$(grep -E '^quarkus.version=' "$ROOT/runtime-template/versions.properties" | cut -d= -f2-)"
JAR="${CAMEL_LAUNCHER_JAR:-$HOME/.echo/camel-launcher-$CAMEL_VERSION.jar}"
[[ -f "$JAR" ]] || { echo "Camel launcher not found at $JAR (run build-flow.sh first)" >&2; exit 1; }

LOGS="$(mktemp -d)"
cleanup() {
  docker rm -f echo-smoke-orders >/dev/null 2>&1 || true
  [[ -n "${MOCK_PID:-}" ]] && kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

wait_for() { # url, seconds
  for _ in $(seq 1 "$2"); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done
  return 1
}

echo "==> Starting the mock fulfilment service on :9090"
java -jar "$JAR" run "$ROOT/samples/mock-downstream/fulfilment-mock.camel.yaml" --port=9090 \
  --quarkus-version="$QUARKUS_VERSION" > "$LOGS/mock.log" 2>&1 &
MOCK_PID=$!

echo "==> Starting $IMAGE on :8080"
docker run -d --name echo-smoke-orders --network host "$IMAGE" > /dev/null

if ! wait_for http://localhost:8080/actuator/health/readiness 120; then
  docker logs echo-smoke-orders | tail -50; exit 1
fi
# The mock is a POST endpoint; any HTTP answer means it is up.
for _ in $(seq 1 120); do curl -s -o /dev/null -XPOST localhost:9090/fulfilment -d '{}' && break; sleep 1; done

echo "==> POST /orders"
RESPONSE="$(curl -fsS -XPOST localhost:8080/orders -H 'Content-Type: application/json' \
  -d @"$ROOT/samples/flows/orders/sample-request.json")"
echo "$RESPONSE"
EXPECTED='{"orderId":"A100","fulfilmentId":"FUL-A100","status":"ACCEPTED"}'
if [[ "$RESPONSE" != "$EXPECTED" ]]; then
  echo "Expected $EXPECTED" >&2
  docker logs echo-smoke-orders | tail -30; tail -20 "$LOGS/mock.log"; exit 1
fi
grep -q '"lines":\[{"product":"SKU-1","quantity":2}' "$LOGS/mock.log" || {
  echo "The downstream request was not mapped as expected" >&2; tail -20 "$LOGS/mock.log"; exit 1; }
docker logs echo-smoke-orders >"$LOGS/flow.log" 2>&1
grep -q '"@timestamp"' "$LOGS/flow.log" || { echo "Logs are not JSON" >&2; tail -20 "$LOGS/flow.log"; exit 1; }
echo "Smoke test passed"
