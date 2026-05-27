const assert = require("assert");
const { resolveSecretRef } = require("../src/utils/lineSecretResolver");

const smokeSecret = "line-secret-smoke-value-1234567890";

function assertNoSecretLeak(result) {
  assert.strictEqual(JSON.stringify(result).includes(smokeSecret), false);
  assert.strictEqual(Object.prototype.propertyIsEnumerable.call(result, "secret"), false);
}

function run() {
  const existing = resolveSecretRef("env:LINE_CHANNEL_SECRET", {
    env: {
      LINE_CHANNEL_SECRET: smokeSecret
    }
  });
  assert.strictEqual(existing.resolved, true);
  assert.strictEqual(existing.secret, smokeSecret);
  assert.strictEqual(existing.audit.secretLength, smokeSecret.length);
  assert.match(existing.audit.secretHashPrefix, /^sha256:[a-f0-9]{12}$/);
  assertNoSecretLeak(existing);

  const missing = resolveSecretRef("env:LINE_CHANNEL_SECRET", { env: {} });
  assert.strictEqual(missing.resolved, false);
  assert.strictEqual(missing.reason, "secret_env_missing");

  const disabled = resolveSecretRef("env:LINE_CHANNEL_SECRET", {
    env: {
      LINE_CHANNEL_SECRET: "<CHANGE_ME_DISABLED>"
    }
  });
  assert.strictEqual(disabled.resolved, false);
  assert.strictEqual(disabled.reason, "secret_disabled_placeholder");

  const invalidRefs = [
    ["file:/run/secrets/line", "secret_ref_unsupported_scheme"],
    ["http://example.test/secret", "secret_ref_unsupported_scheme"],
    [smokeSecret, "secret_ref_raw_literal_not_allowed"],
    ["vault:line-secret", "secret_ref_unsupported_scheme"],
    ["env:line_channel_secret", "secret_ref_invalid_env_name"],
    ["", "secret_ref_blank"],
    [null, "secret_ref_blank"]
  ];

  for (const [ref, reason] of invalidRefs) {
    const result = resolveSecretRef(ref, { env: {} });
    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.reason, reason);
    assertNoSecretLeak(result);
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      "env existing key",
      "missing env",
      "disabled placeholder",
      "invalid ref format",
      "raw secret not enumerable or JSON-logged"
    ]
  }));
}

run();
