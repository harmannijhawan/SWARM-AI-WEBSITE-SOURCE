import { useState } from 'react';
import { api, type AccountStatus } from '../lib/api';
import { LogoWordmark } from '../components/Logo';
import './authentication.css';

export function Authentication({status,error:startupError}:{status:AccountStatus|null;error?:string}) {
  const [error,setError]=useState('');
  const [pending,setPending]=useState(false);
  async function connect(){setPending(true);setError('');try{await api.account.signIn('https://www.swarmgpt.online');}catch(e){setError(e instanceof Error?e.message:'Sign-in could not start.');}finally{setPending(false);}}
  async function retry(){setPending(true);setError('');try{await api.account.sync();}catch{setError('Could not check your session. Check your connection and retry.');}finally{setPending(false);}}
  return <main className="authentication"><div className="authentication-titlebar drag"/><LogoWordmark height={16}/><section className="authentication-card"><LogoWordmark height={30}/><h1>Welcome back</h1><p>Sign in to your SWARM workspace</p><p className="authentication-detail">Continue securely on the SWARM website using your Google or email account. Return here after connecting your desktop.</p><button disabled={pending||status?.connecting||status?.syncing} onClick={()=>void connect()}>{status?.connecting?'Continue in your browser…':status?.syncing?'Checking your session…':pending?'Opening sign-in…':'Continue'}</button><p className="authentication-detail">Don’t have an account? <button className="authentication-link" disabled={pending||status?.connecting} onClick={()=>void connect()}>Sign up on SWARM</button></p>{(error||startupError||status?.error)&&<p className="authentication-error" role="alert">{error||startupError||status?.error}</p>}<button className="authentication-link" disabled={pending||status?.syncing} onClick={()=>void retry()}>Retry session check</button><footer>ONE MISSION. MANY MINDS.</footer></section></main>;
}
