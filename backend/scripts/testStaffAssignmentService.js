const assert = require("assert");
const {
  STAFF_ASSIGNMENT_ROLES,
  resolveStaffAssignment,
  listStaffSelectOptions
} = require("../src/services/staffAssignmentService");

function createFakeConnection(seedRows) {
  let rows = seedRows.map((row) => ({ ...row }));
  return {
    updateDisplayName(id, displayName) {
      rows = rows.map((row) => row.id === id ? { ...row, displayName } : row);
    },
    async query(sql, params) {
      const storeId = Number(params[0]);
      const staffId = params.length > 2 ? Number(params[1]) : null;
      const allowedRoles = params[params.length - 1];
      const allowed = new Set(allowedRoles);
      const filtered = rows
        .filter((row) => row.storeId === storeId)
        .filter((row) => row.membershipStatus === "active")
        .filter((row) => row.isActive === 1)
        .filter((row) => allowed.has(row.role))
        .filter((row) => staffId ? row.id === staffId : true)
        .map((row) => ({
          id: row.id,
          displayName: String(row.displayName || row.username).trim() || row.username,
          role: row.role,
          username: row.username
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id - b.id);
      return [filtered];
    }
  };
}

async function assertRejectsMessage(promise, message) {
  await assert.rejects(promise, (error) => {
    assert.strictEqual(error.message, message);
    return true;
  });
}

(async () => {
  const connection = createFakeConnection([
    { id: 1, username: "admin", displayName: "王店長", role: "ADMIN", storeId: 10, membershipStatus: "active", isActive: 1 },
    { id: 2, username: "cashier", displayName: "林銷售", role: "CASHIER", storeId: 10, membershipStatus: "active", isActive: 1 },
    { id: 3, username: "repair", displayName: "陳維修", role: "REPAIR", storeId: 10, membershipStatus: "active", isActive: 1 },
    { id: 4, username: "other_store", displayName: "其他門市", role: "REPAIR", storeId: 20, membershipStatus: "active", isActive: 1 },
    { id: 5, username: "inactive", displayName: "停用員工", role: "REPAIR", storeId: 10, membershipStatus: "active", isActive: 0 },
    { id: 6, username: "viewer", displayName: "不允許角色", role: "VIEWER", storeId: 10, membershipStatus: "active", isActive: 1 },
    { id: 7, username: "inventory_user", displayName: "", role: "INVENTORY", storeId: 10, membershipStatus: "active", isActive: 1 }
  ]);

  const orderAssignment = await resolveStaffAssignment(connection, 10, 2, "銷售人員");
  assert.deepStrictEqual(orderAssignment, { id: 2, name: "林銷售", role: "CASHIER" });

  const repairAssignment = await resolveStaffAssignment(connection, 10, 3, "維修人員");
  assert.deepStrictEqual(repairAssignment, { id: 3, name: "陳維修", role: "REPAIR" });

  await assertRejectsMessage(resolveStaffAssignment(connection, 10, 4, "維修人員"), "只能選擇同門市啟用中的員工");
  await assertRejectsMessage(resolveStaffAssignment(connection, 10, 5, "維修人員"), "只能選擇同門市啟用中的員工");
  await assertRejectsMessage(resolveStaffAssignment(connection, 10, 6, "銷售人員"), "只能選擇同門市啟用中的員工");

  assert.deepStrictEqual(await resolveStaffAssignment(connection, 10, null, "銷售人員"), { id: null, name: null, role: null });
  assert.strictEqual(await resolveStaffAssignment(connection, 10, undefined, "銷售人員"), undefined);

  const snapshot = await resolveStaffAssignment(connection, 10, 2, "銷售人員");
  connection.updateDisplayName(2, "林新名");
  assert.strictEqual(snapshot.name, "林銷售");
  assert.strictEqual((await resolveStaffAssignment(connection, 10, 2, "銷售人員")).name, "林新名");

  const options = await listStaffSelectOptions(connection, 10);
  assert(options.length >= 4);
  for (const option of options) {
    assert.deepStrictEqual(Object.keys(option).sort(), ["displayName", "id", "role"]);
    assert(STAFF_ASSIGNMENT_ROLES.includes(option.role));
    assert.notStrictEqual(option.displayName, "其他門市");
    assert.notStrictEqual(option.displayName, "停用員工");
    assert.notStrictEqual(option.displayName, "不允許角色");
  }
  assert(options.some((option) => option.id === 7 && option.displayName === "inventory_user"));

  console.log("staff assignment service tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
