import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {accountApi,accountTables,hash} from '../lib/server/accounts';
import {validatePreferences} from '../shared/preferences';

test('portable preferences reject machine permissions, endpoint injection and invalid ranges',()=>{
 for(const value of [{execution:{autoApprove:['*']}},{providers:{baseUrls:{groq:'https://attacker.invalid'}}},{routing:{maxFallbacks:-1}},{appearance:{fontScale:100}},{ai:{temperature:NaN}},{providers:{enabled:JSON.parse('{"__proto__":true}')}}])assert.throws(()=>validatePreferences(value));
 assert.deepEqual(validatePreferences({ai:{routing:'quality',temperature:.5},appearance:{theme:'dark'}}),{ai:{routing:'quality',temperature:.5},appearance:{theme:'dark'}});
});
test('preferences require an owner, survive reads, prevent lost updates, and isolate accounts; Android callbacks are fixed',async()=>{
 const db=new DatabaseSync(':memory:');await accountTables(db);
 const deps={db,active:new Set<string>(),providers:[],readKey:()=>null,writeKey:()=>{}};
 const call=(endpoint:string,owner:string|null,body?:unknown)=>accountApi(new Request('https://www.swarmgpt.online/api/account/'+endpoint,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined}),['account',endpoint],owner,deps);
 assert.equal((await call('preferences',null))?.status,401);
 const preferences={ai:{routing:'quality'},appearance:{theme:'dark'}};
 const saved=await (await call('preferences','alice',{version:null,preferences}))!.json();assert.equal(saved.version,hash(JSON.stringify(preferences)));
 assert.deepEqual((await (await call('preferences','alice'))!.json()).preferences,preferences);
 assert.deepEqual((await (await call('preferences','bob'))!.json()).preferences,{});
 assert.equal((await call('preferences','alice',{version:null,preferences:{}}))?.status,409);
 assert.equal((await call('preferences','alice',{version:saved.version,preferences:{computer:{native:true}}}))?.status,400);
 const verifier='x'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
 const body={state:'s'.repeat(43),challenge,callback:'swarm-ai://auth/callback'};
 assert.equal((await call('android-authorizations','alice',{...body,callback:'swarm-ai://evil/callback'}))?.status,400);
 const grant=await (await call('android-authorizations','alice',body))!.json();const code=new URL(grant.callback).searchParams.get('code');
 db.prepare('UPDATE device_grants SET expires=0 WHERE code=?').run(hash(code!));
 assert.equal((await call('desktop-token',null,{code,verifier}))?.status,401);
 db.close();
});
