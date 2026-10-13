import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyHttp} from '../lib/server/desktop-providers/http';
import {openAICompatible} from '../lib/server/desktop-providers/openaiCompatible';
import {openrouter} from '../lib/server/desktop-providers/openrouter';

test('invalid Retry-After is not NaN; upstream secret bodies are withheld',()=>{
 const error=classifyHttp(429,'credential=do-not-expose',new Headers({'retry-after':'bad-date'}));
 assert.equal(error.kind,'rate_limit');assert.equal(error.retryAfterMs,60000);assert(!error.message.includes('do-not-expose'));
 assert.equal(classifyHttp(429,'insufficient_quota').kind,'quota');assert.equal(classifyHttp(403,'secret').kind,'auth');
});
test('model names cannot grant image/tool/JSON capabilities absent verified metadata',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({data:[{id:'qwen-vision-tools',context_window:8192}]}));
 const adapter=openAICompatible({id:'fixture',name:'fixture',baseUrl:'https://fixture.invalid',signupUrl:'',freeNotes:'',freeStatus:'unknown'});
 const models=await adapter.discover({apiKey:'fixture-key',accountId:null,baseUrl:adapter.defaultBaseUrl},new AbortController().signal);
 assert(!models[0].capabilities.includes('vision'));assert(!models[0].capabilities.includes('tools'));assert(!models[0].capabilities.includes('json'));assert.equal(models[0].contextLength,8192);
});
test('BYOK OpenRouter includes paid models with API-supplied capabilities',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({data:[{id:'fixture-paid',name:'Fixture',pricing:{prompt:'0.01',completion:'0.01'},context_length:32768,architecture:{input_modalities:['text','image'],output_modalities:['text']},supported_parameters:['response_format']}]}));
 const models=await openrouter.discover({apiKey:'fixture-key',accountId:null,baseUrl:openrouter.defaultBaseUrl},new AbortController().signal);
 assert.equal(models.length,1);assert.equal(models[0].freeStatus,'paid');assert(models[0].capabilities.includes('json'));assert(models[0].capabilities.includes('vision'));assert(!models[0].capabilities.includes('tools'));
});
