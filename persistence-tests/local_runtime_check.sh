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
PRODUCT_BODY="${RUNNER_TEMP:-.wrangler}/electricity-meter-tracker-product-body.json"
LOCAL_PID=""
PRODUCT_PID=""

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

mkdir -p "${STATE_DIR}" "$(dirname "${LOCAL_LOG}")"
rm -rf "${STATE_DIR}"
mkdir -p "${STATE_DIR}"

wrangler d1 migrations apply "${DATABASE}" \
  --local \
  --yes \
  --config "${LOCAL_CONFIG}" \
  --persist-to "${STATE_DIR}"

wrangler d1 execute "${DATABASE}" \
  --local \
  --yes \
  --config "${LOCAL_CONFIG}" \
  --persist-to "${STATE_DIR}" \
  --file persistence-tests/local_fixture.sql

wrangler dev \
  --config "${LOCAL_CONFIG}" \
  --persist-to "${STATE_DIR}" \
  --ip 127.0.0.1 \
  --port "${LOCAL_PORT}" \
  --log-level error >"${LOCAL_LOG}" 2>&1 &
LOCAL_PID=$!

local_status=""
for _ in $(seq 1 60); do
  if ! kill -0 "${LOCAL_PID}" 2>/dev/null; then
    cat "${LOCAL_LOG}"
    exit 1
  fi
  local_status="$(curl --silent --show-error --output "${LOCAL_BODY}" --write-out '%{http_code}' "http://127.0.0.1:${LOCAL_PORT}/api/_dev/persistence-check" || true)"
  if [[ "${local_status}" == "200" ]]; then
    break
  fi
  sleep 0.5
done

if [[ "${local_status}" != "200" ]]; then
  cat "${LOCAL_LOG}"
  echo "Expected local persistence probe HTTP 200, got ${local_status:-no response}." >&2
  exit 1
fi

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

kill "${LOCAL_PID}" 2>/dev/null || true
wait "${LOCAL_PID}" 2>/dev/null || true
LOCAL_PID=""

wrangler dev \
  --config "${PRODUCT_CONFIG}" \
  --ip 127.0.0.1 \
  --port "${PRODUCT_PORT}" \
  --log-level error >"${PRODUCT_LOG}" 2>&1 &
PRODUCT_PID=$!

product_status=""
for _ in $(seq 1 60); do
  if ! kill -0 "${PRODUCT_PID}" 2>/dev/null; then
    cat "${PRODUCT_LOG}"
    exit 1
  fi
  product_status="$(curl --silent --show-error --output "${PRODUCT_BODY}" --write-out '%{http_code}' "http://127.0.0.1:${PRODUCT_PORT}/api/_dev/persistence-check" || true)"
  if [[ "${product_status}" != "000" && -n "${product_status}" ]]; then
    break
  fi
  sleep 0.5
done

if [[ "${product_status}" != "404" ]]; then
  cat "${PRODUCT_LOG}"
  echo "Expected product config probe HTTP 404, got ${product_status:-no response}." >&2
  exit 1
fi

python3 - "${PRODUCT_BODY}" <<'PY'
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

echo "Local D1/workerd round trip verified with Wrangler ${WRANGLER_VERSION}."
