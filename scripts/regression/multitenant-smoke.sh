#!/usr/bin/env bash
set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:3010}"

STORE1_USERNAME="${STORE1_USERNAME:-}"
STORE1_PASSWORD="${STORE1_PASSWORD:-}"
STORE5_USERNAME="${STORE5_USERNAME:-}"
STORE5_PASSWORD="${STORE5_PASSWORD:-}"
STORE1_PRODUCT_ID="${STORE1_PRODUCT_ID:-}"
STORE5_PRODUCT_ID="${STORE5_PRODUCT_ID:-}"
PRODUCT_IMAGE_DIRECT_PATH="${PRODUCT_IMAGE_DIRECT_PATH:-}"
RUN_COUPON_CHECKS="${RUN_COUPON_CHECKS:-false}"
STORE5_EXPECT_COUPONS_STATUS="${STORE5_EXPECT_COUPONS_STATUS:-}"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t multitenant-smoke)"
BODY_FILE="$TMP_DIR/body"

cleanup() {
  rm -f "$BODY_FILE" 2>/dev/null || true
  rmdir "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

log_result() {
  local status="$1"
  local name="$2"
  local detail="${3:-}"
  if [ -n "$detail" ]; then
    printf '[%s] %s - %s\n' "$status" "$name" "$detail"
  else
    printf '[%s] %s\n' "$status" "$name"
  fi

  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
  esac
}

json_get() {
  local expr="$1"
  node -e '
    const fs = require("fs");
    const expr = process.argv[1];
    const input = fs.readFileSync(0, "utf8");
    const data = JSON.parse(input);
    let value = data;
    for (const rawPart of expr.split(".")) {
      if (!rawPart) continue;
      const matches = [...rawPart.matchAll(/([^[\]]+)|\[(\d+)\]/g)];
      for (const match of matches) {
        if (match[1] !== undefined) {
          value = value?.[match[1]];
        } else if (match[2] !== undefined) {
          value = value?.[Number(match[2])];
        }
      }
    }
    if (value === undefined || value === null) {
      process.exit(2);
    }
    if (typeof value === "object") {
      process.stdout.write(JSON.stringify(value));
      process.exit(0);
    }
    process.stdout.write(String(value));
  ' "$expr"
}

http_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local auth_token="${4:-}"

  local url
  if [ "${path#http://}" != "$path" ] || [ "${path#https://}" != "$path" ]; then
    url="$path"
  else
    url="${BASE_URL}${path}"
  fi

  local curl_args
  curl_args=(
    -sS
    -X "$method"
    -o "$BODY_FILE"
    -w "%{http_code}"
    "$url"
    -H "Accept: application/json"
  )

  if [ -n "$auth_token" ]; then
    curl_args+=(-H "Authorization: Bearer $auth_token")
  fi

  if [ -n "$body" ]; then
    curl_args+=(-H "Content-Type: application/json" --data "$body")
  fi

  HTTP_CODE="$(curl "${curl_args[@]}")"
}

expect_http_code() {
  local name="$1"
  local expected="$2"
  local actual="$3"

  if [ "$actual" = "$expected" ]; then
    log_result "PASS" "$name" "HTTP $actual"
    return 0
  fi

  log_result "FAIL" "$name" "expected HTTP $expected, got $actual"
  return 1
}

expect_json_value() {
  local name="$1"
  local expr="$2"
  local expected="$3"

  local actual
  if ! actual="$(json_get "$expr" < "$BODY_FILE" 2>/dev/null)"; then
    log_result "FAIL" "$name" "missing JSON path $expr"
    return 1
  fi

  if [ "$actual" = "$expected" ]; then
    log_result "PASS" "$name" "$expr=$actual"
    return 0
  fi

  log_result "FAIL" "$name" "expected $expr=$expected, got $actual"
  return 1
}

login_staff() {
  local username="$1"
  local password="$2"
  local label="$3"
  local out_var="$4"

  if [ -z "$username" ] || [ -z "$password" ]; then
    log_result "SKIP" "$label" "missing env"
    return 2
  fi

  http_request "POST" "/api/login" "{\"username\":\"$username\",\"password\":\"$password\"}"
  if [ "$HTTP_CODE" != "200" ]; then
    log_result "FAIL" "$label" "HTTP $HTTP_CODE"
    return 1
  fi

  local token
  if ! token="$(json_get "token" < "$BODY_FILE" 2>/dev/null)"; then
    log_result "FAIL" "$label" "token missing in response"
    return 1
  fi

  eval "$out_var=\"\$token\""
  log_result "PASS" "$label" "HTTP 200"
  return 0
}

discover_product_meta() {
  local token="$1"
  local id_var="$2"
  local direct_path_var="$3"

  http_request "GET" "/api/products" "" "$token"
  if [ "$HTTP_CODE" != "200" ]; then
    return 1
  fi

  local first_id=""
  local first_path=""
  first_id="$(json_get "[0].id" < "$BODY_FILE" 2>/dev/null || true)"
  first_path="$(json_get "[0].imagePath" < "$BODY_FILE" 2>/dev/null || true)"

  if [ -n "$first_id" ]; then
    eval "$id_var=\"\$first_id\""
  fi
  if [ -n "$first_path" ]; then
    eval "$direct_path_var=\"\$first_path\""
  fi
}

STORE1_TOKEN=""
STORE5_TOKEN=""
DISCOVERED_STORE1_PRODUCT_ID=""
DISCOVERED_STORE5_PRODUCT_ID=""
DISCOVERED_DIRECT_IMAGE_PATH=""

