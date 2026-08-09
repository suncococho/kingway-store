#!/usr/bin/env node
"use strict";
const path=require("node:path");
const db=require("../../src/db");
const {cleanupFixture}=require("./staffSchedulingFixture");
const args=new Set(process.argv.slice(2));
const value=(name)=>{const prefix=`${name}=`;return process.argv.slice(2).find((arg)=>arg.startsWith(prefix))?.slice(prefix.length);};
(async()=>{const result=await cleanupFixture({db,env:process.env,confirmed:args.has("--confirm-staging"),deleteConfirmed:args.has("--confirm-delete"),runId:value("--run-id")||process.env.STAGING_FIXTURE_RUN_ID,directory:process.env.STAGING_FIXTURE_MANIFEST_DIR||path.join("/tmp","kingway-staging-fixtures")});console.log(JSON.stringify({ok:true,...result}));})().catch((error)=>{console.error(`fixture cleanup failed: ${error.message}`);process.exitCode=1;}).finally(()=>db.pool.end());
