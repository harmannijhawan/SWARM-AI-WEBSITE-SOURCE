import type { ReactNode } from 'react';
export type Tone='neutral'|'ok'|'warn'|'err'|'info'|'accent';
export const cx=(...c:(string|false|null|undefined)[])=>c.filter(Boolean).join(' ');
export function Dot({tone='neutral',pulse,className}:{tone?:Tone;pulse?:boolean;className?:string}) {return <span aria-hidden className={cx('desktop-dot',pulse&&'desktop-dot-pulse',className)} style={{background:`var(--${tone==='neutral'?'fg-3':tone==='info'?'accent':tone})`}}/>;}
