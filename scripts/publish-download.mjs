import {put} from 'file:///C:/Users/user/AppData/Roaming/npm/node_modules/vercel/node_modules/@vercel/blob/dist/index.js';
import {createReadStream,readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
const kind=process.argv[2];const name=kind==='windows'?'SWARM-AI-Setup.exe':'SWARM-AI.apk';const file=kind==='windows'?'apps/native/release/SWARM-AI-Setup-1.0.3.exe':'apps/native/app/build/outputs/apk/debug/app-debug.apk';
const result=await put('downloads/v1.0.3/'+name,createReadStream(file),{access:'public',addRandomSuffix:false,allowOverwrite:true,multipart:true,contentType:kind==='windows'?'application/octet-stream':'application/vnd.android.package-archive'});
const variable=kind==='windows'?'SWARM_WINDOWS_DOWNLOAD_URL':'SWARM_ANDROID_DOWNLOAD_URL';let s=readFileSync('.env.local','utf8').replace(new RegExp('^'+variable+'=.*$','m'),variable+'='+result.url);writeFileSync('.env.local',s);mkdirSync('.swarm-web/downloads',{recursive:true});copyFileSync(file,'.swarm-web/downloads/'+name);console.log(variable+'='+result.url);

