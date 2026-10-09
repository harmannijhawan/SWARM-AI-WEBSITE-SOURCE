import {createReadStream,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {Readable} from 'node:stream';

export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{file:string}>}) {
  const {file}=await params;
  const names:Record<string,string|undefined>={'SWARM-AI-Setup.exe':process.env.SWARM_WINDOWS_DOWNLOAD_URL,'SWARM-AI.apk':process.env.SWARM_ANDROID_DOWNLOAD_URL};
  if(!(file in names))return new Response('Download not found.',{status:404});
  const remote=names[file];
  if(remote){const url=new URL(remote);if(url.protocol==='https:'&&url.hostname.endsWith('.public.blob.vercel-storage.com'))return Response.redirect(url,302);}
  const path=join(process.cwd(),'.swarm-web','downloads',file);
  if(!existsSync(path))return new Response('Download is temporarily unavailable.',{status:503});
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${file}"`,'Content-Length':String(statSync(path).size),'Cache-Control':'no-store'}});
}
