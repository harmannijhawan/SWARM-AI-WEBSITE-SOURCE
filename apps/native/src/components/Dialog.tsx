import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { Button, Input } from './ui';

interface Ask {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  input?: { initial: string; placeholder?: string };
  checkbox?: { label: string; initial: boolean };
  resolve: (v: { ok: boolean; value: string; checked: boolean }) => void;
}

const useDialogStore = create<{ current: Ask | null }>(() => ({ current: null }));

export function ask(opts: Omit<Ask, 'resolve'>): Promise<{ ok: boolean; value: string; checked: boolean }> {
  return new Promise((resolve) => useDialogStore.setState({ current: { ...opts, resolve } }));
}

export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!current) return;
    setValue(current.input?.initial ?? '');
    setChecked(current.checkbox?.initial ?? false);
    setTimeout(() => (current.input ? inputRef.current?.select() : confirmRef.current?.focus()), 20);
  }, [current]);
  if (!current) return null;
  const close = (ok: boolean) => { current.resolve({ ok, value, checked }); useDialogStore.setState({ current: null }); };
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[18vh] bg-black/20 dark:bg-black/50 anim-fade" onMouseDown={() => close(false)}>
      <div role="dialog" aria-modal="true" aria-label={current.title} className="w-[420px] rounded-2xl border border-line bg-raised shadow-float p-5 anim-pop" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } if (e.key === 'Enter' && current.input) close(true); }}>
        <div className="text-[0.95rem] font-semibold">{current.title}</div>
        {current.body && <div className="mt-1.5 text-[0.8rem] text-fg-2 leading-relaxed">{current.body}</div>}
        {current.input && <Input ref={inputRef} className="mt-4 w-full" value={value} placeholder={current.input.placeholder} onChange={(e) => setValue(e.target.value)} />}
        {current.checkbox && (
          <label className="mt-4 flex items-center gap-2 text-[0.8rem] text-fg-2">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="accent-[var(--accent)]" />
            {current.checkbox.label}
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button ref={confirmRef} variant={current.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{current.confirmLabel ?? 'Confirm'}</Button>
        </div>
      </div>
    </div>
  );
}
