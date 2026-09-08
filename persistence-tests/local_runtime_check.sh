#!/usr/bin/env bash
set -euo pipefail

WRANGLER_VERSION="4.129.0"
LOCAL_CONFIG="wrangler.local.jsonc"
PRODUCT_CONFIG="wrangler.jsonc"
DATABASE="electricity-meter-tracker-local"
STATE_DIR="${RUNNER_TEMP:-.wrangler}/electricity-meter-tracker-d1-runtime"
LOCAL_PORT="${LOCAL_D1_PORT:-8787}"
PRODUCT_PORT="${PRODUCT_WORKER_PORT:-8788}"
LOCAL_LOG="${RUNNER_TEMP:-.wrangler}/electricity-meter-tracker-local-wrangler.log"
PRODUCT_LOG="${RUNNER_TEMP:-.wrangler}/electricity-meter-tracker-product-wrangler.log"
LOCAL_BODY="${RUNNER_TEMP:-.wrangler}/electricity-meter-tracker-local-body.json"
LOCAL_AUTH_BODY="${RUNNER_TEMP:-.wrangler}/electricity-meter-tracker-local-auth-body.json"
RESOURCE_BODY="${RUNNER_TEMP:-.wrangler}/electricity-meter-tracker-resource-body.json"
PRODUCT_BODY="${RUNNER_TEMP:-.wrangler}/electricity-meter-tracker-product-body.json"
PRODUCT_AUTH_BODY="${RUNNER_TEMP:-.wrangler}/electricity-meter-tracker-product-auth-body.json"
LOCAL_PID=""
PRODUCT_PID=""
SESSION_SECRET="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(48))
PY
)"

wrangler() {
  npx --yes "wrangler@${WRANGLER_VERSION}" "$@"
}

cleanup() {
  if [[ -n "${LOCAL_PID}" ]]; then
    kill "${LOCAL_PID}" 2>/dev/null || true
    wait "${LOCAL_PID}" 2>/dev/null || true
  fi
  if [[ -n "${PRODUCT_PID}" ]]; then
    kill "${PRODUCT_PID}" 2>/dev/null || true
    wait "${PRODUCT_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

make_session_cookie() {
  local user_id="$1"
  python3 - "${SESSION_SECRET}" "${user_id}" <<'PY'
import base64
import hashlib
import hmac
import json
import sys
import time

secret = sys.argv[1].encode("utf-8")
user_id = sys.argv[2]
issued_at = int(time.time())
payload = json.dumps(
    {"v": 1, "uid": user_id, "iat": issued_at, "exp": issued_at + 3600},
    separators=(",", ":"),
).encode("utf-8")
payload_part = base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")
signature = hmac.new(secret, payload_part.encode("ascii"), hashlib.sha256).digest()
signature_part = base64.urlsafe_b64encode(signature).rstrip(b"=").decode("ascii")
print(f"__Host-em_session={payload_part}.{signature_part}")
PY
}

mkdir -p "${STATE_DIR}" "$(dirname "${LOCAL_LOG}")"
rm -rf "${STATE_DIR}"
mkdir -p "${STATE_DIR}"

wrangler d1 migrations apply "${DATABASE}" \
  --local \
  --config "${LOCAL_CONFIG}" \
  --persist-to "${STATE_DIR}"

wrangler d1 execute "${DATABASE}" \
  --local \
  --config "${LOCAL_CONFIG}" \
  --persist-to "${STATE_DIR}" \
  --file persistence-tests/local_fixture.sql

wrangler dev \
  --config "${LOCAL_CONFIG}" \
  --persist-to "${STATE_DIR}" \
  --var "LOCAL_PERSISTENCE_CHECK:1" \
  --var "GOOGLE_CLIENT_ID:local-client.apps.googleusercontent.com" \
  --var "SESSION_SECRET:${SESSION_SECRET}" \
  --var "SESSION_TTL_SECONDS:3600" \
  --ip 127.0.0.1 \
  --port "${LOCAL_PORT}" \
  --log-level error >"${LOCAL_LOG}" 2>&1 &
LOCAL_PID=$!

wait_for_status() {
  local pid="$1"
  local log="$2"
  local body="$3"
  local url="$4"
  local expected="$5"
  local status=""
  for _ in $(seq 1 60); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      cat "${log}"
      return 1
    fi
    status="$(curl --silent --show-error --output "${body}" --write-out '%{http_code}' "${url}" || true)"
    if [[ "${status}" == "${expected}" ]]; then
      printf '%s' "${status}"
      return 0
    fi
    sleep 0.5
  done
  cat "${log}"
  echo "Expected ${url} HTTP ${expected}, got ${status:-no response}." >&2
  return 1
}

request_api() {
  local method="$1"
  local path="$2"
  local cookie="$3"
  local expected="$4"
  local body="${5:-}"
  local status=""
  if [[ -n "${body}" ]]; then
    status="$(curl --silent --show-error --output "${RESOURCE_BODY}" --write-out '%{http_code}' \
      --request "${method}" \
      --header "Cookie: ${cookie}" \
      --header "Content-Type: application/json" \
      --data "${body}" \
      "http://127.0.0.1:${LOCAL_PORT}${path}")"
  else
    status="$(curl --silent --show-error --output "${RESOURCE_BODY}" --write-out '%{http_code}' \
      --request "${method}" \
      --header "Cookie: ${cookie}" \
      "http://127.0.0.1:${LOCAL_PORT}${path}")"
  fi
  if [[ "${status}" != "${expected}" ]]; then
    cat "${RESOURCE_BODY}" >&2 || true
    echo "Expected ${method} ${path} HTTP ${expected}, got ${status}." >&2
    return 1
  fi
}

wait_for_status \
  "${LOCAL_PID}" "${LOCAL_LOG}" "${LOCAL_BODY}" \
  "http://127.0.0.1:${LOCAL_PORT}/api/_dev/persistence-check" "200" >/dev/null

python3 - "${LOCAL_BODY}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)

expected = {
    "ok": True,
    "userId": "local-owner",
    "ownerMeterIds": ["local-meter"],
    "viewerMeterIds": ["local-meter"],
    "readingInstants": [1000, 2000],
}
if body != expected:
    raise SystemExit(f"Unexpected local D1 probe response: {body!r}")
PY

wait_for_status \
  "${LOCAL_PID}" "${LOCAL_LOG}" "${LOCAL_AUTH_BODY}" \
  "http://127.0.0.1:${LOCAL_PORT}/api/_dev/auth-check" "200" >/dev/null

python3 - "${LOCAL_AUTH_BODY}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)

expected = {
    "ok": True,
    "stableUser": True,
    "sessionResolved": True,
}
if body != expected:
    raise SystemExit(f"Unexpected local auth probe response: {body!r}")
PY

OWNER_COOKIE="$(make_session_cookie local-owner)"
VIEWER_COOKIE="$(make_session_cookie local-viewer)"
OUTSIDER_COOKIE="$(make_session_cookie local-outsider)"

request_api GET "/api/meters/local-meter" "${OWNER_COOKIE}" 200
request_api GET "/api/meters/local-meter" "${VIEWER_COOKIE}" 200
request_api GET "/api/meters/local-meter" "${OUTSIDER_COOKIE}" 404
request_api POST "/api/meters/local-meter/readings" "${VIEWER_COOKIE}" 403 \
  '{"measuredAtMs":2500,"cumulativeKwh":"101.5"}'
request_api POST "/api/meters/local-meter/readings" "${OWNER_COOKIE}" 201 \
  '{"measuredAtMs":2500,"cumulativeKwh":"101.5"}'

RUNTIME_READING_ID="$(python3 - "${RESOURCE_BODY}" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)
reading = body.get("reading", {})
if reading.get("cumulativeWh") != 101500:
    raise SystemExit(f"Unexpected created reading: {body!r}")
print(reading["readingId"])
PY
)"

