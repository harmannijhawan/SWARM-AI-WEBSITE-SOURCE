import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankAutomatic, chatPurpose } from '../lib/server/auto-router';
test('Auto router selects by purpose and filters cooldown, context and paid-only OpenAI',()=>{
 const models=[{id:'groq:fast',providerId:'groq',modelId:'llama-3.1-8b-instant',capabilities:['chat' as const],contextLength:32768},{id:'groq:code',providerId:'groq',modelId:'qwen3-coder-480b',capabilities:['coding' as const],contextLength:32768},{id:'paid',providerId:'openai',modelId:'gpt-4',contextLength:32768},{id:'small',providerId:'nvidia',modelId:'small',contextLength:512}];
 assert.equal(chatPurpose('Write a Python function'),'code');
 const ranked=rankAutomatic(models,'Write Python code',()=>undefined,100,'code');
 assert.equal(ranked[0].id,'groq:code');assert(!ranked.some(m=>m.id==='paid'||m.id==='small'));
 assert(!rankAutomatic(models,'hello',id=>id==='groq:code'?{calls:2,successes:0,consecutiveFailures:2,latencyMs:100,cooldownUntil:Date.now()+60000,tokensPerSec:null}:undefined,100).some(m=>m.id==='groq:code'));
});

