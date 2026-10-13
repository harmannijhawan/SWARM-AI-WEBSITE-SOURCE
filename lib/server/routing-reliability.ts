import { ProviderError } from './desktop-providers/types';
export function cooldownMs(error:unknown) {
 if(!(error instanceof ProviderError))return 15000;
 if(error.kind==='cancelled'||error.kind==='context'||error.kind==='bad_request')return 0;
 if(error.kind==='auth')return 3600000;
 if(error.kind==='not_found'||error.kind==='unsupported')return 300000;
 if(Number.isFinite(error.retryAfterMs))return Math.max(1000,error.retryAfterMs!);
 return error.kind==='quota'?300000:error.kind==='rate_limit'?60000:15000;
}
export function fallbackOrder<T extends {providerId:string}>(ranked:T[]) {
 const seen=new Set<string>();const first:T[]=[],rest:T[]=[];
 for(const model of ranked){if(seen.has(model.providerId))rest.push(model);else{seen.add(model.providerId);first.push(model);}}
 return [...first,...rest];
}
export function providerWideFailure(error:unknown){return error instanceof ProviderError&&['auth','quota','rate_limit','network'].includes(error.kind);}

export const DEFAULT_MAX_FALLBACKS=6;
export const MAX_RETRY_BACKOFF_MS=2000;
/** Spec §6: transient failures get exactly one bounded retry on the same model. */
export function retryDelayMs(error:unknown,random=Math.random):number|null {
 if(!(error instanceof ProviderError))return null;
 const jitter=Math.floor(random()*200);
 if(error.kind==='rate_limit'){
  // Only a short Retry-After is worth waiting for; longer limits move on to the next model.
  if(!Number.isFinite(error.retryAfterMs)||error.retryAfterMs!>MAX_RETRY_BACKOFF_MS)return null;
  return Math.min(MAX_RETRY_BACKOFF_MS,Math.max(0,error.retryAfterMs!)+jitter);
 }
 if(['timeout','server','network'].includes(error.kind))return Math.min(MAX_RETRY_BACKOFF_MS,300+jitter);
 return null;
}
const REASONS:Record<string,string>={rate_limit:'was rate limited',quota:'ran out of quota',auth:'rejected the API key',timeout:'timed out',server:'was temporarily unavailable',network:'could not be reached',not_found:'is no longer available',unsupported:'does not support this request',context:'could not fit the conversation',invalid:'returned an empty or invalid response'};
export function downgradeReason(error:unknown){return REASONS[error instanceof ProviderError?error.kind:'server']||'failed';}
/** User-visible notice. Names come from the provider catalog, never from model output. */
export function downgradeNotice(from:{displayName?:string;modelId:string;providerName?:string},to:{displayName?:string;modelId:string;providerName?:string},error:unknown){
 const label=(m:typeof from)=>`${m.displayName||m.modelId}${m.providerName?` (${m.providerName})`:''}`;
 return `Switched from ${label(from)} to ${label(to)} because ${from.displayName||from.modelId} ${downgradeReason(error)}.`;
}
export class FallbackStop extends Error { constructor(public cause:unknown){super('Fallback stopped');} }
type Candidate={id:string;modelId:string;providerId:string;displayName?:string;providerName?:string};
export type FallbackOptions<M extends Candidate,R>={
 candidates:M[];
 /** Number of additional models after the first (hard cap). */
 maxFallbacks:number;
 signal:AbortSignal;
 /** Reserve capacity for a model; null skips it without counting an attempt. */
 acquire:(model:M)=>Promise<null|(()=>Promise<void>)>;
 run:(model:M,retry:number)=>Promise<R>;
 /** Called once per model with the final outcome (after any retry). */
 record:(model:M,ok:boolean,resultOrError:unknown)=>Promise<void>;
 /** Called before a retry or before switching models after a failure. */
 onFailure?:(model:M,error:unknown,next:'retry'|'switch')=>void;
 onSwitch?:(from:M,to:M,error:unknown,notice:string)=>void;
 sleep?:(ms:number,signal:AbortSignal)=>Promise<void>;
 random?:()=>number;
};
const defaultSleep=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);const t=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);const stop=()=>{clearTimeout(t);reject(signal.reason);};signal.addEventListener('abort',stop,{once:true});});
/**
 * Ordered fallback chain (spec §6): transient → one bounded retry then next model;
 * auth/quota (and other provider-wide failures) → skip the provider for this request;
 * bad_request → stop without replay; context → never replay on the same model.
 */
export async function runFallbackChain<M extends Candidate,R>(o:FallbackOptions<M,R>):Promise<{result:R;model:M;attempts:number;notices:string[]}> {
 const skip=new Set<string>();const notices:string[]=[];let lastError:unknown;let lastFailed:M|undefined;let models=0,attempts=0;
 const sleep=o.sleep||defaultSleep;
 for(const model of o.candidates){
  if(skip.has(model.providerId))continue;
  if(models>o.maxFallbacks)break;
  o.signal.throwIfAborted();
  const release=await o.acquire(model);if(!release)continue;
  models++;
  try{
   if(lastFailed){const notice=downgradeNotice(lastFailed,model,lastError);notices.push(notice);o.onSwitch?.(lastFailed,model,lastError,notice);}
   for(let retry=0;;retry++){
    attempts++;
    try{const result=await o.run(model,retry);await o.record(model,true,result);return {result,model,attempts,notices};}
    catch(error){
     if(o.signal.aborted)throw error;
     lastError=error;
     const delay=retry===0?retryDelayMs(error,o.random):null;
     if(delay!==null){o.onFailure?.(model,error,'retry');await sleep(delay,o.signal);continue;}
     await o.record(model,false,error);
     if(error instanceof ProviderError&&['bad_request','cancelled'].includes(error.kind))throw new FallbackStop(error);
     if(providerWideFailure(error))skip.add(model.providerId);
     o.onFailure?.(model,error,'switch');
     lastFailed=model;
     break;
    }
   }
  }finally{await release();}
 }
 throw new FallbackStop(lastError||new ProviderError('invalid','No eligible model is currently available.'));
}
