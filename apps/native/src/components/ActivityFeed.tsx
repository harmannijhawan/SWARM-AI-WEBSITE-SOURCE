import { memo, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, Info, RotateCcw, XCircle } from 'lucide-react';
import type { EventType, SwarmEvent } from '../../shared/types';
import { clock } from '../lib/format';
import { ROLE_META } from './status';
import { cx } from './ui';

// Event types shown in the simple (user-facing) view.
const SIMPLE: EventType[] = [
  'RUN_STARTED', 'RUN_COMPLETED', 'RUN_FAILED', 'RUN_CANCELLED', 'TASK_STARTED', 'TASK_COMPLETED', 'TASK_FAILED', 'AGENT_MESSAGE',
  'MODEL_FALLBACK', 'WEB_SEARCH', 'SOURCE_FOUND', 'FILE_CREATED', 'FILE_MODIFIED', 'FILE_DELETED', 'COMMAND_STARTED', 'COMMAND_COMPLETED',
  'COMMAND_DENIED', 'APPROVAL_REQUIRED', 'APPROVAL_RESOLVED', 'BROWSER_OPENED', 'SCREENSHOT_CAPTURED', 'TEST_PASSED', 'TEST_FAILED', 'TEST_SKIPPED',
  'VISUAL_ISSUE_FOUND', 'PATCH_APPLIED', 'REPAIR_STARTED', 'GRAPH_UPDATED', 'GRAPH_VERSION_CREATED', 'RUN_PAUSED', 'RUN_RESUMED', 'TASK_UPDATED', 'MODEL_SELECTED',
];

export function filterEvents(events: SwarmEvent[], mode: 'simple' | 'detailed', agent?: string | null) {
  return events.filter((e) => {
    if (e.type === 'AGENT_STREAM' || e.type === 'COMMAND_OUTPUT' || e.type === 'AGENT_STATUS' || e.type === 'TASK_CREATED') return false;
    if (agent && e.agent !== agent) return false;
    if (mode === 'detailed') return true;
    if (e.level === 'debug') return false;
    if (e.type === 'TASK_UPDATED' && e.level === 'info') return false;
    return SIMPLE.includes(e.type);
  });
}

const levelIcon = (e: SwarmEvent) => {
  if (e.type === 'MODEL_FALLBACK') return <RotateCcw size={12} className="text-warn" />;
  if (e.type === 'AGENT_MESSAGE') return <ArrowRight size={12} className="text-fg-3" />;
  switch (e.level) {
    case 'success': return <CheckCircle2 size={12} className="text-ok" />;
    case 'warning': return <AlertTriangle size={12} className="text-warn" />;
    case 'error': return <XCircle size={12} className="text-err" />;
    case 'debug': return <CircleDot size={12} className="text-fg-3" />;
    default: return <Info size={12} className="text-fg-3" />;
  }
};

function describe(e: SwarmEvent): string {
  if (e.type === 'MODEL_FALLBACK') return `Recovered automatically — ${e.message.replace(/^Recovered automatically: /, '')}`;
  if (e.type === 'AGENT_MESSAGE') {
    const to = (e.data?.message as { to?: string } | undefined)?.to;
    return `${to && to !== 'all' ? `→ ${ROLE_META[to as keyof typeof ROLE_META]?.name ?? to}: ` : ''}${e.message}`;
  }
  return e.message;
}

export const ActivityFeed = memo(function ActivityFeed({ events, mode, showTime = true, agent, onSelect }: { events: SwarmEvent[]; mode: 'simple' | 'detailed'; showTime?: boolean; agent?: string | null; onSelect?: (e: SwarmEvent) => void }) {
  const list = useMemo(() => filterEvents(events, mode, agent), [events, mode, agent]);
  const mountedAt = useRef(Date.now());
  const parentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const v = useVirtualizer({ count: list.length, getScrollElement: () => parentRef.current, estimateSize: () => 30, overscan: 12 });

  useEffect(() => {
    if (stick.current && list.length) v.scrollToIndex(list.length - 1, { align: 'end' });
  }, [list.length, v]);

  if (!list.length) return <div className="h-full flex items-center justify-center text-[0.75rem] text-fg-3">No activity yet</div>;

  return (
    <div ref={parentRef} className="h-full overflow-y-auto" role="log" aria-live="polite" aria-label="Activity"
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((item) => {
          const e = list[item.index];
          const M = e.agent ? ROLE_META[e.agent] : null;
          return (
            <div key={e.id} data-index={item.index} ref={v.measureElement} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}>
              <button onClick={() => onSelect?.(e)} className={cx(e.ts >= mountedAt.current && Date.now() - e.ts < 1000 && 'motion-arrive', 'w-full text-left flex items-start gap-2.5 px-3 py-[5px] hover:bg-hover/60 rounded-md', e.level === 'error' && 'text-err')}>
                {showTime && <span className="mono text-[0.68rem] text-fg-3 pt-[1px] tabular shrink-0">{clock(e.ts)}</span>}
                <span className="pt-[3px] shrink-0">{levelIcon(e)}</span>
                {M ? <span className="text-[0.74rem] font-medium text-fg shrink-0 w-[74px] truncate pt-[1px]">{M.name}</span> : <span className="text-[0.74rem] font-medium text-fg-2 shrink-0 w-[74px] pt-[1px]">SWARM</span>}
                <span className={cx('text-[0.76rem] leading-[1.45] min-w-0 break-words selectable', e.level === 'error' ? 'text-err' : e.level === 'debug' ? 'text-fg-3' : 'text-fg-2')}>{describe(e)}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});
