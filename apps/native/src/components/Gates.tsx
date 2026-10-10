import { Check, Minus, X } from 'lucide-react';
import type { QualityGate } from '../../shared/types';
import { Spinner, cx } from './ui';

export function GateChips({ gates }: { gates: QualityGate[] }) {
  if (!gates.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Quality gates">
      {gates.map((g) => (
        <span data-motion-state={g.status} key={g.id} title={`${g.label}: ${g.status}${g.detail ? ` — ${g.detail}` : ''}${g.attempt > 1 ? ` (attempt ${g.attempt})` : ''}`}
          className={cx('inline-flex items-center gap-1 h-6 pl-1.5 pr-2 rounded-md border text-[0.68rem] font-medium',
            g.status === 'passed' ? 'border-transparent bg-ok-soft text-ok' : g.status === 'failed' ? 'border-transparent bg-err-soft text-err' : g.status === 'running' ? 'border-accent/40 text-accent' : 'border-line text-fg-3')}>
          {g.status === 'passed' ? <Check size={11} strokeWidth={2.4} /> : g.status === 'failed' ? <X size={11} strokeWidth={2.4} /> : g.status === 'running' ? <Spinner size={9} /> : <Minus size={11} />}
          {g.label}
        </span>
      ))}
    </div>
  );
}

export function GateTable({ gates }: { gates: QualityGate[] }) {
  return (
    <div className="divide-y divide-line">
      {gates.map((g) => (
        <div data-motion-state={g.status} key={g.id} className="flex items-start gap-2.5 py-2">
          <span className={cx('motion-gate mt-0.5 h-4 w-4 rounded-full flex items-center justify-center shrink-0', g.status === 'passed' ? 'bg-ok text-white' : g.status === 'failed' ? 'bg-err text-white' : g.status === 'running' ? 'text-accent' : 'bg-sunken text-fg-3 border border-line')}>
            {g.status === 'passed' ? <Check size={10} strokeWidth={3} /> : g.status === 'failed' ? <X size={10} strokeWidth={3} /> : g.status === 'running' ? <Spinner size={10} /> : <Minus size={9} />}
          </span>
          <div className="min-w-0">
            <div className="text-[0.78rem] font-medium">{g.label}{g.attempt > 1 && <span className="text-fg-3 font-normal"> · attempt {g.attempt}</span>}</div>
            {g.detail && <div className="text-[0.7rem] text-fg-3 break-words selectable">{g.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
