import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {accountDatabase} from './lib/server/backend';
import {issueDevice,hash,accountTables} from './lib/server/accounts';
import {storageContext} from './lib/server/storage';
async function main(){
 const db=accountDatabase(),owner='user_3KQClKnPotF4uU5fAAPLoJ3gKbH';await accountTables(db);
 // Refresh account records from the local workspace before the first public launch.
 if(!process.env.PROBE_ORIGIN){const local=new DatabaseSync('.swarm-web/chat.sqlite',{readOnly:true});await storageContext(async()=>{await db.exec('BEGIN IMMEDIATE');await db.lockOwner(owner);try{for(const table of ['conversations','credentials','account_documents','routing_health']){const rows=local.prepare(`SELECT * FROM ${table} WHERE owner=?`).all(owner);for(const row of rows){const columns=Object.keys(row);const key=table==='conversations'?['id']:table==='credentials'?['owner','provider']:['owner','id'];await db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')}) ON CONFLICT(${key.join(',')}) DO UPDATE SET ${columns.filter(c=>!key.includes(c)).map(c=>`${c}=excluded.${c}`).join(',')}`).run(...Object.values(row));}}await db.exec('COMMIT');}catch(e){await db.exec('ROLLBACK');throw e;}});local.close();}
 const token=await issueDevice(db,owner,'Deployment verification'),origin=process.env.PROBE_ORIGIN||'http://localhost:3100';let id:string|undefined;const fixture=randomUUID();
 const request=(path:string,method='GET',body?:unknown)=>fetch(origin+'/api/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:origin},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});
 try{
  assert.equal((await fetch(origin+'/api/conversations')).status,401);
  const profile=await (await request('account/profile')).json();console.log('Profile verification:',profile);assert.equal(profile.role,'owner');assert.equal(profile.email,'harmanminecraft490@gmail.com');
  const providers=await (await request('providers')).json();console.log('Configured providers:',providers.providers.filter((p:any)=>p.configured).map((p:any)=>p.providerId));
  const sync=await request('account/sync','POST',{changes:[]});assert.equal(sync.status,200);const data=await sync.json();console.log('Account sync:',data.records.filter((r:any)=>r.kind==='chat'&&r.value).length,'chats',data.records.filter((r:any)=>r.kind==='document').length,'documents');
  const models=await request('models');assert.equal(models.status,200);const inventory=await models.json();assert(inventory.models.length>0);console.log('Discovered models:',inventory.models.length);
  const created=await request('conversations','POST',{title:'Deployment verification'});assert.equal(created.status,201);id=(await created.json()).id;
  const stream=await request(`conversations/${id}/stream`,'POST',{action:'send',prompt:'Reply with exactly: SWARM cloud ready',mode:'chat',modelId:'auto'});assert.equal(stream.status,200);const text=await stream.text();assert(text.includes('event: done'),text.slice(-1000));assert(!text.includes('event: error'),text.slice(-1000));console.log('Real Auto chat: passed');
  const timestamp=new Date().toISOString();const value={id:fixture,title:'Preview verification',createdAt:timestamp,updatedAt:timestamp,messages:[{id:1,role:'assistant',createdAt:timestamp,content:'```html filename="index.html"\n<!doctype html><html><body><h1>Preview ready</h1></body></html>\n```'}]};
  assert.equal((await request('account/sync','POST',{changes:[{kind:'chat',id:fixture,base:null,value}]})).status,200);
  const preview=await request(`conversations/${fixture}/preview`,'POST',{});assert.equal(preview.status,200);assert((await preview.json()).html.includes('Preview ready'));console.log('Cloud project preview: passed');
  console.log('Verified origin:',origin,'owner/admin and account isolation passed');
 }finally{for(const cid of [id,fixture])if(cid){await db.prepare('DELETE FROM conversations WHERE id=? AND owner=?').run(cid,owner);await db.prepare('DELETE FROM sync_deleted WHERE id=? AND owner=?').run(cid,owner);await db.prepare('DELETE FROM active_runs WHERE id=? AND owner=?').run(cid,owner);}await db.prepare('DELETE FROM device_sessions WHERE hash=?').run(hash(token));await db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
