const crypto = require("crypto");

const DISABLED_PLACEHOLDER = "<CHANGE_ME_DISABLED>";
const ENV_REF_PREFIX = "env:";
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function buildSecretHashPrefix(secret) {
  return `sha256:${crypto.createHash("sha256").update(secret).digest("hex").slice(0, 12)}`;
}

function failure(reason, audit = {}) {
  return {
    resolved: false,
    reason,
    audit: {
      resolved: false,
      ...audit
    }
  };
}

function success(secret, audit) {
  const result = {
    resolved: true,
    reason: null,
    audit: {
      resolved: true,
      ...audit,
      secretLength: secret.length,
      secretHashPrefix: buildSecretHashPrefix(secret)
    }
  };

  Object.defineProperty(result, "secret", {
    value: secret,
    enumerable: false,
    configurable: false,
    writable: false
  });

  return result;
}

function resolveSecretRef(ref, options = {}) {
  const env = options.env || process.env;

  if (ref == null) {
    return failure("secret_ref_blank", { refPresent: false });
  }

  if (typeof ref !== "string") {
    return failure("secret_ref_invalid_type", { refPresent: true, refType: typeof ref });
  }

  const normalizedRef = ref.trim();
  if (!normalizedRef) {
    return failure("secret_ref_blank", { refPresent: true });
  }

  if (normalizedRef === DISABLED_PLACEHOLDER) {
    return failure("secret_ref_disabled_placeholder", { refPresent: true });
  }

  if (!normalizedRef.includes(":")) {
    return failure("secret_ref_raw_literal_not_allowed", { refPresent: true });
  }

  const scheme = normalizedRef.slice(0, normalizedRef.indexOf(":")).toLowerCase();
  if (!normalizedRef.startsWith(ENV_REF_PREFIX)) {
    return failure("secret_ref_unsupported_scheme", {
      refPresent: true,
      refScheme: scheme || "unknown"
    });
  }

  const envName = normalizedRef.slice(ENV_REF_PREFIX.length).trim();
  if (!ENV_NAME_PATTERN.test(envName)) {
    return failure("secret_ref_invalid_env_name", {
      refPresent: true,
      refScheme: "env"
    });
  }

  if (!Object.prototype.hasOwnProperty.call(env, envName)) {
    return failure("secret_env_missing", {
      refPresent: true,
      refScheme: "env",
      envName
    });
  }

  const secret = env[envName];
  if (secret == null || String(secret).trim() === "") {
    return failure("secret_blank", {
      refPresent: true,
      refScheme: "env",
      envName
    });
  }

  const normalizedSecret = String(secret);
  if (normalizedSecret.trim() === DISABLED_PLACEHOLDER) {
    return failure("secret_disabled_placeholder", {
      refPresent: true,
      refScheme: "env",
      envName
    });
  }

  return success(normalizedSecret, {
    refPresent: true,
    refScheme: "env",
    envName
  });
}

module.exports = {
  DISABLED_PLACEHOLDER,
  resolveSecretRef
};
