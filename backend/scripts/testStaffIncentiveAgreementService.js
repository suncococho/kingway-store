const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kingway-incentive-agreement-"));
process.env.STAFF_INCENTIVE_AGREEMENT_STORAGE_DIR = tempRoot;

const {
  signIncentiveAgreement,
  getAgreementPdfForStaff
} = require("../src/services/staffIncentiveAgreementService");

const signatureData =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function createConnection() {
  let inserted = null;
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params });

      if (normalized.includes("FROM staff_users su") && normalized.includes("INNER JOIN store_memberships")) {
        return [[{
          id: 8,
          displayName: "測試員工",
          username: "staff8",
          role: "CASHIER",
          storeName: "KINGWAY 測試店"
        }]];
      }

      if (normalized.includes("FROM staff_incentive_plan_versions") && normalized.includes("status = 'ACTIVE'")) {
        return [[{
          id: 3,
          storeId: 1,
          version: "KINGWAY-2026-07-V1",
          status: "ACTIVE",
          bikeSaleAmount: "420.00",
          bikeHandoverAmount: "120.00",
          bikeFollowupAmount: "60.00",
          accessoryRate: "0.100000",
          repairInspectionAmount: "100.00",
          effectiveFrom: new Date("2026-07-01T00:00:00+08:00"),
          effectiveTo: null,
          agreementText: "測試補充條款"
        }]];
      }

      if (normalized.includes("FROM staff_incentive_agreements a") && normalized.includes("a.status = 'SIGNED'")) {
        if (!inserted) return [[]];
        return [[{
          id: 11,
          storeId: 1,
          staffUserId: 8,
          planVersionId: 3,
          agreementNumber: inserted.agreementNumber,
          status: "SIGNED",
          requiredChecksJson: inserted.requiredChecksJson,
          signaturePath: inserted.signaturePath,
          pdfPath: inserted.pdfPath,
          documentHash: inserted.documentHash,
          authenticationMethod: "PASSWORD_SESSION",
          signedAt: inserted.signedAt,
          staffDisplayName: "測試員工",
          planVersion: "KINGWAY-2026-07-V1"
        }]];
      }

      if (normalized.startsWith("INSERT INTO staff_incentive_agreements")) {
        inserted = {
          agreementNumber: params[3],
          requiredChecksJson: params[4],
          signaturePath: params[5],
          pdfPath: params[6],
          documentHash: params[7],
          signedAt: params[10]
        };
        return [{ insertId: 11 }];
      }

      throw new Error(`Unexpected SQL: ${normalized}`);
    }
  };
}

async function run() {
  const connection = createConnection();
  const requiredChecks = {
    policyRead: true,
    rulesAccepted: true,
    individualAccessoryBasis: true,
    noAutomaticClawback: true,
    ordinaryWorkDuty: true
  };

  const result = await signIncentiveAgreement(connection, {
    storeId: 1,
    staffUserId: 8,
    planVersionId: 3,
    signatureData,
    requiredChecks,
    signerIp: "127.0.0.1",
    signerUserAgent: "KINGWAY test",
    signedAt: new Date("2026-07-23T10:00:00+08:00")
  });

  assert.strictEqual(result.alreadySigned, false);
  assert.strictEqual(result.agreement.staffUserId, 8);
  assert.strictEqual(result.agreement.planVersionId, 3);
  assert.match(result.agreement.documentHash, /^[a-f0-9]{64}$/);

  const pdf = await getAgreementPdfForStaff(connection, {
    storeId: 1,
    staffUserId: 8,
    agreementId: 11
  });
  assert(fs.existsSync(pdf.absolutePath), "agreement PDF must exist");
  assert(fs.statSync(pdf.absolutePath).size > 1000, "agreement PDF must not be empty");
  assert(pdf.absolutePath.startsWith(tempRoot), "agreement PDF must stay in configured storage root");

  const insertCall = connection.calls.find((call) => call.sql.startsWith("INSERT INTO staff_incentive_agreements"));
  assert(insertCall, "agreement INSERT is required");
  assert.strictEqual(insertCall.params[8], "127.0.0.1");
  assert.strictEqual(insertCall.params[9], "KINGWAY test");

  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log("staff incentive agreement service tests passed");
}

run().catch((error) => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
