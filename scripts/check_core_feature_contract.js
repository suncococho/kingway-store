#!/usr/bin/env node
"use strict";
const fs=require("fs"),path=require("path");
const repo=path.resolve(__dirname,"..");
const files={
 manifest:"config/core-feature-contract.json",
 baseline:"config/core-feature-production-baseline.json",
 roles:"config/core-feature-role-snapshot.json",
 app:"frontend/src/App.jsx",
 nav:"frontend/src/lib/mobileNavigation.js",
 permissions:"frontend/src/lib/menuPermissions.js",
 backend:"backend/src/app.js"
};
let failed=false;
function fail(message){console.error("ERROR: "+message);failed=true;}
function read(rel){return fs.readFileSync(path.join(repo,rel),"utf8");}
function json(rel){try{return JSON.parse(read(rel));}catch(e){fail(rel+": invalid JSON: "+e.message);return {};}}
function exists(rel,label){if(!rel||!fs.existsSync(path.join(repo,rel))){fail((label||"file")+" missing: "+rel);return false;}return true;}
function array(value,label){if(!Array.isArray(value)){fail(label+" must be an array");return [];}return value;}
function unique(values,label){const seen=new Set();for(const value of values){if(seen.has(value))fail(label+" duplicate: "+value);seen.add(value);}return seen;}
function sameSet(actual,expected,label){
 const a=[...new Set(actual)].sort(),e=[...new Set(expected)].sort();
 const missing=e.filter(x=>!a.includes(x)),extra=a.filter(x=>!e.includes(x));
 if(missing.length||extra.length)fail(label+" mismatch; missing=["+missing.join(", ")+"] extra=["+extra.join(", ")+"]");
}
function sameList(actual,expected,label){
 if(JSON.stringify(actual)!==JSON.stringify(expected))fail(label+" ordered list mismatch");
}
function sameMultiset(actual,expected,label){
 const count=x=>x.reduce((m,v)=>(m.set(v,(m.get(v)||0)+1),m),new Map());
 const a=count(actual),e=count(expected),keys=new Set([...a.keys(),...e.keys()]);
 const diff=[...keys].filter(k=>(a.get(k)||0)!==(e.get(k)||0)).map(k=>k+":"+(a.get(k)||0)+"/"+(e.get(k)||0));
 if(diff.length)fail(label+" multiset mismatch "+diff.join(", "));
}
function arg(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;}
const manifest=json(files.manifest),baseline=json(files.baseline),roleSnapshot=json(files.roles);
const app=read(files.app),nav=read(files.nav),permissions=read(files.permissions),backend=read(files.backend);
if(manifest.schemaVersion!==3)fail("manifest schemaVersion must be 3");
if(baseline.schemaVersion!==3)fail("production baseline schemaVersion must be 3");
if(roleSnapshot.schemaVersion!==3)fail("role snapshot schemaVersion must be 3");
const expectedCounts=manifest.expectedCounts||{},features=array(manifest.features,"features");
const requiredFields=array(manifest.requiredFeatureFields,"requiredFeatureFields");
const allowedStatuses=new Set(array(manifest.allowedStatuses,"allowedStatuses"));
const routeClasses=new Set(array(manifest.routeClassifications,"routeClassifications"));
const mountClasses=new Set(array(manifest.mountClassifications,"mountClassifications"));
unique(features.map(x=>x.featureId),"featureId");
const featureById=new Map(features.map(x=>[x.featureId,x]));
for(const feature of features){
 const id=feature.featureId||"(missing)";
 for(const field of requiredFields)if(!Object.prototype.hasOwnProperty.call(feature,field))fail(id+": missing schema field "+field);
 if(typeof feature.featureId!=="string"||!feature.featureId)fail(id+": invalid featureId");
 if(typeof feature.category!=="string"||!feature.category)fail(id+": category required");
 if(typeof feature.displayName!=="string"||!feature.displayName)fail(id+": displayName required");
 if(!allowedStatuses.has(feature.status))fail(id+": invalid status "+feature.status);
 if(typeof feature.releaseRequired!=="boolean")fail(id+": releaseRequired must be boolean");
 for(const field of ["sourceCommit","completionCommit"])if(!/^[0-9a-f]{40}$/.test(feature[field]||""))fail(id+": "+field+" must be full commit");
 for(const field of ["pageFiles","frontendRoutes","menuPaths","permissionKeys","requiredRoles","frontendApis","backendRouteFiles","backendMounts","directEndpoints","serviceFiles","scheduledJobs","webhooks","backgroundWorkflows","publicEndpoints","fileWorkflows","migrations","testFiles","testCommands","featureFlags","productionEvidence"])array(feature[field],id+"."+field);
 for(const field of ["menuRoles","selfReadRoles","selfWriteRoles","managementReadRoles","managementWriteRoles"])array(feature[field],id+"."+field);
 if(typeof feature.publicAccess!=="boolean")fail(id+": publicAccess must be boolean");
 if(typeof feature.backendAuthorizationSource!=="string"||!feature.backendAuthorizationSource)fail(id+": backendAuthorizationSource required");
 if(feature.status==="incomplete"&&feature.releaseRequired)fail(id+": incomplete cannot be releaseRequired");
 if(feature.status==="conditional"&&!feature.featureFlags.length&&!feature.notes)fail(id+": conditional requires featureFlags or notes");
 if(!feature.productionEvidence.length&&feature.releaseRequired)fail(id+": releaseRequired needs productionEvidence");
 for(const rel of [...feature.pageFiles,...feature.backendRouteFiles,...feature.serviceFiles,...feature.migrations,...feature.testFiles])exists(rel,id);
 for(const route of feature.frontendRoutes){
  if(!route||typeof route.path!=="string")fail(id+": route.path required");
  if(!routeClasses.has(route.classification))fail(id+": invalid route classification "+route.classification);
  if(!["public","protected"].includes(route.access))fail(id+": invalid route access "+route.access);
  if(["conditional","redirect-helper","helper","fallback","alias"].includes(route.classification)&&!route.reason)fail(id+": "+route.path+" classification requires reason");
 }
 for(const menu of feature.menuPaths){
  if(!menu.path||!menu.label||!menu.permissionKey)fail(id+": menu requires path/label/permissionKey");
  if(!feature.permissionKeys.includes(menu.permissionKey))fail(id+": menu permissionKey not in permissionKeys: "+menu.permissionKey);
 }
}
const authorizationPrincipals=new Set(array(manifest.authorizationPrincipals,"authorizationPrincipals"));
for(const feature of features){
 for(const field of ["menuRoles","selfReadRoles","selfWriteRoles","managementReadRoles","managementWriteRoles"])for(const principal of feature[field])if(!authorizationPrincipals.has(principal))fail(feature.featureId+": unknown authorization principal "+principal);
}
const authorizationGaps=array(manifest.knownAuthorizationGaps,"knownAuthorizationGaps");
unique(authorizationGaps.map(x=>x.gapId),"authorization gap");
if(authorizationGaps.length<8)fail("knownAuthorizationGaps must preserve at least 8 reviewed gaps");
for(const gap of authorizationGaps){
 if(!gap.gapId||!gap.featureId||!featureById.has(gap.featureId)||!gap.reason)fail("authorization gap metadata incomplete: "+(gap.gapId||"(missing)"));
 array(gap.menuSubjects,(gap.gapId||"gap")+".menuSubjects");array(gap.backendSubjects,(gap.gapId||"gap")+".backendSubjects");
 for(const rel of array(gap.sourceFiles,(gap.gapId||"gap")+".sourceFiles"))exists(rel,gap.gapId);
}
if(features.length!==expectedCounts.features)fail("feature count mismatch");
const manifestRoutes=features.flatMap(f=>f.frontendRoutes.map(r=>r.path));
const manifestMenus=features.flatMap(f=>f.menuPaths.map(m=>m.path));
unique(manifestRoutes,"manifest frontend route");
unique(manifestMenus,"manifest menu path");
if(manifestRoutes.length!==expectedCounts.frontendRoutes)fail("manifest route count mismatch");
if(manifestMenus.length!==expectedCounts.menuPaths)fail("manifest menu count mismatch");
const sourceRoutes=[...app.matchAll(/<Route\b[^>]*\bpath="([^"]+)"[^>]*>/g)].map(m=>m[1]);
unique(sourceRoutes,"App.jsx route");
sameSet(sourceRoutes,manifestRoutes,"App.jsx routes <-> manifest");
if(sourceRoutes.length!==expectedCounts.frontendRoutes)fail("App.jsx route count expected "+expectedCounts.frontendRoutes+" got "+sourceRoutes.length);
const sourceMenus=[];
for(const line of nav.split(/\r?\n/)){
 const m=line.match(/to:\s*"([^"]+)".*label:\s*"([^"]+)".*menuKey:\s*"([^"]+)"/);
 if(m)sourceMenus.push({path:m[1],label:m[2],permissionKey:m[3]});
}
unique(sourceMenus.map(x=>x.path),"navigation menu path");
sameSet(sourceMenus.map(x=>x.path),manifestMenus,"navigation menus <-> manifest");
if(sourceMenus.length!==expectedCounts.menuPaths)fail("navigation menu count expected "+expectedCounts.menuPaths+" got "+sourceMenus.length);
const manifestMenuByPath=new Map(features.flatMap(f=>f.menuPaths.map(m=>[m.path,m])));
for(const source of sourceMenus){
 const expected=manifestMenuByPath.get(source.path);
 if(!expected)continue;
 if(source.label!==expected.label)fail(source.path+": menu label mismatch");
 if(source.permissionKey!==expected.permissionKey)fail(source.path+": menu key mismatch");
}
const pathMappings=[...permissions.matchAll(/\{\s*path:\s*"([^"]+)",\s*key:\s*"([^"]+)"\s*\}/g)].map(m=>({path:m[1],key:m[2]}));
unique(pathMappings.map(x=>x.path),"permission path mapping");
const mapping=new Map(pathMappings.map(x=>[x.path,x.key]));
let mappedMenus=0;
for(const menu of sourceMenus){
 const normalized=menu.path.split("?")[0];
 if(mapping.get(normalized)!==menu.permissionKey)fail(menu.path+": permission mapping mismatch");
 else mappedMenus++;
}
if(mappedMenus!==expectedCounts.permissionMenuMappings)fail("permission mapping expected "+expectedCounts.permissionMenuMappings+" got "+mappedMenus);
const bindings=array(manifest.mountBindings,"mountBindings");
unique(bindings.map(x=>x.path+"|"+x.routerId),"mount binding");
for(const binding of bindings){
 if(!featureById.has(binding.featureId))fail("mount binding unknown feature "+binding.featureId);
 if(!mountClasses.has(binding.classification))fail(binding.path+": invalid mount classification");
 if(["legacy-conditional","debug-disabled","intentional-disabled"].includes(binding.classification)&&!binding.reason)fail(binding.path+": classified mount requires reason");
 let marker;
 if(binding.routerId==="intentional404")marker='app.use("/files/pdfs",';
 else if(binding.routerId==="productStatic")marker='app.use("/files/products", express.static';
 else if(binding.routerId==="generalStatic")marker='app.use("/files", express.static';
 else marker='app.use("'+binding.path+'", '+binding.routerId+')';
 if(!backend.includes(marker))fail(binding.path+"|"+binding.routerId+": source binding missing");
}
const sourceMountCalls=[...backend.matchAll(/app\.use\(\s*"([^"]+)"/g)].map(m=>m[1]);
const manifestMountCalls=bindings.map(x=>x.path);
sameMultiset(sourceMountCalls,manifestMountCalls,"backend mount calls <-> manifest");
sameSet(sourceMountCalls,[...new Set(manifestMountCalls)],"backend unique mounts <-> manifest");
if(sourceMountCalls.length!==expectedCounts.backendMountCalls)fail("backend mount call count mismatch");
if(new Set(sourceMountCalls).size!==expectedCounts.uniqueBackendMounts)fail("backend unique mount count mismatch");
const directCatalog=array(manifest.directEndpointCatalog,"directEndpointCatalog");
unique(directCatalog.map(x=>x.method+" "+x.path),"direct endpoint");
for(const endpoint of directCatalog){
 if(!featureById.has(endpoint.featureId))fail("direct endpoint unknown feature "+endpoint.featureId);
 if(!endpoint.classification)fail(endpoint.method+" "+endpoint.path+": classification required");
 if(["health","debug-disabled","legacy-conditional"].includes(endpoint.classification)&&!endpoint.reason)fail(endpoint.method+" "+endpoint.path+": reason required");
}
const sourceDirect=[...backend.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)].map(m=>m[1].toUpperCase()+" "+m[2]);
sameSet(sourceDirect,directCatalog.map(x=>x.method+" "+x.path),"direct endpoints <-> manifest");
if(sourceDirect.length!==expectedCounts.directEndpoints)fail("direct endpoint count mismatch");
const workflows=array(manifest.workflowCatalog,"workflowCatalog");
unique(workflows.map(x=>x.workflowId),"workflowId");
for(const workflow of workflows){
 if(!featureById.has(workflow.featureId))fail(workflow.workflowId+": unknown feature");
 for(const field of ["sourceFile","entryFunction","sourceMarker","routeOrScheduler","productionEvidence","reason"])if(!workflow[field])fail(workflow.workflowId+": missing "+field);
 if(!Array.isArray(workflow.testFiles)||!workflow.testFiles.length)fail(workflow.workflowId+": testFiles required");
 if(exists(workflow.sourceFile,workflow.workflowId)&&!read(workflow.sourceFile).includes(workflow.sourceMarker))fail(workflow.workflowId+": sourceMarker missing");
 for(const rel of workflow.testFiles)exists(rel,workflow.workflowId);
}
if(workflows.length!==expectedCounts.workflows)fail("workflow count mismatch");
const cronCount=(backend.match(/cron\.schedule\(/g)||[]).length;
if(cronCount!==expectedCounts.scheduledJobRegistrations)fail("scheduled cron source inventory expected "+expectedCounts.scheduledJobRegistrations+" got "+cronCount);
const lineSource=read("backend/src/routes/line.js"),telegramSource=read("backend/src/routes/telegramWebhook.js");
const lineWebhookCount=(lineSource.match(/router\.post\("\/webhook/g)||[]).length;
const telegramWebhookCount=(telegramSource.match(/router\.post\("\/webhook/g)||[]).length;
if(lineWebhookCount!==expectedCounts.lineWebhookHandlers)fail("LINE webhook handler inventory expected "+expectedCounts.lineWebhookHandlers+" got "+lineWebhookCount);
if(telegramWebhookCount!==expectedCounts.telegramWebhookHandlers)fail("Telegram webhook handler inventory expected "+expectedCounts.telegramWebhookHandlers+" got "+telegramWebhookCount);
const jobsDir=path.join(repo,"backend/src/jobs");
if(fs.existsSync(jobsDir)){
 const jobFiles=fs.readdirSync(jobsDir).filter(x=>fs.statSync(path.join(jobsDir,x)).isFile()).map(x=>"backend/src/jobs/"+x);
 const classified=new Set(workflows.map(x=>x.sourceFile));
 for(const file of jobFiles)if(!classified.has(file))fail("unclassified backend job file: "+file);
}
for(const legacy of array(manifest.unmountedRoutes,"unmountedRoutes")){
 if(!legacy.file||!legacy.classification||!legacy.reason)fail("unmounted route classification incomplete");
 exists(legacy.file,"unmounted route");
 if(backend.includes('require("./routes/'+path.basename(legacy.file,".js")+'")'))fail(legacy.file+": declared unmounted but app.js requires it");
}
const releaseFeatures=features.filter(x=>x.releaseRequired).map(x=>x.featureId);
sameSet(releaseFeatures,array(baseline.productionFeatureIds,"baseline.productionFeatureIds"),"production featureIds");
sameSet(manifestRoutes,array(baseline.productionFrontendRoutes,"baseline.productionFrontendRoutes"),"production frontend routes");
sameSet(manifestMenus,array(baseline.productionMenus,"baseline.productionMenus"),"production menus");
sameSet([...new Set(manifestMountCalls)],array(baseline.productionBackendMounts,"baseline.productionBackendMounts"),"production mounts");
sameSet(bindings.map(x=>x.path+"|"+x.routerId),array(baseline.productionBackendMountBindings,"baseline.productionBackendMountBindings"),"production mount bindings");
sameSet(directCatalog.map(x=>x.method+" "+x.path),array(baseline.directEndpoints,"baseline.directEndpoints"),"production direct endpoints");
sameSet(workflows.map(x=>x.workflowId),array(baseline.workflowIds,"baseline.workflowIds"),"production workflows");
sameSet(workflows.filter(x=>x.workflowId.endsWith("-cron")).map(x=>x.workflowId),array(baseline.scheduledJobs,"baseline.scheduledJobs"),"production scheduled jobs");
sameSet(workflows.filter(x=>x.workflowId.includes("webhook")||x.workflowId.includes("command")).map(x=>x.workflowId),array(baseline.webhooks,"baseline.webhooks"),"production webhooks");
sameSet(workflows.filter(x=>x.workflowId.includes("pdf")).map(x=>x.workflowId),array(baseline.pdfWorkflows,"baseline.pdfWorkflows"),"production PDF workflows");
if(!baseline.productionAsset||!baseline.productionAsset.filename||!/^[0-9a-f]{64}$/.test(baseline.productionAsset.sha256||""))fail("production asset filename/hash required");
if(!baseline.productionImages||!/^sha256:[0-9a-f]{64}$/.test(baseline.productionImages.frontend||"")||!/^sha256:[0-9a-f]{64}$/.test(baseline.productionImages.backend||""))fail("production image IDs required");
const expectedPolicy={
 ADMIN_ROLE:{sourceRole:null,count:35,identity:{staffRole:"ADMIN"}},
 STORE_ROLE_OWNER:{sourceRole:null,count:35,identity:{storeRole:"owner"}},
 MANAGER_ROLE:{sourceRole:"MANAGER",count:35,identity:{staffRole:"MANAGER"}},
 CASHIER_ROLE:{sourceRole:"CASHIER",count:15,identity:{staffRole:"CASHIER"}},
 REPAIR_ROLE:{sourceRole:"REPAIR",count:15,identity:{staffRole:"REPAIR"}},
 INVENTORY_ROLE:{sourceRole:"INVENTORY",count:15,identity:{staffRole:"INVENTORY"}},
 STAFF_ROLE:{sourceRole:"STAFF",count:10,identity:{staffRole:"STAFF"}}
};
const policySubjects=roleSnapshot.subjects||{};
sameSet(Object.keys(policySubjects),Object.keys(expectedPolicy),"approved role policy subjects");
if(roleSnapshot.roles)fail("legacy roleSnapshot.roles is forbidden; use explicit subjects");
if(Object.prototype.hasOwnProperty.call(policySubjects,"STORE_OWNER"))fail("virtual STORE_OWNER staff role is forbidden");
if(/(^|[^A-Z_])STORE_OWNER\s*:/.test(permissions))fail("virtual STORE_OWNER source fallback is forbidden");
if(!permissions.includes('normalizeRole(user?.role) === "ADMIN"'))fail("ADMIN full-menu condition missing");
if(!permissions.includes("isOwnerUser(user) ||"))fail("storeRole owner full-menu condition missing");
const sourceFallback={};
for(const role of ["MANAGER","CASHIER","REPAIR","INVENTORY","STAFF"]){
 const m=permissions.match(new RegExp(role+": \\[([^\\]]*)\\]"));
 if(!m){fail("source role fallback missing "+role);sourceFallback[role]=[];}
 else sourceFallback[role]=m[1].split(",").map(x=>x.trim().replace(/^"|"$/g,"")).filter(Boolean);
}
const menuEntries=sourceMenus;
const manifestPublicRoutes=features.flatMap(f=>f.frontendRoutes.filter(r=>r.access==="public").map(r=>r.path));
unique(manifestPublicRoutes,"public frontend route");
const selfServicePolicy=["/staff-scheduling","/staff-incentives"];
const managementPolicySubjects=new Set(["ADMIN_ROLE","STORE_ROLE_OWNER","MANAGER_ROLE"]);
for(const [subject,policy] of Object.entries(expectedPolicy)){
 const snap=policySubjects[subject];
 if(!snap){fail("role snapshot missing "+subject);continue;}
 if(JSON.stringify(snap.identity)!==JSON.stringify(policy.identity))fail(subject+": identity mismatch");
 const keys=policy.sourceRole===null?null:sourceFallback[policy.sourceRole];
 const actualAllowed=menuEntries.filter(m=>keys===null||keys.includes(m.permissionKey)).map(m=>m.path);
 const actualDenied=manifestMenus.filter(m=>!actualAllowed.includes(m));
 sameSet(actualAllowed,array(snap.menuAllowed,subject+".menuAllowed"),subject+" source menus vs approved policy");
 sameSet(actualDenied,array(snap.menuDenied,subject+".menuDenied"),subject+" denied menus");
 sameSet(array(snap.menuRequired,subject+".menuRequired"),snap.menuAllowed,subject+" required menus");
 sameSet([...(snap.menuAllowed||[]),...(snap.menuDenied||[])],manifestMenus,subject+" full menu classification");
 if(new Set([...(snap.menuAllowed||[]),...(snap.menuDenied||[])]).size!==manifestMenus.length)fail(subject+": duplicate menu classification");
 if(snap.menuAllowed.length!==policy.count)fail(subject+": approved menu count expected "+policy.count+" got "+snap.menuAllowed.length);
 sameSet(array(snap.publicRoutes,subject+".publicRoutes"),manifestPublicRoutes,subject+" public routes");
 sameSet(array(snap.selfServiceRoutes,subject+".selfServiceRoutes"),selfServicePolicy,subject+" self-service routes");
 const managementExpected=managementPolicySubjects.has(subject)?selfServicePolicy:[];
 sameSet(array(snap.managementRoutes,subject+".managementRoutes"),managementExpected,subject+" management routes");
 if(typeof snap.notes!=="string"||!snap.notes)fail(subject+": notes required");
}
if(roleSnapshot.menuCount!==expectedCounts.menuPaths)fail("role snapshot menuCount mismatch");
if(baseline.roleSnapshots){
 sameSet(Object.keys(baseline.roleSnapshots),Object.keys(policySubjects),"baseline role policy subjects");
 for(const subject of Object.keys(policySubjects)){
  const base=baseline.roleSnapshots[subject],snap=policySubjects[subject];
  if(!base){fail("baseline roleSnapshots missing "+subject);continue;}
  for(const field of ["menuRequired","menuAllowed","menuDenied","publicRoutes","selfServiceRoutes","managementRoutes"])sameSet(array(base[field],"baseline "+subject+"."+field),snap[field],"baseline "+subject+" "+field);
  if(JSON.stringify(base.identity)!==JSON.stringify(snap.identity))fail("baseline "+subject+" identity mismatch");
 }
}
for(const feature of features){
 for(const page of feature.pageFiles){
for(const legacy of array(manifest.unmountedPages,"unmountedPages")){ if(!legacy.file||!legacy.classification||!legacy.reason)fail("unmounted page classification incomplete"); exists(legacy.file,"unmounted page"); if(app.includes("from \"./pages/"+path.basename(legacy.file,".jsx")+"\""))fail(legacy.file+": declared unmounted but App imports it"); }
  const name=path.basename(page,path.extname(page));
  if(feature.frontendRoutes.length&&!app.includes("from \"./pages/"+name+"\""))fail(feature.featureId+": App import missing "+name);
 }
 const apiSource=[...feature.pageFiles,"frontend/src/lib/api.js"].filter(x=>fs.existsSync(path.join(repo,x))).map(read).join("\n");
 for(const marker of feature.frontendApis){
  const alternatives=[marker,marker.startsWith("/api/")?marker.slice(4):"/api"+marker];
  if(!alternatives.some(x=>apiSource.includes(x)))fail(feature.featureId+": frontend API marker missing "+marker);
 }
}
if(!read("frontend/src/components/Sidebar.jsx").includes("getMobileMenuSectionsForUser"))fail("Sidebar shared menu source missing");
if(!read("frontend/src/pages/MorePage.jsx").includes("getMobileMenuSectionsForUser"))fail("MorePage shared menu source missing");
const assetFile=arg("--asset-file");
if(assetFile){
 if(!fs.existsSync(path.resolve(assetFile)))fail("asset file missing "+assetFile);
 else{
  const asset=fs.readFileSync(path.resolve(assetFile),"utf8");
  for(const marker of array(baseline.requiredAssetMarkers,"baseline.requiredAssetMarkers"))if(!asset.includes(marker))fail("build asset marker missing "+marker);
 }
}
const selected=arg("--feature");
if(selected&&!featureById.has(selected))fail("unknown feature "+selected);
if(failed)process.exit(1);
console.log("OK: bidirectional core feature contract passed.");
console.log("accounted routes="+sourceRoutes.length+"/"+expectedCounts.frontendRoutes+
 " menus="+sourceMenus.length+"/"+expectedCounts.menuPaths+
 " permissionMappings="+mappedMenus+"/"+expectedCounts.permissionMenuMappings+
 " mountCalls="+sourceMountCalls.length+"/"+expectedCounts.backendMountCalls+
 " uniqueMounts="+new Set(sourceMountCalls).size+"/"+expectedCounts.uniqueBackendMounts+
 " directEndpoints="+sourceDirect.length+"/"+expectedCounts.directEndpoints+
 " workflows="+workflows.length+"/"+expectedCounts.workflows);
console.log("featureFamilies="+features.length+" unclassified=0");
