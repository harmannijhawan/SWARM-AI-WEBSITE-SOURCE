import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon; loading?: boolean }>(
  function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, ...rest }, ref) {
    const v = {
      primary: 'bg-accent-solid text-accent-fg hover:bg-accent-strong border border-transparent shadow-sm',
      secondary: 'bg-raised text-fg border border-line-strong shadow-xs hover:bg-hover',
      ghost: 'text-fg-2 hover:text-fg hover:bg-hover border border-transparent',
      subtle: 'bg-sunken text-fg border border-line hover:bg-accent-soft hover:text-accent-text',
      danger: 'bg-err text-white border border-transparent hover:opacity-90',
    }[variant];
    const s = { sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md', md: 'h-8 px-3 text-[0.8rem] gap-2 rounded-lg', lg: 'h-10 px-4 text-sm gap-2 rounded-lg' }[size];
    return (
      <button ref={ref} aria-busy={loading || undefined} disabled={disabled || loading} className={cx('inline-flex items-center justify-center font-medium whitespace-nowrap transition-[background,opacity,color] duration-[var(--motion-fast)] disabled:opacity-45 disabled:pointer-events-none select-none', v, s, className)} {...rest}>
        {loading ? <Spinner size={13} /> : Icon ? <Icon size={size === 'sm' ? 13 : 15} strokeWidth={1.8} /> : null}
        {children}
      </button>
    );
  });

export function IconButton({ icon: Icon, label, active, size = 'md', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean; size?: 'sm' | 'md' }) {
  return (
    <button aria-label={label} title={label} className={cx('inline-flex items-center justify-center rounded-lg transition-colors duration-[var(--motion-fast)] disabled:opacity-40',
      size === 'sm' ? 'h-7 w-7' : 'h-8 w-8', active ? 'bg-accent-soft text-accent-text' : 'text-fg-2 hover:text-fg hover:bg-hover', className)} {...rest}>
      <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.8} />
    </button>
  );
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'err' | 'info' | 'accent';
const toneCls: Record<Tone, string> = {
  neutral: 'text-fg-2 bg-sunken border-line',
  ok: 'text-ok bg-ok-soft border-transparent',
  warn: 'text-warn bg-warn-soft border-transparent',
  err: 'text-err bg-err-soft border-transparent',
  info: 'text-accent-text bg-accent-soft border-transparent',
  accent: 'text-accent-text bg-accent-soft border-transparent',
};
export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx('inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-[0.68rem] font-medium whitespace-nowrap', toneCls[tone], className)}>{children}</span>;
}

const dotColor: Record<Tone, string> = { neutral: 'bg-fg-3', ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err', info: 'bg-info', accent: 'bg-accent' };
export function Dot({ tone = 'neutral', pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span aria-hidden className={cx('inline-block h-1.5 w-1.5 rounded-full shrink-0', dotColor[tone], pulse && 'anim-pulse', className)} />;
}

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k, i) => <kbd key={i} className="min-w-[1.25rem] h-5 px-1 inline-flex items-center justify-center rounded border border-line bg-sunken text-[0.65rem] text-fg-2 font-sans">{k}</kbd>)}
    </span>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx('relative inline-block h-[18px] w-[32px] rounded-full transition-colors duration-[var(--motion-fast)] shrink-0 disabled:opacity-40', checked ? 'bg-accent' : 'bg-line-strong')}>
      <span className={cx('absolute left-0 top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-[var(--motion-fast)]', checked ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', label }: { value: T; options: { value: T; label: ReactNode; icon?: LucideIcon }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex p-0.5 rounded-lg bg-sunken border border-line', size === 'sm' ? 'h-7' : 'h-8')}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx('inline-flex items-center gap-1.5 px-2.5 rounded-md text-xs font-medium transition-colors duration-[var(--motion-fast)]', value === o.value ? 'bg-raised text-accent-text shadow-soft' : 'text-fg-2 hover:text-fg')}>
          {o.icon && <o.icon size={13} strokeWidth={1.8} />}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('h-8 pl-2.5 pr-7 rounded-lg bg-raised border border-line-strong text-[0.8rem] text-fg appearance-none bg-no-repeat bg-[right_0.5rem_center] bg-[length:12px] hover:bg-hover transition-colors focus-visible:outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--ring)]', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('h-8 px-2.5 rounded-lg bg-raised border border-line-strong text-[0.8rem] text-fg placeholder:text-fg-3 focus:border-accent focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring)] transition-colors', className)} {...rest} />;
});

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <span role="progressbar" aria-label="In progress" className={cx('inline-block rounded-full border-[1.5px] border-current border-t-transparent anim-spin opacity-70', className)} style={{ width: size, height: size }} />;
}

/** Contextual activity: the role icon stays recognizable, only its opacity breathes. */
export function Working({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return <span role="status" aria-label={label} className="inline-flex items-center gap-1.5"><Icon size={13} aria-hidden className="anim-pulse" /><span>{label}</span></span>;
}

export function Empty({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-12 px-6 anim-fade">
      <div className="h-10 w-10 rounded-xl border border-line bg-surface-alt flex items-center justify-center text-fg-3 mb-1"><Icon size={18} strokeWidth={1.6} /></div>
      <div className="text-sm font-medium text-fg">{title}</div>
      {body && <div className="text-xs text-fg-2 max-w-sm leading-relaxed">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange, className }: { value: T; tabs: { value: T; label: string; icon?: LucideIcon; count?: number; live?: boolean }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex items-center gap-0.5', className)}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx('relative h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium rounded-md transition-colors', value === t.value ? 'text-accent-text bg-accent-soft' : 'text-fg-2 hover:text-fg hover:bg-hover')}>
          {t.icon && <t.icon size={13} strokeWidth={1.8} />}
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="text-[0.65rem] text-fg-3 tabular">{t.count}</span>}
          {t.live && <Dot tone="accent" pulse />}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-fg-3">{children}</h3>
      {action}
    </div>
  );
}

export function Meter({ value, tone = 'accent', className }: { value: number; tone?: Tone; className?: string }) {
  return (
    <div className={cx('h-1 rounded-full bg-sunken overflow-hidden', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('motion-meter h-full w-full rounded-full', dotColor[tone])} style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </div>
  );
}
