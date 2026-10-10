import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { codeFiles } from '../lib/code-files';
import { adapters, envNames } from '../lib/server/providers';
import { handleApi } from '../lib/server/backend';
import { openAIChat } from '../lib/server/desktop-providers/http';
import { ProviderError } from '../lib/server/desktop-providers/types';

process.env.SWARM_DATA_DIR=mkdtempSync(join(tmpdir(),'swarm-web-test-'));
delete process.env.CLERK_SECRET_KEY;
for(const names of Object.values(envNames))for(const name of names)delete process.env[name];
process.env.SWARM_FREE_CHATS='100'; // Reliability suite uses a high test-only allowance; quota tests use launch defaults.
const configure=(provider:string,key:string,models:string[])=>{process.env[envNames[provider][0]]=key;process.env.SWARM_STANDARD_MODELS=models.map(m=>provider+':'+m).join(',');(globalThis as any).swarmWeb?.models.clear();};
const disable=(provider:string)=>{delete process.env[envNames[provider][0]];(globalThis as any).swarmWeb?.models.clear();};
const request=(path:string,method='GET',body?:unknown,origin='http://localhost:3000')=>handleApi(new Request(`http://localhost:3000/api/${path}`,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),path.split('?')[0].split('/'));

test('persistent conversations, managed keys, owner boundary, regeneration and SWARM events',async()=>{
  assert.equal((await request('health')).status,200);
  assert.equal((await request('health','GET',undefined,'https://untrusted.example')).status,403);
  assert.equal((await handleApi(new Request('https://public.example/api/health'),['health'])).status,403);
  assert.equal((await request('providers/openai','PUT',{apiKey:'test-key-123456'})).status,403);
  configure('openai','test-key-123456',['test-model']);
  const safe=await (await request('providers')).text();assert(!safe.includes('123456'));assert(!safe.includes('3456'));
  const adapter=adapters.find(a=>a.id==='openai')!;
  adapter.discover=async()=>[{modelId:'test-model',displayName:'Test model',capabilities:['chat'],contextLength:8192,maxOutput:4096,freeStatus:'unknown'}];
  let calls=0;
  adapter.chat=async(_config,_model,input)=>{calls++; const text=input.stream?'A real test fixture response.':'Strategy';if(input.stream)input.onToken?.(text);return {text,promptTokens:1,completionTokens:1,finishReason:'stop',latencyMs:1,ttftMs:1,usageEstimated:false};};
  assert.equal((await (await request('models')).json()).models.length,1);
  const created=await (await request('conversations','POST',{title:'Test conversation'})).json();
  const payload={action:'send',prompt:'Make a file',providerId:'openai',modelId:'test-model',mode:'chat'};
  const stream=await request(`conversations/${created.id}/stream`,'POST',payload);const text=await stream.text();assert(text.includes('event: delta'));assert(text.includes('event: done'));
  let conversation=await (await request(`conversations/${created.id}`)).json();assert.equal(conversation.messages.length,2);assert.equal(conversation.messages[0].content,'Make a file');
  const regenerated=await request(`conversations/${created.id}/stream`,'POST',{...payload,action:'regenerate',messageId:conversation.messages[0].id});assert((await regenerated.text()).includes('event: done'));
  conversation=await (await request(`conversations/${created.id}`)).json();assert.equal(conversation.messages.length,2);
  const swarm=await request(`conversations/${created.id}/stream`,'POST',{...payload,mode:'swarm'});assert((await swarm.text()).includes('Reviewer'));assert.equal(calls,5);const built=await (await request(`conversations/${created.id}`)).json();assert.equal(built.messages.at(-1).buildEvents.filter((e:{status:string})=>e.status==='completed').length,4);assert(built.messages.at(-1).buildEvents.find((e:{role:string;status:string})=>e.role==='planner'&&e.status==='completed').output);
  assert.equal((await (await request('conversations?q=Make')).json()).conversations.length,1);
  assert.equal((await request(`conversations/${created.id}`,'PATCH',{title:'Renamed'})).status,200);
  assert.equal((await request(`conversations/${created.id}`,'DELETE')).status,204);
  assert.equal((await request(`conversations/${created.id}`)).status,404);
  assert.equal((await request('providers/openai','DELETE')).status,403);disable('openai');
  assert.equal((await (await request('providers')).json()).providers.find((p:{providerId:string})=>p.providerId==='openai').configured,false);
});

