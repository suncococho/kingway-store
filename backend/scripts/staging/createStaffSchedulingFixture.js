#!/usr/bin/env node
"use strict";
const path=require("node:path");
const db=require("../../src/db");
const {hashPassword}=require("../../src/utils/passwords");
const {createFixture}=require("./staffSchedulingFixture");
const args=new Set(process.argv.slice(2));
const value=(name)=>{const prefix=`${name}=`;return process.argv.slice(2).find((arg)=>arg.startsWith(prefix))?.slice(prefix.length);};
(async()=>{const result=await createFixture({db,env:process.env,confirmed:args.has("--confirm-staging"),runId:value("--run-id")||process.env.STAGING_FIXTURE_RUN_ID,password:process.env.STAGING_FIXTURE_PASSWORD,hashPassword,directory:process.env.STAGING_FIXTURE_MANIFEST_DIR||path.join("/tmp","kingway-staging-fixtures")});console.log(JSON.stringify({ok:true,runId:result.manifest.runId,manifestFile:result.manifestFile,ids:result.manifest.ids}));})().catch((error)=>{console.error(`fixture create failed: ${error.message}`);process.exitCode=1;}).finally(()=>db.pool.end());
