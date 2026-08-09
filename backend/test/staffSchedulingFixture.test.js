"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fixture = require("../scripts/staging/staffSchedulingFixture");

const goodEnv = {
  APP_ENV: "staging_restore",
  DB_HOST: "kingway-staging-mysql",
  DB_NAME: "kingway_store",
  STAGING_FIXTURE_ALLOWED_DB_HOSTS: "kingway-staging-mysql",
  STAGING_FIXTURE_ALLOWED_DB_NAMES: "kingway_store"
};
const options = (extra = {}) => ({
  env: goodEnv,
  confirmed: true,
  runId: "run_20260810",
  password: "temporary-secret",
  hashPassword: async () => "$2fixturehash",
  directory: "/tmp/fixtures",
  now: new Date("2026-08-10T00:00:00Z"),
  ...extra
});
function memoryFs() {
  const files = new Map();
  return {
    files,
    existsSync: (file) => files.has(file),
    mkdirSync() {},
    writeFileSync(file, value, writeOptions) {
      if (writeOptions.flag === "wx" && files.has(file)) throw new Error("exists");
      files.set(file, value);
    },
    readFileSync: (file) => files.get(file),
    unlinkSync: (file) => files.delete(file)
  };
}
function fakeDb({ collision, failInsertAt, cleanupMismatch, cleanupErrorAt, deleteAffectedRows } = {}) {
  const state = { inserted: [], outsideRows: ["real-store-row"], deleted: [] };
  const queries = [];
  let nextId = 10;
  let insertCount = 0;
  const db = {
    state,
    queries,
    withTransaction: async (handler) => {
      const snapshot = JSON.parse(JSON.stringify(state));
      const connection = {
        query: async (sql, params) => {
          queries.push({ sql, params });
          if (sql === "SELECT id FROM stores WHERE code=?") return [[...(collision === "store" ? [{ id: 1 }] : [])]];
          if (sql === "SELECT id FROM staff_users WHERE username=?") {
            const username = params[0];
            const hit = (collision === "staff" && username.endsWith("_staff")) || (collision === "admin" && username.endsWith("_admin"));
            return [[...(hit ? [{ id: 2 }] : [])]];
          }
          if (sql.startsWith("INSERT")) {
            insertCount += 1;
            if (failInsertAt === insertCount) throw new Error("db failure");
            state.inserted.push(sql);
            return [{ insertId: nextId++, affectedRows: 1 }];
          }
          if (sql.startsWith("SELECT id,code FROM stores")) {
            const code = cleanupMismatch === "store" ? "wrong_store" : "kw_stg_sched_run_20260810";
            return [[{ id: 10, code }]];
          }
          if (sql.startsWith("SELECT id,username FROM staff_users")) {
            const staffUsername = cleanupMismatch === "user" ? "wrong_staff" : "kw_stg_sched_run_20260810_staff";
            return [[{ id: 11, username: "kw_stg_sched_run_20260810_admin" }, { id: 12, username: staffUsername }]];
          }
          if (sql.startsWith("SELECT id,store_id,staff_user_id FROM store_memberships")) {
            return [[{ id: 13, store_id: 10, staff_user_id: 11 }, { id: 14, store_id: 10, staff_user_id: 12 }]];
          }
          if (sql.startsWith("SELECT COUNT(*)")) return [[{ rowCount: 0 }]];
          if (sql.startsWith("DELETE")) {
            if (cleanupErrorAt && state.deleted.length + 1 === cleanupErrorAt) throw new Error("cleanup failure");
            state.deleted.push({ sql, params });
            const expected = sql.startsWith("DELETE FROM store_memberships") || sql.startsWith("DELETE FROM staff_users") ? 2 : sql.startsWith("DELETE FROM stores") ? 1 : 0;
            return [{ affectedRows: deleteAffectedRows ?? expected }];
          }
          throw new Error(`unexpected SQL: ${sql}`);
        }
      };
      try {
        return await handler(connection);
      } catch (error) {
        state.inserted = snapshot.inserted;
        state.outsideRows = snapshot.outsideRows;
        state.deleted = snapshot.deleted;
        throw error;
      }
    }
  };
  return db;
}
async function createManifest(db = fakeDb(), fsApi = memoryFs()) {
  await fixture.createFixture(options({ db, fsApi }));
  db.queries.length = 0;
  db.state.deleted.length = 0;
  return { db, fsApi };
}

