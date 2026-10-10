import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { timeAgo } from '../lib/format';
import { Button, Empty, IconButton, cx } from './ui';

const icon = (level: string) => level === 'success' ? <CheckCircle2 size={15} className="text-ok" /> : level === 'warning' ? <AlertTriangle size={15} className="text-warn" /> : level === 'error' ? <XCircle size={15} className="text-err" /> : <Info size={15} className="text-fg-3" />;

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2 w-[340px]" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role="status" className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl border border-line bg-raised shadow-float anim-pop">
          <span className="pt-px">{icon(t.level)}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[0.8rem] font-medium">{t.title}</div>
            {t.body && <div className="text-[0.72rem] text-fg-2 mt-0.5 break-words line-clamp-3">{t.body}</div>}
          </div>
          <button aria-label="Dismiss" onClick={() => useStore.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))} className="text-fg-3 hover:text-fg"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

export function NotificationPanel() {
  const open = useStore((s) => s.notificationsOpen);
  const list = useStore((s) => s.notifications);
  if (!open) return null;
  const close = () => { useStore.setState({ notificationsOpen: false }); void api.notifications.markRead(); useStore.setState((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })); };
  return (
    <div className="fixed inset-0 z-[60]" onMouseDown={close}>
      <div role="dialog" aria-label="Notifications" onMouseDown={(e) => e.stopPropagation()} className="absolute left-[60px] bottom-4 w-[380px] max-h-[70vh] flex flex-col rounded-2xl border border-line bg-raised shadow-float anim-pop">
        <div className="h-11 flex items-center justify-between px-4 border-b border-line">
          <span className="text-[0.85rem] font-semibold">Notifications</span>
          <div className="flex items-center gap-1">
            {list.length > 0 && <Button size="sm" variant="ghost" onClick={async () => { await api.notifications.clear(); useStore.setState({ notifications: [] }); }}>Clear</Button>}
            <IconButton icon={X} label="Close" size="sm" onClick={close} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.length ? list.map((n) => (
            <button key={n.id} onClick={() => { if (n.projectId) void useStore.getState().openProject(n.projectId, 'build'); close(); }} className={cx('w-full text-left flex items-start gap-2.5 px-4 py-3 border-b border-line/70 hover:bg-hover/60', !n.read && 'bg-accent-soft/40')}>
              <span className="pt-px">{icon(n.level)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2"><span className="text-[0.8rem] font-medium truncate">{n.title}</span><span className="text-[0.66rem] text-fg-3 shrink-0">{timeAgo(n.ts)}</span></div>
                <div className="text-[0.72rem] text-fg-2 mt-0.5 break-words">{n.body}</div>
              </div>
            </button>
          )) : <Empty icon={Bell} title="You're all caught up" body="Completions, failures, approvals and fallbacks show up here." />}
        </div>
      </div>
    </div>
  );
}
