const assert = require("assert");
const {
  LINE_GROUP_REGISTRATION_DENIED_MESSAGE,
  LINE_GROUP_REGISTRATION_TYPE_DENIED_MESSAGE,
  canRegisterLineGroup,
  getLineGroupRegistrationDeniedMessage
} = require("../src/services/lineGroupRegistrationPolicy");

const EMPLOYEE_ROLES = ["MANAGER", "CASHIER", "REPAIR", "INVENTORY"];
const STAFF_REGISTRATION_ROLES = ["ADMIN", ...EMPLOYEE_ROLES];
const ADMIN_ONLY_REGISTRATION_TYPES = ["daily", "admin", "repair"];

function policy(overrides) {
  return {
    role: "CASHIER",
    isActive: 1,
    staffStoreId: 1,
    targetStoreId: 1,
    registrationType: "staff",
    ...overrides
  };
}

const cases = [
  ...STAFF_REGISTRATION_ROLES.map((role) => [
    `${role} -> staff allowed`,
    policy({ role, registrationType: "staff" }),
    true
  ]),
  ...ADMIN_ONLY_REGISTRATION_TYPES.map((registrationType) => [
    `ADMIN -> ${registrationType} allowed`,
    policy({ role: "ADMIN", registrationType }),
    true
  ]),
  ...EMPLOYEE_ROLES.flatMap((role) => ADMIN_ONLY_REGISTRATION_TYPES.map((registrationType) => [
    `${role} -> ${registrationType} denied`,
    policy({ role, registrationType }),
    false
  ])),
  ["inactive employee -> staff denied", policy({ role: "CASHIER", isActive: 0, registrationType: "staff" }), false],
  ["other store employee -> staff denied", policy({ role: "CASHIER", staffStoreId: 2, registrationType: "staff" }), false],
  ["unknown role -> staff denied", policy({ role: "STAFF", registrationType: "staff" }), false],
  ["no matching account -> denied", policy({ role: null, isActive: null, staffStoreId: null, registrationType: "staff" }), false]
];

for (const [name, input, expected] of cases) {
  assert.strictEqual(canRegisterLineGroup(input), expected, name);
}

for (const role of EMPLOYEE_ROLES) {
  for (const registrationType of ADMIN_ONLY_REGISTRATION_TYPES) {
    assert.strictEqual(
      getLineGroupRegistrationDeniedMessage(policy({ role, registrationType })),
      LINE_GROUP_REGISTRATION_TYPE_DENIED_MESSAGE,
      `${role} ${registrationType} denial should use type-specific message`
    );
  }
}

assert.strictEqual(
  getLineGroupRegistrationDeniedMessage(policy({ role: null, isActive: null, staffStoreId: null, registrationType: "staff" })),
  LINE_GROUP_REGISTRATION_DENIED_MESSAGE,
  "missing staff denial should use existing generic message"
);

console.log("line group registration policy tests passed");
