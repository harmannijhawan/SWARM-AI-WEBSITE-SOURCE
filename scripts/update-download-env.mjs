import {spawnSync} from 'node:child_process';
for(const name of ['SWARM_WINDOWS_DOWNLOAD_URL','SWARM_ANDROID_DOWNLOAD_URL']){const value=process.env[name];if(!value)throw Error('Missing '+name);const r=spawnSync(process.execPath,['C:/Users/user/AppData/Roaming/npm/node_modules/vercel/dist/index.js','env','add',name,'production','--force'],{input:value+'\n',encoding:'utf8'});console.log(name+': '+(r.status===0?'saved':'failed'));if(r.status!==0)throw Error('Environment update failed');}