http_request "GET" "/health"
expect_http_code "health" "200" "$HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
  expect_json_value "health.ok" "ok" "true"
fi

http_request "GET" "/api/system/saas-status"
expect_http_code "saas-status" "200" "$HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
  expect_json_value "saas-status.ok" "ok" "true"
fi

if login_staff "$STORE1_USERNAME" "$STORE1_PASSWORD" "store1 login" "STORE1_TOKEN"; then
  :
else
  rc=$?
  if [ "$rc" -eq 2 ]; then
    STORE1_TOKEN=""
  else
    STORE1_TOKEN=""
  fi
fi

if login_staff "$STORE5_USERNAME" "$STORE5_PASSWORD" "store5 login" "STORE5_TOKEN"; then
  :
else
  rc=$?
  if [ "$rc" -eq 2 ]; then
    STORE5_TOKEN=""
  else
    STORE5_TOKEN=""
  fi
fi

if [ -n "$STORE1_TOKEN" ]; then
  http_request "GET" "/api/store/settings" "" "$STORE1_TOKEN"
  expect_http_code "store1 settings GET" "200" "$HTTP_CODE"

  http_request "GET" "/api/store/settings/line" "" "$STORE1_TOKEN"
  expect_http_code "store1 line settings GET" "200" "$HTTP_CODE"

  if [ -z "$STORE1_PRODUCT_ID" ]; then
    discover_product_meta "$STORE1_TOKEN" "DISCOVERED_STORE1_PRODUCT_ID" "_unused_store1_path"
  fi
else
  log_result "SKIP" "store1 settings GET" "login unavailable"
  log_result "SKIP" "store1 line settings GET" "login unavailable"
fi

if [ -n "$STORE5_TOKEN" ]; then
  http_request "GET" "/api/store/settings" "" "$STORE5_TOKEN"
  expect_http_code "store5 settings GET" "200" "$HTTP_CODE"

  http_request "GET" "/api/store/settings/line" "" "$STORE5_TOKEN"
  expect_http_code "store5 line settings GET" "200" "$HTTP_CODE"

  if [ -z "$STORE5_PRODUCT_ID" ] || [ -z "$PRODUCT_IMAGE_DIRECT_PATH" ]; then
    discover_product_meta "$STORE5_TOKEN" "DISCOVERED_STORE5_PRODUCT_ID" "DISCOVERED_DIRECT_IMAGE_PATH"
  fi
else
  log_result "SKIP" "store5 settings GET" "login unavailable"
  log_result "SKIP" "store5 line settings GET" "login unavailable"
fi

DIRECT_IMAGE_PATH="$PRODUCT_IMAGE_DIRECT_PATH"
if [ -z "$DIRECT_IMAGE_PATH" ] && [ -n "$DISCOVERED_DIRECT_IMAGE_PATH" ]; then
  DIRECT_IMAGE_PATH="$DISCOVERED_DIRECT_IMAGE_PATH"
fi

if [ -n "$DIRECT_IMAGE_PATH" ]; then
  http_request "GET" "$DIRECT_IMAGE_PATH"
  expect_http_code "product image direct path blocked" "404" "$HTTP_CODE"
else
  log_result "SKIP" "product image direct path blocked" "sample path unavailable"
fi

EFFECTIVE_STORE5_PRODUCT_ID="$STORE5_PRODUCT_ID"
if [ -z "$EFFECTIVE_STORE5_PRODUCT_ID" ] && [ -n "$DISCOVERED_STORE5_PRODUCT_ID" ]; then
  EFFECTIVE_STORE5_PRODUCT_ID="$DISCOVERED_STORE5_PRODUCT_ID"
fi

if [ -n "$STORE1_TOKEN" ] && [ -n "$EFFECTIVE_STORE5_PRODUCT_ID" ]; then
  http_request "GET" "/api/products/${EFFECTIVE_STORE5_PRODUCT_ID}/image" "" "$STORE1_TOKEN"
  if [ "$HTTP_CODE" = "404" ] || [ "$HTTP_CODE" = "403" ]; then
    log_result "PASS" "gated product image cross-store blocked" "HTTP $HTTP_CODE"
  else
    log_result "FAIL" "gated product image cross-store blocked" "expected 403/404, got $HTTP_CODE"
  fi
else
  log_result "SKIP" "gated product image cross-store blocked" "store1 login or store5 product id unavailable"
fi

if [ "$RUN_COUPON_CHECKS" = "true" ]; then
  if [ -n "$STORE5_TOKEN" ] && [ -n "$STORE5_EXPECT_COUPONS_STATUS" ]; then
    http_request "GET" "/api/coupons" "" "$STORE5_TOKEN"
    expect_http_code "store5 coupons status" "$STORE5_EXPECT_COUPONS_STATUS" "$HTTP_CODE"
  else
    log_result "SKIP" "store5 coupons status" "missing login or expected status env"
  fi
else
  log_result "SKIP" "store5 coupons status" "RUN_COUPON_CHECKS not enabled"
fi

http_request "GET" "/api/storefront/resolve-store?store=INVALID"
expect_http_code "public store resolver invalid store" "404" "$HTTP_CODE"

http_request "GET" "/api/line-order/customer?lineUserId=KW_REHEARSAL_SMOKE&store=INVALID"
expect_http_code "line-order invalid store" "404" "$HTTP_CODE"

http_request "GET" "/api/line-repair/customer?lineUserId=KW_REHEARSAL_SMOKE&store=INVALID"
expect_http_code "line-repair invalid store" "404" "$HTTP_CODE"

printf '\nSummary: PASS=%s FAIL=%s SKIP=%s\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi

exit 0
