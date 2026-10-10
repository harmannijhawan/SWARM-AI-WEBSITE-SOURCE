import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consumeChatStream,ChatStreamError,retryDisposition} from '../lib/chat-stream';
import {chatBudget} from '../lib/server/chat-budget';
const encoder=new TextEncoder();
const signal=()=>new AbortController().signal;
test('client consumes split SSE, heartbeats and terminal event without waiting for EOF',async()=>{
  let cancelled=0;
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(encoder.encode(': heartbeat\n\nevent: delta\ndata: {"token":"hel'));c.enqueue(encoder.encode('lo"}\n\nevent: done\ndata: {}\n\n'));},cancel(){cancelled++;}});
  const events:string[]=[];await consumeChatStream(body,signal(),type=>events.push(type));
  assert.deepEqual(events,['delta','done']);assert.equal(cancelled,1);assert(!body.locked);
});
test('client detects dropped stream and network outage followed by recovery',async()=>{
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(encoder.encode('event: delta\ndata: {"token":"partial"}\n\n'));c.close();}});
  await assert.rejects(consumeChatStream(body,signal(),()=>{}),(e:unknown)=>e instanceof ChatStreamError&&e.category==='network'&&e.retryable);
  assert(!body.locked);
  await consumeChatStream(new ReadableStream({start(c){c.enqueue(encoder.encode('event: done\ndata: {}\n\n'));}}),signal(),()=>{});
});
test('client cancels stalled stream and releases reader',async()=>{
  let cancelled=false;const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
  await assert.rejects(consumeChatStream(body,signal(),()=>{},20),(e:unknown)=>e instanceof ChatStreamError&&e.category==='timeout');
  assert(cancelled);assert(!body.locked);
});
test('client user cancellation interrupts a pending read',async()=>{
  const controller=new AbortController();let cancelled=false;
  const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
  const consuming=consumeChatStream(body,controller.signal,()=>{});controller.abort();
  await assert.rejects(consuming,(e:unknown)=>e instanceof ChatStreamError&&e.category==='cancelled');assert(cancelled);assert(!body.locked);
});
test('expired session error is terminal and not retryable',async()=>{
  let cancelled=false;
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(encoder.encode('event: error\ndata: {"error":"Sign in again.","category":"auth","retryable":false,"requestId":"fixture-id"}\n\n'));},cancel(){cancelled=true;}});
  await assert.rejects(consumeChatStream(body,signal(),()=>{}),(e:unknown)=>e instanceof ChatStreamError&&e.category==='auth'&&!e.retryable&&e.requestId==='fixture-id');assert(cancelled);assert(!body.locked);
});
test('one budget spans all stages rather than restarting for each provider call',async()=>{
  const budget=chatBudget(signal(),60);const initial=budget.remaining();
  await new Promise(resolve=>setTimeout(resolve,25));assert(budget.remaining()<initial);
  await new Promise(resolve=>setTimeout(resolve,45));assert(budget.signal.aborted);assert(budget.timedOut);budget.dispose();
});
test('budget propagates user cancellation and disposal removes its timer',async()=>{
  const controller=new AbortController();const budget=chatBudget(controller.signal,1000);controller.abort();assert(budget.signal.aborted);assert(!budget.timedOut);budget.dispose();
  const disposed=chatBudget(signal(),20);disposed.dispose();await new Promise(resolve=>setTimeout(resolve,30));assert(!disposed.signal.aborted);
});
test('Retry reconciles exactly the saved request and never repeats a completed or unrelated turn',()=>{
  const user={id:1,role:'user',content:'Same prompt',requestId:'request-a'};
  const assistant={id:2,role:'assistant',content:'Complete answer'};
  assert.deepEqual(retryDisposition([user],'send','request-a'),{type:'regenerate',messageId:1});
  assert.deepEqual(retryDisposition([user,assistant],'send','request-a'),{type:'complete'});
  assert.deepEqual(retryDisposition([user,assistant],'send','request-b'),{type:'restore'});
  assert.deepEqual(retryDisposition([user,{...assistant,content:'Partial\n\n*Response stopped.*'}],'send','request-a'),{type:'regenerate',messageId:1});
  assert.deepEqual(retryDisposition([user],'regenerate','unused',1),{type:'regenerate',messageId:1});
  assert.deepEqual(retryDisposition([user],'regenerate','unused',99),{type:'restore'});
  assert.deepEqual(retryDisposition([],'send','request-a'),{type:'restore'});
});