request_api PUT "/api/meters/local-meter/readings/${RUNTIME_READING_ID}" "${OWNER_COOKIE}" 200 \
  '{"measuredAtMs":2600,"cumulativeKwh":"101.6"}'
request_api GET "/api/meters/local-meter/readings/${RUNTIME_READING_ID}" "${VIEWER_COOKIE}" 200
request_api PUT "/api/meters/local-meter" "${OWNER_COOKIE}" 200 \
  '{"name":"Local test meter","timezone":"Asia/Seoul","billingClose":{"kind":"month-end"}}'

python3 - "${RESOURCE_BODY}" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)
if body.get("meter", {}).get("billingClose") != {"kind": "month-end"}:
    raise SystemExit(f"Unexpected updated meter: {body!r}")
PY

request_api DELETE "/api/meters/local-meter/readings/${RUNTIME_READING_ID}" "${OWNER_COOKIE}" 204

kill "${LOCAL_PID}" 2>/dev/null || true
wait "${LOCAL_PID}" 2>/dev/null || true
LOCAL_PID=""

wrangler dev \
  --config "${PRODUCT_CONFIG}" \
  --ip 127.0.0.1 \
  --port "${PRODUCT_PORT}" \
  --log-level error >"${PRODUCT_LOG}" 2>&1 &
PRODUCT_PID=$!

assert_product_probe_closed() {
  local path="$1"
  local body="$2"
  wait_for_status \
    "${PRODUCT_PID}" "${PRODUCT_LOG}" "${body}" \
    "http://127.0.0.1:${PRODUCT_PORT}${path}" "404" >/dev/null
  python3 - "${body}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)

expected = {
    "error": {
        "code": "NOT_FOUND",
        "message": "API route not found.",
    }
}
if body != expected:
    raise SystemExit(f"Unexpected product route response: {body!r}")
PY
}

assert_product_probe_closed "/api/_dev/persistence-check" "${PRODUCT_BODY}"
assert_product_probe_closed "/api/_dev/auth-check" "${PRODUCT_AUTH_BODY}"

echo "Local D1/workerd persistence, auth and authorized CRUD round trip verified with Wrangler ${WRANGLER_VERSION}."
