import type { Settings } from '../../shared/settings';
import { api } from './api';

const media = window.matchMedia('(prefers-color-scheme: dark)');
const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');

export function isDark(s: Settings) {
  return s.appearance.theme === 'dark' || (s.appearance.theme === 'system' && media.matches);
}

export function applyTheme(s: Settings) {
  const root = document.documentElement;
  const dark = isDark(s);
  root.classList.toggle('dark', dark);
  root.dataset.accent = s.appearance.accent;
  root.dataset.density = s.appearance.density;
  root.style.setProperty('--font-scale', String(s.appearance.fontScale));
  const reduce = s.appearance.reducedMotion === 'on' || (s.appearance.reducedMotion === 'system' && motionMedia.matches);
  root.classList.toggle('no-anim', reduce || !s.appearance.animations);
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || (dark ? '#0c0c0e' : '#fbfbfa');
  void api.setTitleBar(bg, dark ? '#d8d8dc' : '#3a3a40').catch(() => undefined);
}

export function watchSystemTheme(get: () => Settings | null) {
  const on = () => { const s = get(); if (s) applyTheme(s); };
  media.addEventListener('change', on);
  motionMedia.addEventListener('change', on);
  return () => { media.removeEventListener('change', on); motionMedia.removeEventListener('change', on); };
}
