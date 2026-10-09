'use client';
import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { zipSync, strToU8 } from 'fflate';
import { Download, FileCode2 } from 'lucide-react';
import { codeFiles, type CodeFile } from '@/lib/code-files';
function plain(n:ReactNode):string {return Children.toArray(n).map(x=>isValidElement<{children?:ReactNode}>(x)?plain(x.props.children):String(x)).join('');}
function download(data:BlobPart,name:string,type='text/plain') {
  const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function FileCard({file,children}:{file:CodeFile;children:ReactNode}) {
  return <div className="cloud-code-card my-4 overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center gap-3 px-4 py-3"><FileCode2 size={18}/><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{file.name}</strong><span className="text-[10px] text-muted-foreground">{file.language} · {new TextEncoder().encode(file.content).length.toLocaleString()} bytes</span></div><button onClick={()=>download(file.content,file.name.split('/').at(-1)!)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-white"><Download size={13}/>Download</button></div><details className="border-t border-border"><summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground">Preview code</summary><pre>{children}</pre></details></div>;
}
export function ChatMarkdown({text}:{text:string}) {
  const files=codeFiles(text);
  return <div className="cloud-markdown">{files.length>0&&<button className="mb-3 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold" onClick={()=>{const zip=zipSync(Object.fromEntries(files.map(file=>[file.name,strToU8(file.content)])));download(new Uint8Array(zip).buffer,'swarm-code.zip','application/zip');}}><Download size={14}/>Download {files.length>1?'all files':'project'} (.zip)</button>}<ReactMarkdown remarkPlugins={[remarkGfm]} components={{pre:({children})=>{const content=plain(children);const file=files.find(f=>f.content.trimEnd()===content.trimEnd())||{name:'swarm-code.txt',language:'text',content};return <FileCard file={file}>{children}</FileCard>;},a:({href,children})=><a href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a>}}>{text}</ReactMarkdown></div>;
}
