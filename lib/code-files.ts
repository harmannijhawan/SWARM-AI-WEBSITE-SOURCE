export type CodeFile = { name:string; language:string; content:string };
const extensions:Record<string,string> = {python:'py',javascript:'js',typescript:'ts',jsx:'jsx',tsx:'tsx',html:'html',css:'css',json:'json',bash:'sh',shell:'sh',powershell:'ps1',markdown:'md',yaml:'yml',sql:'sql',java:'java',rust:'rs',go:'go',cpp:'cpp',c:'c'};
export function codeFiles(text:string):CodeFile[] {
  const files:CodeFile[]=[]; const names=new Set<string>();
  for (const match of text.matchAll(/^[ \t]*```([^\r\n]*)\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)) {
    const info=match[1].trim(); const language=info.split(/\s+/)[0]||'text';
    const supplied=info.match(/(?:filename|file|path)\s*=\s*["']?([^\s"']+)/i)?.[1];
    const safe=supplied?.replace(/\\/g,'/').split('/').filter(part=>part&&part!=='.'&&part!=='..').map(part=>part.replace(/[^a-zA-Z0-9._-]/g,'_')).join('/');
    let name=safe || `swarm-code-${files.length+1}.${extensions[language]||'txt'}`;
    if(names.has(name))name=`${files.length+1}-${name}`;
    names.add(name);files.push({name,language,content:match[2]});
  }
  return files;
}
