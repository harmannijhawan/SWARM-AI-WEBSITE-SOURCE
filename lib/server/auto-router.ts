// Pure scoring and purpose detection adapted from SWARM desktop router/router.ts and chat/router.ts.
import type { Capability } from './desktop-providers/domain-types';
import { inferCapabilities, estimateParamsB } from './desktop-providers/heuristics';
import {scoreModel,type RouteModel,type RoutingSettings,type Purpose} from './desktop-providers/model-score';
export {scoreModel} from './desktop-providers/model-score';
export type {Purpose} from './desktop-providers/model-score';
export function chatPurpose(text: string): Purpose {
  if (/research|latest|current|sources/i.test(text)) return 'research';
  if (/architect|trade.?off|prove|complex|reason step|distributed/i.test(text)) return 'architecture';
  if (/code|function|python|javascript|typescript|debug|error|async|scraper|```/i.test(text)) return 'code';
  if (text.length > 1500) return 'plan';
  return 'classify';
}


export type RouteHealth = { calls:number; successes:number; consecutiveFailures:number; latencyMs:number|null; cooldownUntil:number; tokensPerSec:number|null };
export type Routable = { id:string; modelId:string; providerId:string; capabilities?:Capability[]; contextLength?:number|null };
export function rankAutomatic<T extends Routable>(models:T[],text:string,health:(id:string)=>RouteHealth|undefined,promptTokens:number,stage?:Purpose,preferences?:{ai?:{routing?:RoutingSettings['ai']['routing'];freeMode?:boolean;pinnedModel?:string|null};agents?:{modelPreference?:RoutingSettings['agents']['modelPreference']};routing?:{excluded?:string[]}}) {
  const purpose=stage||chatPurpose(text);
  const settings:RoutingSettings={ai:{routing:preferences?.ai?.routing||'auto'},agents:{modelPreference:preferences?.agents?.modelPreference||{}}};
  return models.filter(m=>(preferences?.ai?.freeMode===false||m.providerId!=='openai')&&!preferences?.routing?.excluded?.includes(m.id)).map(model=>{
    const h=health(model.id);const contextLength=model.contextLength||32768;
    const input:RouteModel={...model,capabilities:model.capabilities||inferCapabilities(model.modelId),paramsB:estimateParamsB(model.modelId),calls:h?.calls||0,successes:h?.successes||0,consecutiveFailures:h?.consecutiveFailures||0,latencyMs:h?.latencyMs||null,tokensPerSec:h?.tokensPerSec||null,health:h?.successes?'healthy':'unknown',contextLength};
    return {model,score:scoreModel(input,{purpose,role:stage==='code'?'coder':stage==='review'?'reviewer':stage==='plan'?'planner':undefined,pinned:preferences?.ai?.pinnedModel,promptTokens,maxTokens:4096},settings),eligible:contextLength>=promptTokens+1088&&(!h||h.cooldownUntil<Date.now())};
  }).filter(r=>r.eligible).sort((a,b)=>b.score-a.score).map(r=>r.model);
}
