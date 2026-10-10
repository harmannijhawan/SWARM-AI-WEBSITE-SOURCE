export class ChatStreamError extends Error {
  constructor(message: string, public category = 'network', public retryable = true, public requestId?: string) { super(message); }
}

export function retryDisposition(messages: {id:number;role:string;requestId?:string;content:string}[],
  action: string, requestId?: string, messageId?: number): {type:'restore'|'complete'|'regenerate';messageId?:number} {
  const user=[...messages].reverse().find(m=>m.role==='user');
  if(!user||action==='continue'||(action==='send'?user.requestId!==requestId:user.id!==messageId))return {type:'restore'};
  const last=messages.at(-1);
  if(last?.role==='assistant'&&!last.content.endsWith('*Response stopped.*'))return {type:'complete'};
  return {type:'regenerate',messageId:user.id};
}

/** Consume through a terminal event, bounded by heartbeat inactivity and clean up on every exit. */
export async function consumeChatStream(body: ReadableStream<Uint8Array>, signal: AbortSignal,
  onEvent: (type: string, data: Record<string, unknown>) => void, idleMs = 60_000) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', completed = false, idleExpired = false;
  let timer: ReturnType<typeof setTimeout>;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const reset = () => { clearTimeout(timer); timer = setTimeout(() => { idleExpired = true; cancel(); }, idleMs); };
  signal.addEventListener('abort', cancel, {once:true});
  reset();
  try {
    if(signal.aborted) throw new ChatStreamError('Response stopped.', 'cancelled', false);
    while(!completed) {
      const {value,done} = await reader.read();
      if(signal.aborted) throw new ChatStreamError('Response stopped.', 'cancelled', false);
      if(idleExpired) throw new ChatStreamError('The connection stopped responding. Your message is saved.', 'timeout');
      reset();buffer += decoder.decode(value, {stream:!done});
      if(buffer.length>1_000_000)throw new ChatStreamError('The response stream is malformed.', 'invalid', false);
      const blocks=buffer.split(/\r?\n\r?\n/);buffer=blocks.pop()||'';
      if(done&&buffer.trim()){blocks.push(buffer);buffer='';}
      for(const block of blocks) {
        const lines=block.split(/\r?\n/);
        const raw=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(!raw)continue; // Includes heartbeat comments.
        let data:Record<string,unknown>;
        try { data=JSON.parse(raw); }catch { throw new ChatStreamError('The response stream is malformed.', 'invalid', false); }
        const type=lines.find(line=>line.startsWith('event:'))?.slice(6).trim() || String(data.type||'');
        if(type==='error')throw new ChatStreamError(typeof data.error==='string'?data.error:'The model request failed.',String(data.category||'server'),data.retryable===true,typeof data.requestId==='string'?data.requestId:undefined);
        onEvent(type,data);
        if(type==='done'){completed=true;break;}
      }
      if(done&&!completed)throw new ChatStreamError('The connection ended before the response completed. Your message is saved.');
    }
  } catch(error) {
    if(error instanceof ChatStreamError)throw error;
    throw new ChatStreamError('The connection was lost. Your message is saved; reconnect and try again.');
  } finally { clearTimeout(timer!);signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
