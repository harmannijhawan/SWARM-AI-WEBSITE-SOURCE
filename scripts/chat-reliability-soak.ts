import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { handleApi } from '../lib/server/backend';
import { adapters, envNames } from '../lib/server/providers';
import { openAIChat } from '../lib/server/desktop-providers/http';

async function main() {
  process.env.SWARM_DATA_DIR=mkdtempSync(join(tmpdir(),'swarm-reliability-soak-'));
  for(const name of ['DATABASE_URL','SWARM_DATABASE_URL','CLERK_SECRET_KEY',...Object.values(envNames).flat()])delete process.env[name];
  const start=Date.now(), duration=Number(process.env.SOAK_DURATION_MS||1_800_000);
  const report={startedAt:new Date(start).toISOString(),durationMs:0,requests:0,providerCalls:0,projectRequests:0,injectedFailures:0,unexpectedFailures:0,recoveries:0,duplicateMessages:0,lockFailures:0,openProviderResponses:0,memory:[] as {elapsedMs:number;rss:number;heapUsed:number}[],complete:false};
  const sample=()=>{const m=process.memoryUsage();report.memory.push({elapsedMs:Date.now()-start,rss:m.rss,heapUsed:m.heapUsed});};
  const api=(path:string,method='GET',body?:unknown)=>handleApi(new Request(`http://localhost:3000/api/${path}`,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),path.split('/'));
  const server=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    report.providerCalls++;
    const input=JSON.parse(raw),scenario=input.messages.at(-1).content;
    if(scenario==='unavailable'){res.writeHead(503);res.end('fixture unavailable');return;}
    if(scenario==='rate'){res.writeHead(429,{'Retry-After':'1'});res.end('fixture rate limit');return;}
    if(!input.stream){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'Fixture draft'},finish_reason:'stop'}]}));return;}
    report.openProviderResponses++;res.on('close',()=>report.openProviderResponses--);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: {"choices":[{"delta":{"content":"Fixture reply"}}]}\n\n');
    if(scenario==='drop'){res.end();return;}
    // Exercise DONE without HTTP EOF on every success; reader cancellation must release it.
    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const adapter=adapters.find(a=>a.id==='openai')!;
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  adapter.discover=async()=>[{modelId:'fixture',displayName:'Fixture',capabilities:['chat'],contextLength:8192,maxOutput:100,freeStatus:'unknown'}];
  adapter.chat=(_cfg,_model,input)=>openAIChat(url,{},'fixture',{...input,firstTokenTimeoutMs:1000,totalTimeoutMs:2000});
  await api('providers/openai','PUT',{apiKey:'soak-fixture-key'});
  let iteration=0;
  const output=join(process.cwd(),'reports','network-reliability-soak.json');mkdirSync(join(process.cwd(),'reports'),{recursive:true});
  sample();
  try {
    while(Date.now()-start<duration){
      await Promise.all(Array.from({length:4},async(_,index)=>{
        const scenario=['success','drop','unavailable','rate'][(iteration+index)%4];
        const created=await (await api('conversations','POST',{title:'Reliability fixture'})).json();
        const path=`conversations/${created.id}`;
        const payload={action:'send',prompt:scenario,providerId:'openai',modelId:'fixture',mode:index%2===0?'chat':'swarm'};
        try {
          const response=await api(`${path}/stream`,'POST',payload);report.requests++;if(payload.mode==='swarm')report.projectRequests++;const events=await response.text();
          if(response.status===409)report.lockFailures++;
          if(scenario==='success'){if(!events.includes('event: done'))report.unexpectedFailures++;}
          else {report.injectedFailures++;if(!events.includes('event: error'))report.unexpectedFailures++;
            const stored=await (await api(path)).json();const user=stored.messages.find((m:any)=>m.role==='user');
            // Recover via edit of the same persisted user turn: never append a duplicate task.
            const recovery=await api(`${path}/stream`,'POST',{...payload,action:'edit',messageId:user.id,prompt:'success'});report.requests++;if(payload.mode==='swarm')report.projectRequests++;
            if((await recovery.text()).includes('event: done'))report.recoveries++;else report.unexpectedFailures++;
          }
          const saved=await (await api(path)).json();if(saved.messages.filter((m:any)=>m.role==='user').length!==1||saved.messages.filter((m:any)=>m.role==='assistant').length!==1)report.duplicateMessages++;
        }catch {report.unexpectedFailures++;}
        finally {if((await api(path,'DELETE')).status!==204)report.lockFailures++;}
      }));
      iteration++;
      if(iteration%15===0){sample();report.durationMs=Date.now()-start;writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({elapsedSeconds:Math.round(report.durationMs/1000),requests:report.requests,unexpectedFailures:report.unexpectedFailures}));}
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
  }finally{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    report.durationMs=Date.now()-start;report.complete=true;sample();writeFileSync(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify({...report,memorySamples:report.memory.length,memory:undefined}));
    await (globalThis as any).swarmWeb?.db.close();
  }
  if(report.unexpectedFailures||report.duplicateMessages||report.lockFailures)process.exitCode=1;
}
main().catch(()=>{console.error('Soak runner failed');process.exitCode=1;});
