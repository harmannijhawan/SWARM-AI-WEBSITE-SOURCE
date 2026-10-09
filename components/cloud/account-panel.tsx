'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
export function DesktopConnect(){
  const {getToken}=useAuth();const [error,setError]=useState(''),[pending,setPending]=useState(false);
  async function connect(){setPending(true);setError('');try{const params=new URLSearchParams(location.search);const response=await fetch('/api/account/desktop-authorizations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await getToken()},body:JSON.stringify({challenge:params.get('challenge'),callback:params.get('callback'),state:params.get('state')})});const data=await response.json();if(!response.ok)throw new Error(data.error);location.assign(data.callback);}catch(e){setError(e instanceof Error?e.message:'Connection failed.');setPending(false);}}
  return <div className="desktop-login"><div className="desktop-login-card"><img src="/brand/swarm-wordmark.png" width="110" alt="SWARM"/><h1>Connect your desktop</h1><p>Sync this account’s chats and provider keys with SWARM on your computer.</p><button className="desktop-login-guest" disabled={pending} onClick={()=>void connect()}>{pending?'Connecting…':'Connect SWARM desktop'}</button>{error&&<p role="alert">{error}</p>}</div></div>;
}
export function AccountPanel(){
  const {getToken}=useAuth();const [account,setAccount]=useState<{email:string|null;role:string}|null>(null),[devices,setDevices]=useState<{id:string;name:string;expires:number}[]>([]),[error,setError]=useState('');
  async function call(path:string,body?:unknown){const r=await fetch('/api/account/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await getToken(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
  async function load(){try{setAccount(await call('profile'));setDevices((await call('devices')).devices);}catch(e){setError(e instanceof Error?e.message:'Account could not load.');}}
  useEffect(()=>{void load();},[]);
  return <section className="rounded-xl border border-border bg-card p-5 space-y-3 mb-6"><h2 className="font-semibold">Account & sync</h2><p className="text-sm">{account?.email||'Your SWARM account'} {account?.role==='owner'&&<span className="ml-2 text-xs text-blue-600">Owner · Administrator</span>}</p><p className="text-xs text-muted-foreground">Your chats and provider settings belong to this account. Sign in from the desktop’s Account settings to sync them.</p>{devices.map(d=><div key={d.id} className="flex justify-between items-center text-sm"><span>{d.name}</span><button className="text-blue-600" onClick={()=>void call('revoke',{id:d.id}).then(load).catch(e=>setError(e.message))}>Disconnect</button></div>)}{!devices.length&&<p className="text-xs text-muted-foreground">No connected desktop devices.</p>}{error&&<p role="alert">{error}</p>}</section>;
}
