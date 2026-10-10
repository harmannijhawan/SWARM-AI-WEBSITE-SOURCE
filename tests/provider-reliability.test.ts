import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { openAIChat } from '../lib/server/desktop-providers/http';
import { ProviderError, type ChatRequest } from '../lib/server/desktop-providers/types';

const token = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n';
const end = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
async function fixture(run: (res: ServerResponse) => void, check: (url: string) => Promise<void>) {
  const server = createServer(async (req, res) => { for await (const _ of req) {} run(res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await check(`http://127.0.0.1:${(server.address() as {port:number}).port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const request = (extra: Partial<ChatRequest> = {}): ChatRequest => ({ messages: [{role:'user',content:'fixture'}], maxTokens: 20, temperature: 0, stream: true, signal: new AbortController().signal, firstTokenTimeoutMs: 500, totalTimeoutMs: 1000, ...extra });
const kind = (expected: string) => (error: unknown) => error instanceof ProviderError && error.kind === expected;

test('completion marker terminates an SSE connection even when upstream leaves HTTP open', async () => {
  await fixture(res => { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.write(token + end); }, async url => {
    const result = await openAIChat(url, {}, 'fixture', request({totalTimeoutMs:150}));
    assert.equal(result.text, 'Hello');
  });
});
test('EOF halfway through a reply is a connection failure, never a completed answer', async () => {
  await fixture(res => { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.end(token); }, async url => {
    await assert.rejects(openAIChat(url, {}, 'fixture', request()), kind('network'));
  });
});

test('short response, slow streaming and repeated concurrent requests complete with cleanup', async () => {
  let connections=0;
  await fixture(res => {
    connections++;res.on('close',()=>connections--);
    res.writeHead(200, {'Content-Type':'text/event-stream'});res.write(token);
    const timer=setTimeout(()=>res.write(end),80);res.on('close',()=>clearTimeout(timer));
  }, async url => {
    for(let batch=0;batch<5;batch++) {
      const results=await Promise.all(Array.from({length:4},()=>openAIChat(url,{},'fixture',request({firstTokenTimeoutMs:50,totalTimeoutMs:1000}))));
      assert(results.every(result=>result.text==='Hello'));
    }
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(connections,0);
  });
});
test('authentication, validation, rate limits and temporary failures are typed without automatic replay', async () => {
  for(const [status,category] of [[401,'auth'],[400,'bad_request'],[429,'rate_limit'],[503,'server']] as const) {
    let calls=0;
    await fixture(res=>{calls++;if(calls===1){res.writeHead(status,{'Retry-After':'1'});res.end('fixture failure');}else{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(token+end);}},async url=>{
      await assert.rejects(openAIChat(url,{},'fixture',request()),kind(category));assert.equal(calls,1);
      assert.equal((await openAIChat(url,{},'fixture',request())).text,'Hello');assert.equal(calls,2);
    });
  }
});
test('first-token timeout, total timeout, user cancellation and malformed streams terminate', async () => {
  await fixture(res=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();},async url=>{
    await assert.rejects(openAIChat(url,{},'fixture',request({firstTokenTimeoutMs:30})),kind('timeout'));
  });
  await fixture(res=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(token);},async url=>{
    await assert.rejects(openAIChat(url,{},'fixture',request({totalTimeoutMs:50})),kind('timeout'));
    const controller=new AbortController();
    await assert.rejects(openAIChat(url,{},'fixture',request({signal:controller.signal,onToken:()=>controller.abort()})),kind('cancelled'));
  });
  await fixture(res=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: broken\n\n');},async url=>{
    await assert.rejects(openAIChat(url,{},'fixture',request()),kind('invalid'));
  });
});
