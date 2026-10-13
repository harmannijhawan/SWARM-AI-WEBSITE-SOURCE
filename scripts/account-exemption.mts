import {createClerkClient} from '@clerk/backend';
import {Storage} from '../lib/server/storage';
import {managedTables,accountUsage} from '../lib/server/entitlements';
const users=await createClerkClient({secretKey:process.env.CLERK_SECRET_KEY}).users.getUserList({emailAddress:['harmanminecraft490@gmail.com']});
if(users.data.length!==1)throw Error('Expected one matching account');
const owner=users.data[0].id;
for(const url of [undefined,process.env.SWARM_DATABASE_URL].filter((v,i)=>i===0||v)){
 const db=new Storage('.swarm-web/chat.sqlite',url);await managedTables(db);
 await db.prepare('INSERT OR IGNORE INTO unlimited_accounts VALUES(?)').run(owner);
 const u=await accountUsage(db,owner);console.log(JSON.stringify({storage:url?'cloud':'local',email:'harmanminecraft490@gmail.com',unlimited:u.unlimited,builds:u.builds.limit,chats:u.chats.limit}));await db.close();
}
