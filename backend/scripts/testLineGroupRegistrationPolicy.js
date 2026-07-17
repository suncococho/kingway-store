const assert = require("assert");
const {
  LINE_GROUP_REGISTRATION_DENIED_MESSAGE,
  LINE_GROUP_REGISTRATION_TYPE_DENIED_MESSAGE,
  canRegisterLineGroup,
  getLineGroupRegistrationDeniedMessage
} = require("../src/services/lineGroupRegistrationPolicy");

function policy(overrides) {
  return {
    role: "STAFF",
    isActive: 1,
    staffStoreId: 1,
    targetStoreId: 1,
    registrationType: "staff",
    ...overrides
  };
}

const cases = [
  ["ADMIN -> staff allowed", policy({ role: "ADMIN", registrationType: "staff" }), true],
  ["ADMIN -> daily allowed", policy({ role: "ADMIN", registrationType: "daily" }), true],
  ["ADMIN -> admin allowed", policy({ role: "ADMIN", registrationType: "admin" }), true],
  ["STAFF -> staff allowed", policy({ role: "STAFF", registrationType: "staff" }), true],
  ["STAFF -> daily denied", policy({ role: "STAFF", registrationType: "daily" }), false],
  ["STAFF -> admin denied", policy({ role: "STAFF", registrationType: "admin" }), false],
  ["inactive STAFF -> staff denied", policy({ role: "STAFF", isActive: 0, registrationType: "staff" }), false],
  ["other store STAFF -> staff denied", policy({ role: "STAFF", staffStoreId: 2, registrationType: "staff" }), false],
  ["no matching staff -> denied", policy({ role: null, isActive: null, staffStoreId: null, registrationType: "staff" }), false]
];

for (const [name, input, expected] of cases) {
  assert.strictEqual(canRegisterLineGroup(input), expected, name);
}

assert.strictEqual(
  getLineGroupRegistrationDeniedMessage(policy({ role: "STAFF", registrationType: "daily" })),
  LINE_GROUP_REGISTRATION_TYPE_DENIED_MESSAGE,
  "STAFF daily denial should use type-specific message"
);
assert.strictEqual(
  getLineGroupRegistrationDeniedMessage(policy({ role: null, isActive: null, staffStoreId: null, registrationType: "staff" })),
  LINE_GROUP_REGISTRATION_DENIED_MESSAGE,
  "missing staff denial should use existing generic message"
);

console.log("line group registration policy tests passed");
