import {Storage} from './storage';
type AccountDb=DatabaseSync|Storage;
import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const hash = (s:string) => createHash('sha256').update(s).digest('hex');
const schemaReady=new WeakMap<object,Promise<unknown>>();
export async function accountTables(db:AccountDb) {
  const previous=schemaReady.get(db);if(previous){await previous;return;}

  const creation=Promise.resolve(db.exec(`CREATE TABLE IF NOT EXISTS active_runs(owner TEXT NOT NULL,id TEXT NOT NULL,lease TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(owner,id)); CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT NOT NULL,role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS device_sessions(hash TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS device_grants(code TEXT PRIMARY KEY,owner TEXT NOT NULL,challenge TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_deleted(owner TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(owner,id));
    CREATE TABLE IF NOT EXISTS account_documents(owner TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,id));`));schemaReady.set(db,creation);await creation;
}
export async function deviceOwner(db:AccountDb,token:string):Promise<string|null> {
  await accountTables(db);
  const row=await db.prepare('SELECT owner FROM device_sessions WHERE hash=? AND expires>?').get(hash(token),Date.now()) as {owner:string}|undefined;
  return row?.owner||null;
}
export async function issueDevice(db:AccountDb,owner:string,name:string) {
  await accountTables(db);const token='swarm_device_'+randomBytes(32).toString('base64url');
  await db.prepare('INSERT INTO device_sessions VALUES(?,?,?,?)').run(hash(token),owner,name.slice(0,100),Date.now()+30*86400000);return token;
}
export async function accountProfile(db:AccountDb,owner:string) {
  await accountTables(db);return (await db.prepare('SELECT id,email,role FROM accounts WHERE id=?').get(owner))||{id:owner,email:null,role:'member'};
}
type Deps={db:AccountDb;readKey:(owner:string,id:string)=>{apiKey:string;accountId?:string|null}|null|Promise<{apiKey:string;accountId?:string|null}|null>;writeKey:(owner:string,id:string,key:string|null,accountId?:string|null)=>void|Promise<void>;providers:string[];active:Set<string>};
export async function accountApi(req:Request,path:string[],owner:string|null,d:Deps):Promise<Response|null> {
  if(path[0]!=='account')return null;await accountTables(d.db);
  const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
  const fail=(message:string,status=400)=>json({error:message},status);
  const text= req.method==='POST'?await req.text():'';
  if(text.length>16000000)return fail('Sync request is too large.',413);
  let body:Record<string,any>={};try{body=JSON.parse(text||'{}');}catch{return fail('Invalid JSON.');}
  if(path[1]==='desktop-token'&&req.method==='POST') {
    if(typeof body.code!=='string'||typeof body.verifier!=='string'||body.verifier.length<43||body.verifier.length>128)return fail('Invalid connection grant.');
    const grant=await d.db.prepare('SELECT * FROM device_grants WHERE code=? AND expires>?').get(hash(body.code),Date.now()) as {owner:string;challenge:string}|undefined;
    if(!grant||createHash('sha256').update(body.verifier).digest('base64url')!==grant.challenge)return fail('Connection expired or invalid.',401);
    const claimed=await d.db.prepare('DELETE FROM device_grants WHERE code=? RETURNING owner').get(hash(body.code));if(!claimed)return fail('Connection expired or invalid.',401);
    return json({token:await issueDevice(d.db,grant.owner,'SWARM desktop'),account:await accountProfile(d.db,grant.owner)});
  }
  if(!owner)return fail('Sign in to continue.',401);
  if(path[1]==='profile'&&req.method==='GET')return json(await accountProfile(d.db,owner));
  if(path[1]==='devices'&&req.method==='GET')return json({devices:await d.db.prepare('SELECT hash AS id,name,expires FROM device_sessions WHERE owner=? AND expires>?').all(owner,Date.now())});
  if(path[1]==='revoke'&&req.method==='POST') {
    if(typeof body.id!=='string')return fail('Choose a device.');await d.db.prepare('DELETE FROM device_sessions WHERE hash=? AND owner=?').run(body.id,owner);return json({ok:true});
  }
  if(path[1]==='desktop-authorizations'&&req.method==='POST') {
    if(typeof body.challenge!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(body.challenge)||typeof body.state!=='string'||! /^[A-Za-z0-9_-]{32,128}$/.test(body.state))return fail('Invalid desktop connection.');
    let callback:URL;try{callback=new URL(body.callback);}catch{return fail('Invalid callback.');}
    if(callback.protocol!=='http:'||callback.hostname!=='127.0.0.1'||!callback.port||callback.pathname!=='/callback'||callback.username||callback.password||callback.search||callback.hash)return fail('Desktop callback must use a local loopback port.');
    const code=randomBytes(32).toString('base64url');await d.db.prepare('DELETE FROM device_grants WHERE expires<?').run(Date.now());
    await d.db.prepare('INSERT INTO device_grants VALUES(?,?,?,?)').run(hash(code),owner,body.challenge,Date.now()+120000);
    callback.searchParams.set('code',code);callback.searchParams.set('state',body.state);return json({callback:callback.href});
  }
  if(path[1]==='sync'&&req.method==='POST') {
    const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
    if(!token.startsWith('swarm_device_')||await deviceOwner(d.db,token)!==owner)return fail('Desktop device authentication required.',403);
    if(!Array.isArray(body.changes)||body.changes.length>1000)return fail('Invalid sync changes.');
    const conflicts:string[]=[],busy:string[]=[];
    await d.db.exec('BEGIN IMMEDIATE');if(d.db instanceof Storage)await d.db.lockOwner(owner);
    try {
      for(const change of body.changes) {
        if(!change||typeof change.id!=='string'||change.id.length>200||!['chat','provider','document'].includes(change.kind)||!(change.base===null||typeof change.base==='string'))throw new Error('Invalid sync record.');
        const id=change.id;let current:unknown=null;
        if(change.kind==='chat') {
          const row=await d.db.prepare('SELECT data FROM conversations WHERE id=? AND owner=?').get(id,owner) as {data:string}|undefined;
          const other=await d.db.prepare('SELECT owner FROM conversations WHERE id=?').get(id) as {owner:string}|undefined;
          if(other&&other.owner!==owner)throw new Error('Conversation ID is unavailable.');current=row?JSON.parse(row.data):null;
          if(d.active.has(`${owner}:${id}`)||await d.db.prepare('SELECT id FROM active_runs WHERE owner=? AND id=? AND expires>?').get(owner,id,Date.now())){conflicts.push(`chat:${id}`);busy.push(id);continue;}
        } else if(change.kind==='provider') {if(!d.providers.includes(id))throw new Error('Unsupported provider.');current=await d.readKey(owner,id);}
        else {const row=await d.db.prepare('SELECT data FROM account_documents WHERE owner=? AND id=?').get(owner,id) as {data:string}|undefined;current=row?JSON.parse(row.data):null;}
        const version=current?hash(JSON.stringify(current)):null;
        if(version!==change.base){conflicts.push(`${change.kind}:${id}`);continue;}
        if(change.kind==='chat') {
          if(change.value===null){await d.db.prepare('DELETE FROM conversations WHERE owner=? AND id=?').run(owner,id);await d.db.prepare('INSERT OR IGNORE INTO sync_deleted VALUES(?,?)').run(owner,id);}
          else {const c=change.value;if(c.id!==id||typeof c.title!=='string'||c.title.length>120||typeof c.updatedAt!=='string'||!Number.isFinite(Date.parse(c.updatedAt))||!Array.isArray(c.messages)||c.messages.length>10000||c.messages.some((m:any)=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||typeof m.id!=='number'||!Number.isFinite(m.id)||typeof m.createdAt!=='string'))throw new Error('Invalid conversation.');
            await d.db.prepare('INSERT INTO conversations VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE owner=excluded.owner').run(id,owner,JSON.stringify(c));await d.db.prepare('DELETE FROM sync_deleted WHERE owner=? AND id=?').run(owner,id);}
        } else if(change.kind==='provider') {
          const key=change.value?.apiKey;if(change.value!==null&&(typeof key!=='string'||key.length<8||key.length>4096||/[\r\n\0]/.test(key)))throw new Error('Invalid provider key.');await d.writeKey(owner,id,key||null,change.value?.accountId||null);
        } else {if(change.value===null)await d.db.prepare('DELETE FROM account_documents WHERE owner=? AND id=?').run(owner,id);else await d.db.prepare('INSERT OR REPLACE INTO account_documents VALUES(?,?,?)').run(owner,id,JSON.stringify(change.value));}
      }
      await d.db.exec('COMMIT');
    }catch {await d.db.exec('ROLLBACK');return fail('Sync records could not be applied.');}
    const records:any[]=[];
    for(const row of await d.db.prepare('SELECT id,data FROM conversations WHERE owner=?').all(owner) as {id:string;data:string}[]){const value=JSON.parse(row.data);records.push({kind:'chat',id:row.id,value,version:hash(JSON.stringify(value))});}
    for(const row of await d.db.prepare('SELECT id FROM sync_deleted WHERE owner=?').all(owner))records.push({kind:'chat',id:row.id,value:null,version:null});
    for(const id of d.providers){const value=await d.readKey(owner,id);records.push({kind:'provider',id,value,version:value?hash(JSON.stringify(value)):null});}
    for(const row of await d.db.prepare('SELECT id,data FROM account_documents WHERE owner=?').all(owner) as {id:string;data:string}[]){const value=JSON.parse(row.data);records.push({kind:'document',id:row.id,value,version:hash(JSON.stringify(value))});}
    return json({account:await accountProfile(d.db,owner),records,conflicts,busy});
  }
  return fail('Account endpoint not found.',404);
}
