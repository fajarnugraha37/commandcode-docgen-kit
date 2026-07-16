import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { active, readStdinJson, resolveWorkspacePath, isWithin, deny } from './docgen-common.mjs';

const payload = await readStdinJson();
if (!active()) process.exit(0);
const cwd = path.resolve(payload.cwd ?? process.env.COMMANDCODE_PROJECT_DIR ?? process.cwd());
const input = payload.tool_input ?? {};
const toolName = String(payload.tool_name ?? payload.tool ?? '').toLowerCase();

function norm(value) { return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, ''); }
function esc(value) { return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }
function patternRegex(pattern, anchored = false) {
  let body='';
  for(let i=0;i<pattern.length;i++){
    if(pattern[i]==='*'){ if(pattern[i+1]==='*'){while(pattern[i+1]==='*')i++;body+='.*';}else body+='[^/]*'; }
    else if(pattern[i]==='?') body+='[^/]'; else body+=esc(pattern[i]);
  }
  return new RegExp(anchored?`^${body}(?:/.*)?$`:`(?:^|/)${body}(?:/.*)?$`);
}
function rules(file){
  if(!fs.existsSync(file))return[];
  return fs.readFileSync(file,'utf8').split(/\r?\n/).map((raw)=>{
    let line=raw.trim(); if(!line||line.startsWith('#'))return null; let negated=false;
    if(line.startsWith('!')){negated=true;line=line.slice(1);} const directoryOnly=line.endsWith('/');
    if(directoryOnly)line=line.replace(/\/+$/,''); const anchored=line.startsWith('/'); if(anchored)line=line.slice(1);
    return {raw,negated,directoryOnly,pattern:line,regex:patternRegex(line,anchored)};
  }).filter(Boolean);
}
function matchRules(rel,isDir,items){let decision=null;for(const rule of items){if(rule.directoryOnly&&!isDir&&!rel.startsWith(`${rule.pattern}/`)&&!rel.includes(`/${rule.pattern}/`))continue;if(rule.regex.test(rel))decision={ignored:!rule.negated,reason:`.docgenignore:${rule.raw}`};}return decision;}
function config(){try{return JSON.parse(fs.readFileSync(path.join(cwd,'.docgen','config','documentation.json'),'utf8'));}catch{return{};}}
const binaryExt=new Set(['.png','.jpg','.jpeg','.gif','.webp','.bmp','.ico','.tif','.tiff','.avif','.heic','.psd','.mp3','.wav','.flac','.aac','.ogg','.m4a','.mp4','.mov','.avi','.mkv','.webm','.wmv','.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.zip','.gz','.tgz','.bz2','.xz','.7z','.rar','.tar','.jar','.war','.ear','.class','.dll','.exe','.so','.dylib','.o','.a','.lib','.woff','.woff2','.ttf','.otf','.eot','.bin','.dat','.db','.sqlite','.sqlite3','.p12','.pfx','.jks','.keystore','.apk','.ipa','.iso','.dmg','.img','.wasm','.pyc']);
function binaryDecision(target,rel,cfg){
  if(cfg.ignore?.binary?.enabled===false||!fs.existsSync(target)||!fs.statSync(target).isFile())return null;
  const ext=path.extname(rel).toLowerCase();const deny=new Set((cfg.ignore?.binary?.denyExtensions??[]).map((x)=>String(x).toLowerCase()));
  const allow=new Set([...(cfg.sourceExtensions??[]),...(cfg.ignore?.binary?.allowExtensions??[])].map((x)=>String(x).toLowerCase()));
  if(deny.has(ext)||(!allow.has(ext)&&binaryExt.has(ext)))return `binary-extension:${ext||'<none>'}`;
  const stat=fs.statSync(target);const max=Number(cfg.ignore?.binary?.maxTextFileBytes??4194304);if(stat.size>max)return `text-file-too-large:${stat.size}`;
  let buf;try{const fd=fs.openSync(target,'r');buf=Buffer.alloc(Math.min(Number(cfg.ignore?.binary?.probeBytes??16384),stat.size));const n=fs.readSync(fd,buf,0,buf.length,0);fs.closeSync(fd);buf=buf.subarray(0,n);}catch{return'non-text-unreadable';}
  const sig=(...xs)=>xs.every((b,i)=>buf[i]===b);if(sig(0x89,0x50,0x4e,0x47)||sig(0xff,0xd8,0xff)||sig(0x25,0x50,0x44,0x46)||sig(0x50,0x4b,0x03,0x04)||sig(0x1f,0x8b)||sig(0x7f,0x45,0x4c,0x46)||sig(0x4d,0x5a)||sig(0x00,0x61,0x73,0x6d))return'binary-magic-signature';
  if(buf.includes(0))return'binary-null-byte';
  try{new TextDecoder('utf-8',{fatal:true}).decode(buf);}catch{return'non-utf8-content';}
  return null;
}
function configExcluded(rel,cfg){for(const raw of cfg.exclude??[]){const p=String(raw).replaceAll('\\','/').replace(/^\.\//,'');const cleaned=p.replace(/\/\*\*$/,'').replace(/\/+$/,'');if(patternRegex(cleaned,cleaned.startsWith('/')).test(rel)||rel===cleaned||rel.startsWith(`${cleaned}/`))return `config.exclude:${raw}`;}return null;}
function gitRepositoryAvailable(){
  if(fs.existsSync(path.join(cwd,'.git')))return true;
  const r=spawnSync('git',['rev-parse','--is-inside-work-tree'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore'],shell:process.platform==='win32'});
  return r.status===0&&String(r.stdout??'').trim()==='true';
}
function fallbackGitIgnored(rel){
  const seg=norm(rel).split('/');let ignored=false;
  for(let depth=0;depth<seg.length;depth++){const base=seg.slice(0,depth).join('/');const file=path.join(cwd,base,'.gitignore');const m=matchRules(seg.slice(depth).join('/'),false,rules(file));if(m)ignored=m.ignored;}
  return ignored;
}
function gitIgnored(rel){
  if(!gitRepositoryAvailable())return fallbackGitIgnored(rel);
  const r=spawnSync('git',['check-ignore','--no-index','-q','--',rel],{cwd,stdio:'ignore',shell:process.platform==='win32'});
  if(r.status===0)return true;
  if(r.error?.code==='ENOENT'||r.status===127)return fallbackGitIgnored(rel);
  return false;
}
function decision(rawPath){
  const target=resolveWorkspacePath(rawPath,cwd); if(!target)return null;
  if(!isWithin(target,cwd))return {ignored:true,reason:'outside repository workspace'};
  const rel=norm(path.relative(cwd,target));
  if(rel==='.docgen'||rel.startsWith('.docgen/')||rel==='docs'||rel.startsWith('docs/'))return {ignored:false};
  const cfg=config(); const hard=['.git','.commandcode','node_modules','target','build','dist','coverage','vendor'];
  for(const prefix of hard)if(rel===prefix||rel.startsWith(`${prefix}/`))return {ignored:true,reason:`docgen-hard-exclude:${prefix}/**`};
  const ce=configExcluded(rel,cfg);if(ce)return{ignored:true,reason:ce};
  if(cfg.ignore?.useGitignore!==false&&gitIgnored(rel))return{ignored:true,reason:'.gitignore'};
  if(cfg.ignore?.useDocgenignore!==false){const file=path.join(cwd,cfg.ignore?.docgenignoreFile||'.docgenignore');const d=matchRules(rel,fs.existsSync(target)&&fs.statSync(target).isDirectory(),rules(file));if(d)return d;}
  const binary=binaryDecision(target,rel,cfg);if(binary)return{ignored:true,reason:binary};
  return {ignored:false};
}

if (['grep','glob','read_multiple_files'].some((x)=>toolName.includes(x))) {
  const explicit = input.path ?? input.directory ?? input.file_path;
  const pattern = input.pattern ?? input.glob ?? input.query;
  if (!explicit || (typeof pattern === 'string' && /[?*\[]/.test(pattern))) {
    deny(`DocGen blocks broad ${toolName || 'read/search'} operations because they may include ignored files. Use .docgen/state/source-files.txt, explicit read_file calls, or \`docgen source-grep <text>\`.`);
    process.exit(0);
  }
}

const rawPaths=[];
for(const key of ['file_path','path','directory']) if(typeof input[key]==='string') rawPaths.push(input[key]);
for(const key of ['paths','files']) if(Array.isArray(input[key])) rawPaths.push(...input[key].filter((x)=>typeof x==='string'));
for(const key of ['pattern','glob']) if(typeof input[key]==='string') {
  const value=input[key];
  if(/[?*\[]/.test(value) && !norm(value).startsWith('.docgen/') && !norm(value).startsWith('docs/')) {
    deny(`DocGen blocks wildcard source reads because they may bypass .gitignore/.docgenignore. Read .docgen/state/source-files.txt, then read explicit included paths. Blocked pattern: ${value}`);
    process.exit(0);
  }
  rawPaths.push(value);
}
for(const raw of rawPaths){const d=decision(raw);if(d?.ignored){deny(`DocGen will not read ignored path: ${raw} (${d.reason}). Active source inventory: .docgen/state/source-files.txt`);process.exit(0);}}
