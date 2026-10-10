import {DatabaseSync} from 'node:sqlite';
import {Pool,type PoolClient} from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
const tables:Record<string,{columns:string[];key:string[]}>= {
  entitlements:{columns:['owner','created','pro_until','profile','speed'],key:['owner']},
  usage_ledger:{columns:['owner','id','kind','period','state','fingerprint','created'],key:['owner','id']},
  payment_orders:{columns:['id','owner','request_key','amount','days','status','session','payment','created','fulfilled'],key:['id']},
  payment_events:{columns:['id','order_id','created'],key:['id']},
  active_runs:{columns:['owner','id','lease','expires'],key:['owner','id']},
  conversations:{columns:['id','owner','data'],key:['id']},credentials:{columns:['owner','provider','data'],key:['owner','provider']},
  accounts:{columns:['id','email','role'],key:['id']},device_sessions:{columns:['hash','owner','name','expires'],key:['hash']},
  device_grants:{columns:['code','owner','challenge','expires'],key:['code']},sync_deleted:{columns:['owner','id'],key:['owner','id']},
  account_documents:{columns:['owner','id','data'],key:['owner','id']},routing_health:{columns:['owner','id','data'],key:['owner','id']},
};
export function postgresSql(sql:string) {
  sql=sql.replace(/PRAGMA[^;]*;/g,'').replace(/BEGIN IMMEDIATE/g,'BEGIN').replace(/\bINTEGER\b/g,'BIGINT');
  sql=sql.replace(/INSERT OR REPLACE INTO (\w+)(\([^)]*\))? (VALUES\([^)]*\))/gi,(_,table:string,cols:string|undefined,values:string)=>{
    const info=tables[table];if(!info)throw new Error('Unknown storage table.');const names=cols?cols.slice(1,-1).split(',').map(c=>c.trim()):info.columns;
    return `INSERT INTO ${table}(${names.join(',')}) ${values} ON CONFLICT(${info.key.join(',')}) DO UPDATE SET ${names.filter(c=>!info.key.includes(c)).map(c=>`${c}=excluded.${c}`).join(',')}`;
  });
  sql=sql.replace(/INSERT OR IGNORE INTO (\w+)(\([^)]*\))? (VALUES\([^)]*\))/gi,'INSERT INTO $1$2 $3 ON CONFLICT DO NOTHING');
  sql=sql.replace(/WHERE owner=excluded.owner/g,'WHERE conversations.owner=excluded.owner');
  for(const table of Object.keys(tables))sql=sql.replace(new RegExp('\\b'+table+'\\b','g'),'swarm_'+table);
  let index=0;return sql.replace(/\?/g,()=>'$'+(++index));
}
type Session={client?:PoolClient;release?:()=>void};
const context=new AsyncLocalStorage<Session>();
export async function storageContext<T>(fn:()=>Promise<T>):Promise<T>{return context.run({},async()=>{try{return await fn();}finally{const s=context.getStore();if(s?.client){await s.client.query('ROLLBACK').catch(()=>{});s.client.release();}if(s?.release)s.release();}});}
export class Storage {
  private local?:DatabaseSync;private pool?:Pool;private ready:Promise<unknown>=Promise.resolve();private queue=Promise.resolve();
  constructor(file:string,url?:string){if(url){const address=new URL(url);if(['prefer','require','verify-ca'].includes(address.searchParams.get('sslmode')||''))address.searchParams.set('sslmode','verify-full');this.pool=new Pool({connectionString:address.href,max:4,idleTimeoutMillis:20000,connectionTimeoutMillis:15000});}else this.local=new DatabaseSync(file);}
  initialize(sql:string){this.ready=this.execute(sql,[]);return this.ready;}
  async close(){this.local?.close();await this.pool?.end();}
  private async lock(){let release!:()=>void;const next=new Promise<void>(resolve=>release=resolve);const previous=this.queue;this.queue=previous.then(()=>next);await previous;return release;}
  private async execute(sql:string,params:any[]) {
    if(this.pool){const client=context.getStore()?.client||this.pool;const result=await client.query(postgresSql(sql),params);return {rows:Array.isArray(result)?[]:result.rows,changes:Array.isArray(result)?0:result.rowCount||0};}
    if(params.length||/^\s*(SELECT|INSERT|UPDATE|DELETE)/i.test(sql)&&!sql.includes(';')) {const statement=this.local!.prepare(sql);if(/^\s*SELECT/i.test(sql)||/RETURNING/i.test(sql))return {rows:statement.all(...params),changes:0};const result=statement.run(...params);return {rows:[],changes:Number(result.changes)};}
    this.local!.exec(sql);return {rows:[],changes:0};
  }
  async exec(sql:string){await this.ready;const session=context.getStore();
    if(/^BEGIN/.test(sql)){if(!session)throw new Error('Transactions require a storage context.');if(this.pool){session.client=await this.pool.connect();await session.client.query('BEGIN');}else{session.release=await this.lock();await this.execute(sql,[]);}return;}
    if(/^(COMMIT|ROLLBACK)$/.test(sql)){try{await this.execute(sql,[]);}finally{session?.client?.release();if(session)session.client=undefined;session?.release?.();if(session)session.release=undefined;}return;}
    await this.query(sql,[]);
  }
  async lockOwner(owner:string){if(this.pool)await this.query('SELECT pg_advisory_xact_lock(hashtext(?))',[owner]);}
  private async query(sql:string,params:any[]){await this.ready;if(this.pool||context.getStore()?.release)return this.execute(sql,params);const release=await this.lock();try{return await this.execute(sql,params);}finally{release();}}
  prepare(sql:string){return {all:async(...params:any[])=>(await this.query(sql,params)).rows,get:async(...params:any[])=>(await this.query(sql,params)).rows[0],run:async(...params:any[])=>({changes:(await this.query(sql,params)).changes})};}
}
