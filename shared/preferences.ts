// Portable account preferences. Credentials, executable paths and permissions are never accepted here.
export type Preferences = {ai?:{routing?:string;profile?:string;freeMode?:boolean;pinnedModel?:string|null;temperature?:number;maxOutputTokens?:number};routing?:{maxFallbacks?:number;excluded?:string[];fallbacks?:string[]};agents?:{modelPreference?:Record<string,string|null>};providers?:{enabled?:Record<string,boolean>};appearance?:{theme?:string;accent?:string;density?:string;animations?:boolean;reducedMotion?:string;fontScale?:number};onboarding?:{completedAt?:number|null;version?:number;skipped?:boolean}};
export function validatePreferences(input:unknown):Preferences {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid preferences.');
  const value=input as Record<string,any>;const result:Record<string,any>={};
  const choices:Record<string,string[]>={'ai.routing':['auto','local_first','cloud_first','fastest','quality'],'ai.profile':['recommended','best_coding','fast','free_first','custom'],'appearance.theme':['light','dark','system'],'appearance.accent':['graphite','blue','violet','green','amber','rose'],'appearance.density':['compact','comfortable','spacious'],'appearance.reducedMotion':['system','on','off']};
  const numbers:Record<string,number[]>={'ai.temperature':[0,1.5],'ai.maxOutputTokens':[512,32768],'routing.maxFallbacks':[0,12],'appearance.fontScale':[.85,1.25],'onboarding.version':[1,1000]};
  const integers=['maxFallbacks','maxOutputTokens','version'];
  const fields:Record<string,string[]>={ai:['routing','profile','freeMode','pinnedModel','temperature','maxOutputTokens'],routing:['maxFallbacks','excluded','fallbacks'],agents:['modelPreference'],providers:['enabled'],appearance:['theme','accent','density','animations','reducedMotion','fontScale'],onboarding:['completedAt','version','skipped']};
  // Model ids are "provider:model"; the provider part is a known slug, the model part is printable without whitespace.
  const modelId=(x:unknown)=>typeof x==='string'&&x.length<=200&&/^[a-z0-9_-]{1,50}:[^\s\x00-\x1f]{1,149}$/.test(x);
  for(const [section,part] of Object.entries(value)){
    if(!Object.hasOwn(fields,section)||!part||typeof part!=='object'||Array.isArray(part))throw new Error('Unsupported preference section.');
    result[section]={};
    for(const [key,v] of Object.entries(part)){
      if(!fields[section].includes(key))throw new Error('Unsupported preference.');
      const path=section+'.'+key;let valid=false;
      if(choices[path])valid=typeof v==='string'&&choices[path].includes(v);
      else if(numbers[path])valid=typeof v==='number'&&Number.isFinite(v)&&v>=numbers[path][0]&&v<=numbers[path][1]&&(!integers.includes(key)||Number.isInteger(v));
      else if(key==='freeMode'||key==='animations'||key==='skipped')valid=typeof v==='boolean';
      else if(key==='completedAt')valid=v===null||(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0);
      else if(key==='pinnedModel')valid=v===null||(typeof v==='string'&&v.length<=200);
      else if(key==='excluded')valid=Array.isArray(v)&&v.length<=500&&v.every(x=>typeof x==='string'&&x.length<=200);
      else if(key==='fallbacks')valid=Array.isArray(v)&&v.length<=20&&v.every(modelId)&&new Set(v).size===v.length;
      else if(key==='enabled'||key==='modelPreference')valid=!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.entries(v).length<=100&&Object.entries(v).every(([k,x])=>/^[a-z0-9_-]{1,50}$/.test(k)&&!['__proto__','constructor','prototype'].includes(k)&&(key==='enabled'?typeof x==='boolean':x===null||typeof x==='string'&&x.length<=200));
      if(!valid)throw new Error('Invalid '+path+'.');result[section][key]=v;
    }
  }
  return result;
}