test('desktop SSE adapter handles split chunks and stream usage',async()=>{
  const server=createServer(async(req,res)=>{
    for await(const _chunk of req){};
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: {"choices":[{"delta":{"content":"Hel');
    res.write('lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\ndata: [DONE]\n\n');res.end();
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const address=server.address() as {port:number};let tokens='';const result=await openAIChat(`http://127.0.0.1:${address.port}`,{},'test',{messages:[{role:'user',content:'hello'}],maxTokens:20,temperature:0.4,stream:true,signal:new AbortController().signal,firstTokenTimeoutMs:2000,totalTimeoutMs:5000,onToken:t=>tokens+=t});assert.equal(tokens,'Hello world');assert.equal(result.text,tokens);assert.equal(result.completionTokens,3);}finally{server.close();}
});

test('code download extraction preserves content and prevents traversal or duplicate names',()=>{
  const files=codeFiles('```python filename=../../main.py\nprint("hello")\n```\n```python filename=main.py\nprint("second")\n```');
  assert.equal(files.length,2);assert.equal(files[0].name,'main.py');assert.equal(files[0].content,'print("hello")\n');assert.equal(files[1].name,'2-main.py');
});

test('cancelling generation aborts the provider and releases the conversation lock',async()=>{
  const adapter=adapters.find(a=>a.id==='openai')!;
  configure('openai','test-key-cancel',['test-model']);
  adapter.discover=async()=>[{modelId:'test-model',displayName:'Test model',capabilities:['chat'],contextLength:8192,maxOutput:4096,freeStatus:'unknown'}];
  let aborted=false;
  adapter.chat=async(_config,_model,input)=>{
    input.onToken?.('Partial reply');
    await new Promise<void>((_resolve,reject)=>input.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('Cancelled'));},{once:true}));
    throw new Error('Unreachable');
  };
  const c=await (await request('conversations','POST',{})).json();
  const response=await request(`conversations/${c.id}/stream`,'POST',{action:'send',prompt:'Test cancellation',providerId:'openai',modelId:'test-model',mode:'chat'});
  const reader=response.body!.getReader();await reader.read();await reader.cancel();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert(aborted);
  const saved=await (await request(`conversations/${c.id}`)).json();assert(saved.messages.at(-1).content.includes('Response stopped'));
  assert.equal((await request(`conversations/${c.id}`,'DELETE')).status,204);
});

test('Auto falls back after a provider failure and stores the actual model',async()=>{
 const adapter=adapters.find(a=>a.id==='groq')!;
 adapter.discover=async()=>['llama-3.1-8b-instant','llama-3.2-3b'].map(modelId=>({modelId,displayName:modelId,capabilities:['chat'],contextLength:8192,maxOutput:4096,freeStatus:'free'}));
 let calls=0;adapter.chat=async(_config,_model,input)=>{calls++;if(calls===1)throw new Error('Fixture model unavailable');input.onToken?.('Fallback works.');return {text:'Fallback works.',promptTokens:1,completionTokens:2,finishReason:'stop',latencyMs:1,ttftMs:1,usageEstimated:false};};
 disable('openai');configure('groq','test-groq-key',['llama-3.1-8b-instant','llama-3.2-3b']);
 const c=await (await request('conversations','POST',{})).json();
 const stream=await request(`conversations/${c.id}/stream`,'POST',{action:'send',prompt:'Hello',providerId:'groq',modelId:'auto',mode:'chat'});
 const events=await stream.text();assert.equal(calls,2);assert(events.includes('event: routing'));assert(events.includes('event: reset'));assert(events.includes('event: done'));
 const stored=await (await request(`conversations/${c.id}`)).json();assert.equal(stored.messages.at(-1).content,'Fallback works.');assert(stored.messages.at(-1).modelName.includes('Groq'));
 disable('groq');
});

test('web project deadline emits a typed error, preserves input, sanitizes logs and releases its lock',async t=>{
  const adapter=adapters.find(a=>a.id==='openai')!;
  configure('openai','test-deadline-key',['deadline-model']);
  adapter.discover=async()=>[{modelId:'deadline-model',displayName:'Deadline fixture',capabilities:['chat'],contextLength:8192,maxOutput:4096,freeStatus:'unknown'}];
  let began!:()=>void;const started=new Promise<void>(resolve=>began=resolve);let aborted=false;
  adapter.chat=async(_config,_model,input)=>{
    began();await new Promise<void>((_resolve,reject)=>input.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('PRIVATE-FIXTURE-CONTENT'));},{once:true}));throw new Error('unreachable');
  };
  const c=await (await request('conversations','POST',{})).json();
  const warnings:unknown[]=[];const original=console.warn;console.warn=(...args)=>{warnings.push(args);};
  try {
    t.mock.timers.enable({apis:['setTimeout','Date']});
    const response=await request(`conversations/${c.id}/stream`,'POST',{action:'send',prompt:'PRIVATE-FIXTURE-CONTENT',providerId:'openai',modelId:'deadline-model',mode:'swarm'});
    await started;t.mock.timers.tick(240001);
    const events=await response.text();assert(aborted);assert(events.includes('event: error'));assert(events.includes('"category":"timeout"'));assert(events.includes('"stage":"plan"'));assert(!events.includes('event: done'));
    const logs=JSON.stringify(warnings);assert(!logs.includes('PRIVATE-FIXTURE-CONTENT'));assert(!logs.includes('test-deadline-key'));assert(logs.includes('requestId'));
    const stored=await (await request(`conversations/${c.id}`)).json();assert.equal(stored.messages.length,1);assert.equal(stored.messages[0].role,'user');
    assert.equal((await request(`conversations/${c.id}`,'DELETE')).status,204);
  }finally {console.warn=original;t.mock.timers.reset();disable('openai');}
});

test('Auto rate-limit exhaustion is bounded and permanent authentication skips the provider',async()=>{
  const adapter=adapters.find(a=>a.id==='groq')!;
  adapter.discover=async()=>Array.from({length:10},(_,i)=>({modelId:`reliability-${i}`,displayName:`Fixture ${i}`,capabilities:['chat' as const],contextLength:8192,maxOutput:4096,freeStatus:'free' as const}));
  for(const category of ['rate_limit','auth'] as const){
    configure('groq','test-exhaustion-key',Array.from({length:10},(_,i)=>'reliability-'+i));
    let calls=0;adapter.chat=async()=>{calls++;throw new ProviderError(category,'Private upstream text',category==='auth'?401:429,1000);};
    const c=await (await request('conversations','POST',{})).json();
    const response=await request(`conversations/${c.id}/stream`,'POST',{action:'send',prompt:'Hello',providerId:'groq',modelId:'auto',mode:'chat'});
    const events=await response.text();assert(events.includes('event: error'));assert.equal(calls,1);assert(!events.includes('Private upstream text'));
    assert.equal((await request(`conversations/${c.id}`,'DELETE')).status,204);
    disable('groq');
  }
});
