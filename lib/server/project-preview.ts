import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {posix} from 'node:path';
import type {CodeFile} from '../code-files';
const require=createRequire(import.meta.url);
const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
const escapeScript=(s:string)=>s.replace(/<\/script/gi,'<\\/script');
const escapeStyle=(s:string)=>s.replace(/<\/style/gi,'<\\/style');
/** Compile generated front-end files without executing them on the host. */
export async function projectPreview(files:CodeFile[]):Promise<{html:string;entry:string}> {
  if(files.length>100||files.reduce((n,f)=>n+f.content.length,0)>4000000)throw new Error('Project is too large for an inline preview.');
  const source=new Map(files.map(f=>[f.name,f.content]));
  const htmlEntry=files.find(f=>/(^|\/)index\.html$/i.test(f.name))||files.find(f=>/\.html$/i.test(f.name));
  let html=htmlEntry?.content||'<html><head></head><body><div id="root"></div></body></html>';
  const scripts:string[]=[];
  if(htmlEntry){html=html.replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi,(tag,path:string)=>{
    if(/^(https?:|\/\/|data:)/.test(path))return tag;
    const id=posix.normalize(posix.join(posix.dirname(htmlEntry.name),path.replace(/^\//,'')));if(!source.has(id))throw new Error('A script referenced by the HTML was not generated.');scripts.push(id);return '';
  }).replace(/<link\b[^>]*>/gi,(tag:string)=>{const href=tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];if(!href||/^(https?:|\/\/|data:)/.test(href)||!/rel\s*=\s*["']stylesheet["']/i.test(tag))return tag;const id=posix.normalize(posix.join(posix.dirname(htmlEntry.name),href.replace(/^\//,'')));if(!source.has(id))throw new Error('A stylesheet referenced by the HTML was not generated.');return '<style>'+escapeStyle(source.get(id)!)+'</style>';});}
  let entry=scripts[0]||files.find(f=>/(^|\/)(main|index)\.[jt]sx?$/.test(f.name))?.name;
  let contents=scripts.length?scripts.map(s=>'import '+JSON.stringify('./'+s)+';').join('\n'):entry?'import '+JSON.stringify('./'+entry)+';':'';
  if(!contents&&!htmlEntry){const app=files.find(f=>/(^|\/)App\.[jt]sx?$/.test(f.name));if(!app)throw new Error('This project has no browser entry point. Download it and run it in the desktop app.');entry=app.name;contents=`import React from 'react';import {createRoot} from 'react-dom/client';import App from ${JSON.stringify('./'+app.name)};createRoot(document.getElementById('root')).render(React.createElement(App));`;}
  if(contents){
    const result=await build({stdin:{contents,sourcefile:'preview-entry.tsx',resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'preview',platform:'browser',format:'iife',jsx:'automatic',logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'generated-project',setup(b){
      b.onResolve({filter:/.*/},args=>{
        if(args.namespace==='file'&&args.importer.includes('node_modules'))return undefined;
        if(args.path.startsWith('.')) {const base=args.namespace==='project'?posix.dirname(args.importer):'';const target=posix.normalize(posix.join(base,args.path));const found=[target,...['.tsx','.ts','.jsx','.js','.json','.css','/index.tsx','/index.ts','/index.jsx','/index.js'].map(ext=>target+ext)].find(id=>source.has(id));if(!found)throw new Error('A project import is missing.');return {path:found,namespace:'project'};}
        if(['react','react-dom','lucide-react'].some(p=>args.path===p||args.path.startsWith(p+'/')))return {path:require.resolve(args.path)};
        throw new Error('This preview requires a dependency that is not installed. Download the ZIP to run the complete project.');
      });
      b.onLoad({filter:/.*/,namespace:'project'},args=>({contents:source.get(args.path)!,loader:args.path.endsWith('.css')?'css':args.path.endsWith('.json')?'json':args.path.endsWith('.tsx')?'tsx':args.path.endsWith('.ts')?'ts':args.path.endsWith('.jsx')?'jsx':'js'}));
    }}]});
    const js=result.outputFiles.filter(f=>f.path.endsWith('.js')).map(f=>f.text).join('\n');const css=result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
    html=html.replace(/<\/body>/i,'<style>'+escapeStyle(css)+'</style><script>'+escapeScript(js)+'</script></body>');if(!/<\/body>/i.test(html))html+='<style>'+escapeStyle(css)+'</style><script>'+escapeScript(js)+'</script>';
  }
  const policy='<meta http-equiv="Content-Security-Policy" content="'+csp+'"><meta name="viewport" content="width=device-width, initial-scale=1">';
  html=/<head\b[^>]*>/i.test(html)?html.replace(/<head\b[^>]*>/i,tag=>tag+policy):'<head>'+policy+'</head>'+html;
  return {html,entry:htmlEntry?.name||entry||'index.html'};
}
