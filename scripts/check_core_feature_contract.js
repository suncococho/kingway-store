#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repoDir = path.resolve(__dirname, "..");
const manifestPath = path.join(repoDir, "config/core-feature-contract.json");
const baselinePath = path.join(repoDir, "config/core-feature-production-baseline.json");
const roleSnapshotPath = path.join(repoDir, "config/core-feature-role-snapshot.json");
const appPath = path.join(repoDir, "frontend/src/App.jsx");
const navigationPath = path.join(repoDir, "frontend/src/lib/mobileNavigation.js");
const permissionPath = path.join(repoDir, "frontend/src/lib/menuPermissions.js");
const backendAppPath = path.join(repoDir, "backend/src/app.js");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function read(file) {
  return fs.readFileSync(path.join(repoDir, file), "utf8");
}

function requireFile(file, featureId) {
  if (!file || !fs.existsSync(path.join(repoDir, file))) {
    fail(`${featureId}: missing required file ${file}`);
    return false;
  }
  return true;
}

function parseArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const manifest = readJson(manifestPath);
const productionBaseline = readJson(baselinePath);
const roleSnapshot = readJson(roleSnapshotPath);
const allowedStatuses = new Set(manifest.allowedStatuses || []);
const selectedFeature = parseArg("--feature");
const assetFile = parseArg("--asset-file");
const appSource = fs.readFileSync(appPath, "utf8");
const navigationSource = fs.readFileSync(navigationPath, "utf8");
const permissionSource = fs.readFileSync(permissionPath, "utf8");
const backendAppSource = fs.readFileSync(backendAppPath, "utf8");

const allFeatures = manifest.features || [];
const duplicateIds = allFeatures
  .map((feature) => feature.featureId)
  .filter((featureId, index, values) => values.indexOf(featureId) !== index);
if (duplicateIds.length) {
  fail(`duplicate featureId values: ${[...new Set(duplicateIds)].join(", ")}`);
}

const featureById = new Map(allFeatures.map((feature) => [feature.featureId, feature]));
for (const baselineFeature of productionBaseline.features || []) {
  const candidate = featureById.get(baselineFeature.featureId);
  if (!candidate) {
    fail(`production feature removed from manifest: ${baselineFeature.featureId}`);
    continue;
  }
  if (candidate.frontendRoute !== baselineFeature.frontendRoute) {
    fail(`${baselineFeature.featureId}: production frontend route changed`);
  }
  if (candidate.backendMount !== baselineFeature.backendMount) {
    fail(`${baselineFeature.featureId}: production backend mount changed`);
  }
  if (candidate.status === "incomplete") {
    fail(`${baselineFeature.featureId}: production feature cannot become incomplete`);
  }
}

let features = allFeatures;
if (selectedFeature) {
  const feature = featureById.get(selectedFeature);
  if (!feature) {
    fail(`unknown feature requested: ${selectedFeature}`);
    features = [];
  } else {
    features = [feature];
  }
}

