'use client';
import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useState } from 'react';

export function Button({ variant = 'secondary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {variant?:'primary'|'secondary'|'ghost';children:ReactNode}) {
  return <button className={`sw-button sw-button-${variant} ${className}`} {...props}>{children}</button>;
}
export function SectionHeader({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:ReactNode}) {
  return <header className="sw-section-header"><div>{eyebrow&&<span className="sw-eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</header>;
}
export function EmptyState({icon,title,description,action}:{icon:ReactNode;title:string;description:string;action?:ReactNode}) {
  return <div className="sw-empty"><span className="sw-empty-icon">{icon}</span><strong>{title}</strong><p>{description}</p>{action}</div>;
}
export function Status({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'success'|'warning'|'error'}) {return <span className={`sw-status sw-status-${tone}`}><i/>{children}</span>;}
export function Loading({label='Loading…'}:{label?:string}) {return <div role="status" className="sw-loading"><Loader2 size={16} className="sw-spin"/>{label}</div>;}
export function Toggle({label,description,checked,disabled,onChange}:{label:string;description?:string;checked:boolean;disabled?:boolean;onChange:(v:boolean)=>void}) {
  return <label className="sw-toggle-field"><span>{label}{description&&<small>{description}</small>}</span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><span className="sw-toggle-track" aria-hidden="true"/></label>;
}
export function CopyButton({text,label='Copy',testId}:{text:string;label?:string;testId?:string}) {
  const [copied,setCopied]=useState(false),[error,setError]=useState(false);
  return <button data-testid={testId} className="sw-copy" title={label} onClick={async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);setError(false);setTimeout(()=>setCopied(false),1800);}catch{setError(true);}}}>{copied?<Check size={13}/>:<Copy size={13}/>}<span role="status">{error?'Copy unavailable':copied?'Copied':label}</span></button>;
}
export function Usage({label,used,limit,unlimited}:{label:string;used?:number;limit?:number|null;unlimited?:boolean}) {
  const known=typeof used==='number'&&Number.isFinite(used)&&typeof limit==='number'&&limit>0;
  return <div className="sw-usage"><div><span>{label}</span><strong>{unlimited?'Unlimited':known?`${Math.max(0,limit!-used!)} remaining`:'Allowance unavailable'}</strong></div>{known&&<progress aria-label={`${label} used`} value={Math.min(used!,limit!)} max={limit!}/>}<small>{typeof used==='number'?`${used.toLocaleString()} used`: 'Usage unavailable'}{known?` of ${limit!.toLocaleString()}`:''}</small></div>;
}
