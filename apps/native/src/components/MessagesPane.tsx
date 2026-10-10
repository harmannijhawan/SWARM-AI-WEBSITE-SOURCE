import { useEffect, useRef } from 'react';
import { MessagesSquare } from 'lucide-react';
import type { AgentMessage } from '../../shared/types';
import { clock } from '../lib/format';
import { ROLE_META } from './status';
import { Empty } from './ui';

export function MessagesPane({ messages }: { messages: AgentMessage[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [messages.length]);
  if (!messages.length) return <Empty icon={MessagesSquare} title="No agent messages yet" body="Agents exchange structured messages as they hand work to each other." />;
  return (
    <div ref={ref} className="h-full overflow-y-auto px-4 py-3 space-y-3">
      {messages.map((m) => {
        const From = ROLE_META[m.from];
        return (
          <div key={m.id} className="flex gap-2.5 anim-fade">
            <span className="h-7 w-7 shrink-0 rounded-lg border border-line flex items-center justify-center text-fg-2"><From.icon size={13} /></span>
            <div className="min-w-0">
              <div className="text-[0.7rem] text-fg-3"><span className="text-fg font-medium">{From.name}</span> → {m.to === 'all' ? 'Team' : ROLE_META[m.to].name} · <span className="tabular">{clock(m.ts)}</span></div>
              <div className="mt-0.5 text-[0.8rem] leading-relaxed text-fg-2 selectable">{m.content}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
