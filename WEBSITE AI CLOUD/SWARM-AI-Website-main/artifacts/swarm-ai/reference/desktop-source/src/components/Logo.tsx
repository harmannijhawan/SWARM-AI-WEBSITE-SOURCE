import mark from '../assets/brand/logo-mark.png';
import wordmark from '../assets/brand/logo-wordmark.png';
import full from '../assets/brand/logo-full.png';
import { cx } from './ui';

/** SWARM brand assets — the original artwork, only background-stripped and cropped. */
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return <img src={mark} alt="SWARM" draggable={false} className={cx('logo-img select-none', className)} style={{ height: size, width: 'auto' }} />;
}

export function LogoWordmark({ height = 14, className }: { height?: number; className?: string }) {
  return <img src={wordmark} alt="SWARM" draggable={false} className={cx('logo-img select-none', className)} style={{ height, width: 'auto' }} />;
}

export function LogoFull({ height = 120, className }: { height?: number; className?: string }) {
  return <img src={full} alt="SWARM" draggable={false} className={cx('logo-img select-none', className)} style={{ height, width: 'auto' }} />;
}
