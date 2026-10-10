'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
export function ThemeButton(){
  const [dark,setDark]=useState(false);
  useEffect(()=>{const root=document.querySelector<HTMLElement>('.cloud-theme');if(!root)return;const saved=localStorage.getItem('swarm-theme');if(saved==='dark'||saved==='light')root.dataset.theme=saved;const update=()=>setDark(root.dataset.theme==='dark');update();const observer=new MutationObserver(update);observer.observe(root,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);
  return <button type="button" className="sw-theme-button" title={dark?'Switch to light mode':'Switch to dark mode'} aria-label={dark?'Switch to light mode':'Switch to dark mode'} aria-pressed={dark} onClick={()=>{const next=dark?'light':'dark';localStorage.setItem('swarm-theme',next);const root=document.querySelector<HTMLElement>('.cloud-theme');if(root)root.dataset.theme=next;window.dispatchEvent(new Event('swarm:theme'));setDark(!dark);}}>{dark?<Sun size={17}/>:<Moon size={17}/>}</button>;
}