for (const feature of features) {
  const id = feature.featureId;
  for (const field of [
    "featureId",
    "displayName",
    "pageFile",
    "frontendRoute",
    "requiredRoles",
    "frontendApi",
    "backendRouteFile",
    "backendMount",
    "migrationRequired",
    "testCommand",
    "status",
    "completionCommit"
  ]) {
    if (feature[field] === undefined || feature[field] === "") {
      fail(`${id}: missing manifest field ${field}`);
    }
  }

  if (!allowedStatuses.has(feature.status)) {
    fail(`${id}: invalid status ${feature.status}`);
  }
  if (!/^[0-9a-f]{40}$/.test(feature.completionCommit || "")) {
    fail(`${id}: completionCommit must be a full Git hash`);
  }
  if (!requireFile(feature.pageFile, id) || !requireFile(feature.backendRouteFile, id)) {
    continue;
  }

  const pageName = path.basename(feature.pageFile, path.extname(feature.pageFile));
  const importMarker = `import ${pageName} from "./pages/${pageName}";`;
  if (!appSource.includes(importMarker)) {
    fail(`${id}: App.jsx import missing: ${importMarker}`);
  }

  const routeMarker = `<Route path="${feature.frontendRoute}"`;
  const routeIndex = appSource.indexOf(routeMarker);
  if (routeIndex < 0) {
    fail(`${id}: frontend route missing: ${feature.frontendRoute}`);
  }
  if (feature.publicRoute) {
    const protectedIndex = appSource.indexOf("<ProtectedRoute");
    if (protectedIndex >= 0 && routeIndex > protectedIndex) {
      fail(`${id}: public route moved behind ProtectedRoute`);
    }
  }

  if (feature.menuPath !== null) {
    if (!feature.permissionKey) {
      fail(`${id}: managed menu requires permissionKey`);
    }
    const menuLine = navigationSource
      .split("\n")
      .find((line) => line.includes(`to: "${feature.menuPath}"`));
    if (!menuLine) {
      fail(`${id}: menu path missing: ${feature.menuPath}`);
    } else {
      if (!menuLine.includes(`label: "${feature.displayName}"`)) {
        fail(`${id}: exact menu label missing`);
      }
      if (!menuLine.includes(`menuKey: "${feature.permissionKey}"`)) {
        fail(`${id}: menu permission key mismatch`);
      }
    }
    const permissionMarker = `{ path: "${feature.menuPath}", key: "${feature.permissionKey}" }`;
    if (!permissionSource.includes(permissionMarker)) {
      fail(`${id}: path permission mapping missing`);
    }
  } else if (feature.permissionKey !== null) {
    fail(`${id}: permissionKey must be null when menuPath is null`);
  }

  const apiSources = (feature.frontendApiFiles || [feature.pageFile])
    .map((file) => {
      requireFile(file, id);
      return fs.existsSync(path.join(repoDir, file)) ? read(file) : "";
    })
    .join("\n");
  for (const api of feature.frontendApi || []) {
    if (!apiSources.includes(api)) {
      fail(`${id}: frontend API marker missing: ${api}`);
    }
  }

  const mountMarker = `app.use("${feature.backendMount}",`;
  if (!backendAppSource.includes(mountMarker)) {
    fail(`${id}: backend mount missing: ${feature.backendMount}`);
  }

  if (feature.migrationRequired) {
    if (!Array.isArray(feature.migrations) || feature.migrations.length === 0) {
      fail(`${id}: migrationRequired without migrations`);
    }
    for (const migration of feature.migrations || []) {
      requireFile(migration, id);
    }
  }
}

const roleNames = ["ADMIN", "MANAGER", "CASHIER", "REPAIR", "INVENTORY"];
const fallbackKeys = { ADMIN: null };
for (const role of roleNames.slice(1)) {
  const match = permissionSource.match(new RegExp(`${role}: \\[([^\\]]*)\\]`));
  if (!match) {
    fail(`role fallback missing: ${role}`);
    fallbackKeys[role] = new Set();
    continue;
  }
  fallbackKeys[role] = new Set(
    match[1]
      .split(",")
      .map((item) => item.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
  );
}

for (const role of roleNames) {
  const actual = allFeatures
    .filter((feature) => feature.menuPath !== null)
    .filter((feature) => role === "ADMIN" || fallbackKeys[role]?.has(feature.permissionKey))
    .map((feature) => feature.featureId)
    .sort();
  const expected = [...(roleSnapshot.roles?.[role] || [])].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${role} feature snapshot changed; expected [${expected.join(", ")}], got [${actual.join(", ")}]`);
  }
}

if (!read("frontend/src/components/Sidebar.jsx").includes("getMobileMenuSectionsForUser")) {
  fail("desktop Sidebar no longer uses shared core navigation");
}
if (!read("frontend/src/pages/MorePage.jsx").includes("getMobileMenuSectionsForUser")) {
  fail("mobile MorePage no longer uses shared core navigation");
}

if (assetFile) {
  const resolvedAsset = path.resolve(assetFile);
  if (!fs.existsSync(resolvedAsset)) {
    fail(`asset file does not exist: ${resolvedAsset}`);
  } else {
    const assetSource = fs.readFileSync(resolvedAsset, "utf8");
    for (const feature of features.filter((item) => item.status !== "incomplete")) {
      for (const marker of feature.assetMarkers || []) {
        if (!assetSource.includes(marker)) {
          fail(`${feature.featureId}: build asset marker missing: ${marker}`);
        }
      }
    }
  }
}

if (!process.exitCode) {
  const scope = selectedFeature || "all completed core features";
  console.log(`OK: core feature contract passed for ${scope}.`);
}
