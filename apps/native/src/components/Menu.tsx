import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './ui';

export interface MenuItem { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean; hidden?: boolean; separator?: boolean }

/** Small anchored dropdown menu with keyboard support. */
export function Menu({ trigger, items, align = 'right' }: { trigger: (open: () => void, isOpen: boolean) => ReactNode; items: MenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key, true);
    setTimeout(() => ref.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus(), 0);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', key, true); };
  }, [open]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
  };
  return (
    <div className="relative" ref={ref}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div role="menu" onKeyDown={onKeyDown} className={cx('absolute z-50 mt-1 min-w-[180px] py-1 rounded-xl border border-line bg-raised shadow-float anim-pop', align === 'right' ? 'right-0' : 'left-0')}>
          {items.filter((i) => !i.hidden).map((it, idx) => it.separator
            ? <div key={idx} className="h-px bg-line my-1" />
            : (
              <button key={idx} role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}
                className={cx('w-full h-8 px-3 flex items-center gap-2.5 text-[0.8rem] text-left hover:bg-hover focus:bg-hover', it.danger ? 'text-err' : 'text-fg')}>
                {it.icon && <it.icon size={14} strokeWidth={1.8} className={it.danger ? '' : 'text-fg-2'} />}{it.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