test("rejects non-staging, unapproved DB, production-looking DB, and missing confirmation", () => {
  assert.throws(() => fixture.validateSafety({ ...goodEnv, APP_ENV: "production" }, true), /staging/);
  assert.throws(() => fixture.validateSafety({ ...goodEnv, DB_HOST: "other" }, true), /allowlist/);
  assert.throws(() => fixture.validateSafety({ ...goodEnv, DB_HOST: "production-db", STAGING_FIXTURE_ALLOWED_DB_HOSTS: "production-db" }, true), /Production/);
  assert.throws(() => fixture.validateSafety(goodEnv, false), /confirm-staging/);
});
for (const collision of ["store", "staff", "admin"]) {
  test(`rejects existing ${collision} identifier before inserts without updating or reusing records`, async () => {
    const db = fakeDb({ collision });
    const fsApi = memoryFs();
    await assert.rejects(fixture.createFixture(options({ db, fsApi })), /已存在/);
    assert.equal(db.state.inserted.length, 0);
    assert.equal(fsApi.files.size, 0);
    assert.equal(db.queries.some(({ sql }) => /^(UPDATE|DELETE)/.test(sql)), false);
  });
}
test("transaction failure rolls back all fixture rows and removes an incomplete manifest", async () => {
  const db = fakeDb({ failInsertAt: 2 });
  const fsApi = memoryFs();
  await assert.rejects(fixture.createFixture(options({ db, fsApi })), /db failure/);
  assert.equal(db.state.inserted.length, 0);
  assert.equal(fsApi.files.size, 0);
});
test("create records IDs in a secret-free manifest and refuses an existing run manifest before DB access", async () => {
  const db = fakeDb();
  const fsApi = memoryFs();
  const result = await fixture.createFixture(options({ db, fsApi }));
  const text = [...fsApi.files.values()][0];
  assert.ok(result.manifest.ids.storeId);
  assert.doesNotMatch(text, /temporary-secret|\$2fixturehash|token|session|password/i);
  const queryCount = db.queries.length;
  await assert.rejects(fixture.createFixture(options({ db, fsApi })), /manifest 已存在/);
  assert.equal(db.queries.length, queryCount);
});
test("cleanup defaults to dry-run and does not issue DELETE", async () => {
  const { db, fsApi } = await createManifest();
  const result = await fixture.cleanupFixture(options({ db, fsApi }));
  assert.equal(result.dryRun, true);
  assert.equal(db.queries.some(({ sql }) => sql.startsWith("DELETE")), false);
});
test("cleanup rejects a manifest identity outside the fixture prefix", async () => {
  const { db, fsApi } = await createManifest();
  const file = [...fsApi.files.keys()][0];
  const manifest = JSON.parse(fsApi.files.get(file));
  manifest.identifiers.staffUsername = "real_staff";
  fsApi.files.set(file, JSON.stringify(manifest));
  await assert.rejects(fixture.cleanupFixture(options({ db, fsApi, deleteConfirmed: true })), /prefix/);
  assert.equal(db.queries.some(({ sql }) => sql.startsWith("DELETE")), false);
});
for (const mismatch of ["store", "user"]) {
  test(`cleanup rejects ${mismatch} ID/name mismatch before DELETE`, async () => {
    const { db, fsApi } = await createManifest(fakeDb({ cleanupMismatch: mismatch }));
    await assert.rejects(fixture.cleanupFixture(options({ db, fsApi, deleteConfirmed: true })), /驗證失敗/);
    assert.equal(db.queries.some(({ sql }) => sql.startsWith("DELETE")), false);
    assert.equal(fsApi.files.size, 1);
  });
}
test("cleanup only uses the fixture store and manifest account IDs", async () => {
  const { db, fsApi } = await createManifest();
  await fixture.cleanupFixture(options({ db, fsApi, deleteConfirmed: true }));
  assert.equal(db.state.outsideRows.length, 1);
  for (const { sql, params } of db.state.deleted) {
    assert.equal(/TRUNCATE|DROP/i.test(sql), false);
    if (sql.includes("store_id")) assert.equal(params[0], 10);
  }
  const userDelete = db.state.deleted.find(({ sql }) => sql.startsWith("DELETE FROM staff_users"));
  assert.deepEqual(userDelete.params, [11, "kw_stg_sched_run_20260810_admin", 12, "kw_stg_sched_run_20260810_staff"]);
});
test("cleanup error rolls back every DELETE and preserves the manifest", async () => {
  const { db, fsApi } = await createManifest(fakeDb({ cleanupErrorAt: 2 }));
  await assert.rejects(fixture.cleanupFixture(options({ db, fsApi, deleteConfirmed: true })), /cleanup failure/);
  assert.equal(db.state.deleted.length, 0);
  assert.equal(db.state.outsideRows.length, 1);
  assert.equal(fsApi.files.size, 1);
});
test("cleanup affected-row mismatch rolls back and preserves the manifest", async () => {
  const { db, fsApi } = await createManifest(fakeDb({ deleteAffectedRows: 9 }));
  await assert.rejects(fixture.cleanupFixture(options({ db, fsApi, deleteConfirmed: true })), /清理筆數不符/);
  assert.equal(db.state.deleted.length, 0);
  assert.equal(fsApi.files.size, 1);
});
