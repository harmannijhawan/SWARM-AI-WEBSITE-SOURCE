import { useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { Check, Undo2 } from 'lucide-react';
import type { FileChange } from '../../shared/types';
import { ROLE_META } from './status';
import { Badge, Button, Segmented, cx } from './ui';
import { timeAgo } from '../lib/format';

interface Line { kind: 'add' | 'del' | 'ctx' | 'gap'; a: number | null; b: number | null; text: string }

function buildLines(before: string, after: string, context = 3): Line[] {
  const parts = diffLines(before, after);
  const all: Line[] = [];
  let a = 1, b = 1;
  for (const p of parts) {
    const lines = p.value.replace(/\n$/, '').split('\n');
    for (const l of lines) {
      if (p.added) all.push({ kind: 'add', a: null, b: b++, text: l });
      else if (p.removed) all.push({ kind: 'del', a: a++, b: null, text: l });
      else all.push({ kind: 'ctx', a: a++, b: b++, text: l });
    }
  }
  // Collapse long unchanged stretches.
  const keep = new Array(all.length).fill(false);
  all.forEach((l, i) => { if (l.kind !== 'ctx') for (let j = Math.max(0, i - context); j <= Math.min(all.length - 1, i + context); j++) keep[j] = true; });
  if (!all.some((l) => l.kind !== 'ctx')) return all.slice(0, 400);
  const out: Line[] = [];
  let skipped = 0;
  all.forEach((l, i) => {
    if (keep[i]) { if (skipped) { out.push({ kind: 'gap', a: null, b: null, text: `${skipped} unchanged lines` }); skipped = 0; } out.push(l); }
    else skipped++;
  });
  if (skipped) out.push({ kind: 'gap', a: null, b: null, text: `${skipped} unchanged lines` });
  return out;
}

export function DiffView({ change, onRevert, onAccept }: { change: FileChange; onRevert?: () => void; onAccept?: () => void }) {
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const before = change.before ?? '';
  const after = change.after ?? '';
  const lines = useMemo(() => buildLines(change.kind === 'deleted' ? before : before, change.kind === 'deleted' ? '' : after), [before, after, change.kind]);
  const tooLarge = (change.kind === 'modified' && (change.before === null || change.after === null));
  const who = change.agent === 'user' ? 'You' : change.agent ? ROLE_META[change.agent].name : 'Unknown';

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-line">
        <span className="mono text-[0.74rem] truncate">{change.path}</span>
        <Badge tone={change.kind === 'created' ? 'ok' : change.kind === 'deleted' ? 'err' : 'neutral'}>{change.kind}</Badge>
        <span className="text-[0.7rem] text-ok tabular">+{change.additions}</span>
        <span className="text-[0.7rem] text-err tabular">−{change.deletions}</span>
        <span className="text-[0.7rem] text-fg-3 truncate">{who} · {timeAgo(change.ts)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Segmented size="sm" value={mode} onChange={setMode} label="Diff layout" options={[{ value: 'unified', label: 'Unified' }, { value: 'split', label: 'Before / After' }]} />
          {change.status === 'reverted' ? <Badge>Reverted</Badge> : change.status === 'accepted' ? <Badge tone="ok">Accepted</Badge> : (
            <>
              {onAccept && <Button size="sm" variant="ghost" icon={Check} onClick={onAccept}>Accept</Button>}
              {onRevert && <Button size="sm" variant="secondary" icon={Undo2} onClick={onRevert}>Revert</Button>}
            </>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-sunken">
        {tooLarge ? <div className="p-4 text-[0.75rem] text-fg-3">File too large to snapshot; diff unavailable.</div> : mode === 'unified' ? (
          <table className="w-full mono text-[0.72rem] leading-[1.55] selectable">
            <tbody>
              {lines.map((l, i) => l.kind === 'gap' ? (
                <tr key={i}><td colSpan={3} className="px-3 py-1 text-fg-3 bg-hover/40 text-[0.68rem]">⋯ {l.text}</td></tr>
              ) : (
                <tr key={i} className={cx(l.kind === 'add' && 'bg-ok-soft', l.kind === 'del' && 'bg-err-soft')}>
                  <td className="w-10 text-right pr-2 text-fg-3 select-none tabular">{l.a ?? ''}</td>
                  <td className="w-10 text-right pr-2 text-fg-3 select-none tabular">{l.b ?? ''}</td>
                  <td className={cx('pr-4 whitespace-pre-wrap break-all', l.kind === 'add' ? 'text-ok' : l.kind === 'del' ? 'text-err' : 'text-fg-2')}><span className="select-none opacity-60 mr-1">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>{l.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-2 divide-x divide-line min-h-full">
            <pre className="p-3 mono text-[0.72rem] leading-[1.55] whitespace-pre-wrap break-all text-fg-2 selectable"><div className="text-[0.65rem] uppercase tracking-wider text-fg-3 mb-2 font-sans">Before</div>{change.before ?? '(new file)'}</pre>
            <pre className="p-3 mono text-[0.72rem] leading-[1.55] whitespace-pre-wrap break-all text-fg-2 selectable"><div className="text-[0.65rem] uppercase tracking-wider text-fg-3 mb-2 font-sans">After</div>{change.after ?? '(deleted)'}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
