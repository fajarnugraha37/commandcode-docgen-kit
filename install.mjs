#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const version = fs.readFileSync(path.join(here, 'VERSION'), 'utf8').trim();
const argv = process.argv.slice(2);
const force = argv.includes('--force');
const dryRun = argv.includes('--dry-run');
const noHooks = argv.includes('--no-hooks');
const noLinkCli = argv.includes('--no-link-cli');
const localIndex = argv.indexOf('--project-local');
const homeIndex = argv.indexOf('--commandcode-home');
const commandCodeHome = path.resolve(homeIndex >= 0 && argv[homeIndex+1] ? argv[homeIndex+1] : path.join(os.homedir(), '.commandcode'));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

function sha256(data){ return crypto.createHash('sha256').update(data).digest('hex'); }
function walk(dir){ const out=[]; for(const e of fs.readdirSync(dir,{withFileTypes:true})){ const f=path.join(dir,e.name); e.isDirectory()?out.push(...walk(f)):out.push(f);} return out; }
function ensureDir(dir){ if(!dryRun) fs.mkdirSync(dir,{recursive:true}); }
function copyWithPolicy(src,dest,backupRoot,installed,skipped){
  const data=fs.readFileSync(src); const rel=path.relative(commandCodeHome,dest).replaceAll('\\','/');
  if(fs.existsSync(dest)){
    const existing=fs.readFileSync(dest); if(sha256(existing)===sha256(data)){installed.push({path:rel,action:'unchanged'}); return;}
    if(!force){skipped.push({path:rel,reason:'conflict; use --force to overwrite'}); return;}
    if(!dryRun){const b=path.join(backupRoot,rel); fs.mkdirSync(path.dirname(b),{recursive:true}); fs.copyFileSync(dest,b);}
  }
  console.log(`${dryRun?'[dry-run] ':''}copy ${dest}`);
  if(!dryRun){fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,data); try{fs.chmodSync(dest,fs.statSync(src).mode)}catch{}}
  installed.push({path:rel,action:fs.existsSync(dest)?'updated':'created'});
}
function hookCommand(file){ return `node ${JSON.stringify(path.join(commandCodeHome,'docgen','hooks',file))}`; }
function mergeGlobalSettings(backupRoot,installed){
  if(noHooks) return;
  const dest=path.join(commandCodeHome,'settings.json'); let current={};
  if(fs.existsSync(dest)){try{current=JSON.parse(fs.readFileSync(dest,'utf8'))}catch(e){console.error(`Invalid JSON: ${dest}: ${e.message}`);process.exit(2)}; if(!dryRun){const b=path.join(backupRoot,'settings.json');fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(dest,b)}}
  current.hooks ??= {};
  const defs={
    SessionStart:[{hooks:[{type:'command',command:hookCommand('docgen-session-context.mjs'),timeout:5}]}],
    PreToolUse:[
      {matcher:'write|edit',hooks:[{type:'command',command:hookCommand('docgen-guard-write-paths.mjs'),timeout:5}]},
      {matcher:'shell',hooks:[{type:'command',command:hookCommand('docgen-guard-shell.mjs'),timeout:5}]}
    ],
    PostToolUse:[{matcher:'write|edit',hooks:[{type:'command',command:hookCommand('docgen-validate-written-artifact.mjs'),timeout:10}]}]
  };
  for(const [event,arr] of Object.entries(defs)){
    current.hooks[event] ??= [];
    const sig=new Set(current.hooks[event].flatMap(d=>(d.hooks??[]).map(h=>`${d.matcher??''}|${h.command??''}`)));
    for(const d of arr){const fresh=(d.hooks??[]).filter(h=>!sig.has(`${d.matcher??''}|${h.command??''}`));if(fresh.length) current.hooks[event].push({...d,hooks:fresh});}
  }
  console.log(`${dryRun?'[dry-run] ':''}merge ${dest}`);
  if(!dryRun){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(current,null,2)+'\n')}
  installed.push({path:'settings.json',action:'merged-docgen-hooks'});
}
function installGlobal(){
  const template=path.join(here,'global-template'); const backupRoot=path.join(commandCodeHome,'docgen-backup',timestamp); const installed=[]; const skipped=[];
  ensureDir(commandCodeHome);
  for(const area of ['agents','skills','commands']) for(const src of walk(path.join(template,area))) copyWithPolicy(src,path.join(commandCodeHome,area,path.relative(path.join(template,area),src)),backupRoot,installed,skipped);
  for(const src of walk(path.join(template,'docgen'))) copyWithPolicy(src,path.join(commandCodeHome,'docgen',path.relative(path.join(template,'docgen'),src)),backupRoot,installed,skipped);
  mergeGlobalSettings(backupRoot,installed);
  if(!dryRun){
    fs.writeFileSync(path.join(commandCodeHome,'docgen','installation.json'),JSON.stringify({schemaVersion:'1.0',kitVersion:version,scope:'global',installedAt:new Date().toISOString(),commandCodeHome,files:installed,skipped},null,2)+'\n');
    if(!noLinkCli){
      const npm=process.platform==='win32'?'npm.cmd':'npm';
      const link=spawnSync(npm,['link'],{cwd:path.join(commandCodeHome,'docgen'),stdio:'inherit',shell:process.platform==='win32'});
      if(link.status!==0) console.warn('WARNING: npm link failed. Use `node ~/.commandcode/docgen/bin/docgen.mjs` or rerun without --no-link-cli after fixing npm.');
    }
  }
  console.log(`\nInstalled Command Code DocGen Kit ${version} globally into ${commandCodeHome}`);
  if(skipped.length){console.log('\nSkipped conflicts:');for(const x of skipped)console.log(`- ${x.path}: ${x.reason}`)}
  console.log('\nNext:'); console.log('  cd <repository>'); console.log('  docgen init'); console.log('  docgen doctor'); console.log('  docgen all');
}
function installProjectLocal(target){
  const template=path.join(here,'project-local-template'); const abs=path.resolve(target); if(!fs.existsSync(abs)||!fs.statSync(abs).isDirectory()){console.error(`Target is not a directory: ${abs}`);process.exit(2)}
  const backupRoot=path.join(abs,'.docgen','install-backup',timestamp); const installed=[]; const skipped=[];
  function localCopy(src,dest){const data=fs.readFileSync(src);const rel=path.relative(abs,dest).replaceAll('\\','/');if(fs.existsSync(dest)){if(sha256(fs.readFileSync(dest))===sha256(data)){installed.push({path:rel,action:'unchanged'});return}if(!force){skipped.push({path:rel,reason:'conflict; use --force'});return}if(!dryRun){const b=path.join(backupRoot,rel);fs.mkdirSync(path.dirname(b),{recursive:true});fs.copyFileSync(dest,b)}}console.log(`${dryRun?'[dry-run] ':''}copy ${rel}`);if(!dryRun){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data)}installed.push({path:rel,action:'copied'})}
  for(const src of walk(template)){const rel=path.relative(template,src);if(rel==='AGENTS.md'||rel==='.commandcode/settings.json')continue;localCopy(src,path.join(abs,rel))}
  // Install the same v0.3 engine used by global mode under the project's .commandcode scope.
  const localEngineTemplate=path.join(here,'global-template','docgen');
  for(const src of walk(localEngineTemplate)){const rel=path.relative(localEngineTemplate,src);localCopy(src,path.join(abs,'.commandcode','docgen',rel))}
  if(!dryRun){
    const marker={schemaVersion:'1.0',kitVersion:version,initializedAt:new Date().toISOString(),engineScope:'project-local',engineHome:path.join(abs,'.commandcode','docgen').replaceAll('\\','/'),projectRoot:abs.replaceAll('\\','/')};
    fs.mkdirSync(path.join(abs,'.docgen'),{recursive:true});fs.writeFileSync(path.join(abs,'.docgen','project.json'),JSON.stringify(marker,null,2)+'\n');
  }
  const markerStart='<!-- COMMANDCODE-DOCGEN:START -->', markerEnd='<!-- COMMANDCODE-DOCGEN:END -->';
  const memorySrc=fs.readFileSync(path.join(template,'AGENTS.md'),'utf8'); const memoryDest=path.join(abs,'AGENTS.md');
  const existingMemory=fs.existsSync(memoryDest)?fs.readFileSync(memoryDest,'utf8'):'';
  if(!existingMemory.includes(markerStart)||!existingMemory.includes(markerEnd)){
    console.log(`${dryRun?'[dry-run] ':''}${existingMemory?'append':'create'} ${memoryDest}`);
    if(!dryRun){fs.writeFileSync(memoryDest,existingMemory.trimEnd()+(existingMemory?'\n\n':'')+memorySrc.trim()+'\n')}
  }
  if(!noHooks){
    const settingsDest=path.join(abs,'.commandcode','settings.json'); let current={}; const source=JSON.parse(fs.readFileSync(path.join(template,'.commandcode','settings.json'),'utf8'));
    if(fs.existsSync(settingsDest)){try{current=JSON.parse(fs.readFileSync(settingsDest,'utf8'))}catch(e){console.error(`Invalid JSON: ${settingsDest}: ${e.message}`);process.exit(2)}}
    current.hooks ??= {}; for(const [event,defs] of Object.entries(source.hooks??{})){current.hooks[event]??=[];const sig=new Set(current.hooks[event].flatMap(d=>(d.hooks??[]).map(h=>`${d.matcher??''}|${h.command??''}`)));for(const d of defs){const fresh=(d.hooks??[]).filter(h=>!sig.has(`${d.matcher??''}|${h.command??''}`));if(fresh.length)current.hooks[event].push({...d,hooks:fresh})}}
    console.log(`${dryRun?'[dry-run] ':''}merge ${settingsDest}`); if(!dryRun){fs.mkdirSync(path.dirname(settingsDest),{recursive:true});fs.writeFileSync(settingsDest,JSON.stringify(current,null,2)+'\n')}
  }
  console.log(`\nInstalled self-contained project-local DocGen ${version} into ${abs}`); if(skipped.length) console.log(`Skipped ${skipped.length} conflicts; use --force to overwrite DocGen-owned files.`);
}
if(localIndex>=0){const target=argv[localIndex+1];if(!target){console.error('Usage: node install.mjs --project-local <repository> [--force]');process.exit(2)}installProjectLocal(target)}else installGlobal();
