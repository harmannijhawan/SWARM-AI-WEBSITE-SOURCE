import { ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { ROLE_META } from './status';
import { Badge, Button } from './ui';

export function ApprovalDialog() {
  const approvals = useStore((s) => s.approvals);
  const a = approvals[0];
  if (!a) return null;
  const resolve = (ok: boolean, always = false) => api.approvals.resolve(a.id, ok, always);
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[75] w-[560px] max-w-[92vw] anim-pop" role="alertdialog" aria-label="Approval required">
      <div className="rounded-2xl border border-line-strong bg-raised shadow-float p-4">
        <div className="flex items-start gap-3">
          <span className="h-9 w-9 rounded-xl bg-warn-soft text-warn flex items-center justify-center shrink-0"><ShieldAlert size={17} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[0.85rem] font-semibold">Approval required</span>
              <Badge tone={a.risk === 'high' ? 'err' : a.risk === 'medium' ? 'warn' : 'neutral'}>{a.risk} risk</Badge>
              {approvals.length > 1 && <span className="text-[0.7rem] text-fg-3">+{approvals.length - 1} more</span>}
            </div>
            <div className="text-[0.76rem] text-fg-2 mt-0.5">{a.agent ? `${ROLE_META[a.agent].name} wants to ` : 'SWARM wants to '}{a.kind === 'computer' ? 'interact with an application' : a.kind === 'install' ? 'install dependencies' : a.kind === 'fs_delete' ? 'delete a file' : a.kind === 'network' ? 'access the network' : 'run a command'}:</div>
            <pre className="mt-2 mono text-[0.72rem] bg-sunken border border-line rounded-lg px-3 py-2 whitespace-pre-wrap break-all selectable">{a.detail}</pre>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => resolve(false)}>Deny</Button>
          {a.kind !== 'computer' && <Button variant="secondary" onClick={() => resolve(true, true)}>Allow for this task</Button>}
          <Button variant="primary" autoFocus onClick={() => resolve(true)}>Allow once</Button>
        </div>
      </div>
    </div>
  );
}
