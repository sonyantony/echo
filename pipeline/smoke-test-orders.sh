#!/usr/bin/env bash
# Smoke test for the golden "orders" flow image: starts the mock fulfilment service, runs the
# image, checks its health endpoint and that POST /orders returns the mapped response. With
# --bundle the image is a bundle of samples/flows, and the greetings flow is checked too (its
# operations, body validation and Swagger UI, and the bundle's combined page at /api-docs).
#
#   pipeline/smoke-test-orders.sh [image] [--bundle]
#     image default: echo-flow-orders:1.0.0 (per-flow), or echo-flows:1.0.0 with --bundle
#
# Needs Docker and Java. Uses host networking so the flow reaches the mock on localhost:9090.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
BUNDLE=""; IMAGE=""
for arg in "$@"; do
  if [[ "$arg" == --bundle ]]; then BUNDLE=1; else IMAGE="$arg"; fi
done
IMAGE="${IMAGE:-$([[ -n "$BUNDLE" ]] && echo echo-flows:1.0.0 || echo echo-flow-orders:1.0.0)}"
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
if [[ -n "$BUNDLE" ]]; then
  echo "==> GET /greetings/Ann and DELETE /greetings/Ann (contract-first flow in the same image)"
  RESPONSE="$(curl -fsS localhost:8080/greetings/Ann)"
  echo "$RESPONSE"
  [[ "$RESPONSE" == '{"greeting":"Hello Ann"}' ]] || { echo "Unexpected greeting" >&2; docker logs echo-smoke-orders | tail -30; exit 1; }
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' -XDELETE localhost:8080/greetings/Ann)"
  [[ "$STATUS" == 404 ]] || { echo "DELETE has no route, expected 404, got $STATUS" >&2; exit 1; }
  echo "==> POST /greetings/ with a body that does not fit the spec (Client Request Validation)"
  BAD="$(curl -s -w ' %{http_code}' -XPOST localhost:8080/greetings/ -H 'Content-Type: application/json' -d '{"nam":"Ann"}')"
  echo "$BAD"
  [[ "$BAD" == *"missing required properties"*'"name"'*" 400" ]] || { echo "Expected a 400 naming the field" >&2; exit 1; }
  echo "==> Swagger UI at /greetings/docs"
  curl -fsS localhost:8080/greetings/docs | grep -q 'SwaggerUIBundle' || { echo "No Swagger UI page" >&2; exit 1; }
  curl -fsS -o /dev/null localhost:8080/greetings/docs/swagger-ui-bundle.js || { echo "No Swagger UI script" >&2; exit 1; }
  curl -fsS localhost:8080/greetings/docs/openapi | grep -q 'operationId: getGreeting' || { echo "No spec" >&2; exit 1; }
  echo "==> Combined Swagger UI at /api-docs"
  curl -fsS localhost:8080/api-docs | grep -q "urls: \[{url: 'greetings/docs/openapi', name: 'greetings'}\]" \
    || { echo "No combined API docs page listing greetings" >&2; exit 1; }
  curl -fsS -o /dev/null localhost:8080/api-docs/swagger-ui-standalone-preset.js || { echo "No Swagger UI preset" >&2; exit 1; }
fi
echo "Smoke test passed"
