'use client';
import { useState } from 'react';
import { FileCode2 } from 'lucide-react';
import { codeFiles } from '@/lib/code-files';
import { FileCard, ChatMarkdown } from './chat-markdown';
import { EmptyState } from './design-system';
export function GeneratedFiles({text}:{text:string}){
  const files=codeFiles(text);const [name,setName]=useState('');const active=files.find(f=>f.name===name)||files[0];
  if(!active)return <EmptyState icon={<FileCode2 size={24}/>} title="Your project files belong here" description="Generated files appear as your build produces code. You can inspect and download them individually or as a ZIP."/>;
  return <div className="sw-file-browser"><nav aria-label="Generated files">{files.map(f=><button key={f.name} aria-current={f.name===active.name} onClick={()=>setName(f.name)}><FileCode2 size={13}/>{f.name}</button>)}</nav><section><FileCard file={active} expanded><code>{active.content}</code></FileCard><details className="mt-4"><summary className="text-xs text-muted-foreground cursor-pointer">Full project & ZIP download</summary><ChatMarkdown text={text}/></details></section></div>;
}
