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
export function providerWideFailure(error:unknown){return error instanceof ProviderError&&['auth','quota','rate_limit'].includes(error.kind);}
