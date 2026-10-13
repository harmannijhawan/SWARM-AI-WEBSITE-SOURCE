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
export type RouteHealth = { lastCheckedAt?:number; lastSuccessAt?:number; timeoutCount?:number; ttftMs?:number|null; failureCategory?:string|null; calls:number; successes:number; consecutiveFailures:number; latencyMs:number|null; cooldownUntil:number; tokensPerSec:number|null };
export type Routable = { id:string; modelId:string; providerId:string; capabilities?:Capability[]; contextLength?:number|null; freeStatus?:string };
export type Profile = 'recommended'|'best_coding'|'fast'|'free_first'|'custom';
export type RoutingPreferences = {ai?:{routing?:RoutingSettings['ai']['routing'];profile?:string;freeMode?:boolean;pinnedModel?:string|null};agents?:{modelPreference?:RoutingSettings['agents']['modelPreference']};routing?:{excluded?:string[];fallbacks?:string[]}};
/** Only these statuses count as verified free (spec §6 free_first). `unknown` never qualifies. */
export const VERIFIED_FREE = ['free','free_tier','local'];
/** Spec §6 roles: planner, coder, fast (classification), reviewer, summarizer. */
export function roleForPurpose(purpose?:Purpose):string|undefined {
  if(!purpose)return undefined;
  if(purpose==='code'||purpose==='test')return 'coder';
  if(purpose==='review')return 'reviewer';
  if(purpose==='classify')return 'fast';
  if(purpose==='summarize')return 'summarizer';
  if(purpose==='plan'||purpose==='architecture'||purpose==='design'||purpose==='research')return 'planner';
  return undefined;
}
function profileRouting(profile:string|undefined,fallback:RoutingSettings['ai']['routing']):RoutingSettings['ai']['routing'] {
  if(profile==='recommended'||profile==='best_coding')return 'quality';
  if(profile==='fast')return 'fastest';
  return fallback;
}
export function rankAutomatic<T extends Routable>(models:T[],text:string,health:(id:string)=>RouteHealth|undefined,promptTokens:number,stage?:Purpose,preferences?:RoutingPreferences) {
  const profile=preferences?.ai?.profile;
  const detected=stage||chatPurpose(text);
  // best_coding scores every request on coding capability first.
  const purpose:Purpose=profile==='best_coding'&&!['code','review','test','architecture'].includes(detected)?'code':detected;
  const settings:RoutingSettings={ai:{routing:profileRouting(profile,preferences?.ai?.routing||'auto')},agents:{modelPreference:preferences?.agents?.modelPreference||{}}};
  const freeOnly=profile==='free_first'||preferences?.ai?.freeMode===true;
  const legacyDefault=preferences?.ai?.freeMode===undefined&&!profile;
  const allowed=(m:T)=>freeOnly?VERIFIED_FREE.includes(m.freeStatus||'unknown'):legacyDefault?m.providerId!=='openai':true;
  const ranked=models.filter(m=>allowed(m)&&!preferences?.routing?.excluded?.includes(m.id)).map(model=>{
    const h=health(model.id);const contextLength=model.contextLength||32768;
    const input:RouteModel={...model,capabilities:model.capabilities||inferCapabilities(model.modelId),paramsB:estimateParamsB(model.modelId),calls:h?.calls||0,successes:h?.successes||0,consecutiveFailures:h?.consecutiveFailures||0,latencyMs:h?.latencyMs||null,tokensPerSec:h?.tokensPerSec||null,health:h?.successes?'healthy':'unknown',contextLength};
    return {model,score:scoreModel(input,{purpose,role:roleForPurpose(stage),pinned:preferences?.ai?.pinnedModel,promptTokens,maxTokens:4096},settings),eligible:contextLength>=promptTokens+1088&&(!h||h.cooldownUntil<Date.now())};
  }).filter(r=>r.eligible).sort((a,b)=>{
    if(settings.ai.routing==='fastest'){
      const ah=health(a.model.id),bh=health(b.model.id);
      const am=ah?.successes?(ah.ttftMs??ah.latencyMs):null,bm=bh?.successes?(bh.ttftMs??bh.latencyMs):null;
      if(am!=null&&bm!=null&&am!==bm)return am-bm;
      if(am!=null&&bm==null)return -1;if(bm!=null&&am==null)return 1;
    }
    return b.score-a.score;
  }).map(r=>r.model);
  if(profile==='custom'&&preferences?.routing?.fallbacks?.length){
    // User-ordered primary + fallbacks first, in the user's order; a role pin still wins for its stage.
    const order=preferences.routing.fallbacks;const role=roleForPurpose(stage);const pin=role?preferences?.agents?.modelPreference?.[role]:undefined;
    const listed=order.map(id=>ranked.find(m=>m.id===id)).filter((m):m is T=>!!m);
    const rest=ranked.filter(m=>!order.includes(m.id));
    const result=[...listed,...rest];
    const pinned=pin?result.findIndex(m=>m.id===pin):-1;
    if(pinned>0)result.unshift(...result.splice(pinned,1));
    return result;
  }
  return ranked;
}
