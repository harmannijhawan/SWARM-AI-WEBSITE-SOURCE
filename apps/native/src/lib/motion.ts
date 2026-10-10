import { useEffect, useRef } from 'react';

/** Animate a retained surface once per meaningful change, never per stream token. */
export function useMotionChange<T extends HTMLElement>(key: unknown, kind: 'arrive' | 'ack' = 'arrive') {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('no-anim')) return;
    const styles = getComputedStyle(el);
    const duration = styles.getPropertyValue('--motion-normal').trim();
    const durationMs = parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000);
    const animation = el.animate(kind === 'ack'
      ? [{ scale: '1' }, { scale: '.99', offset: .35 }, { scale: '1' }]
      : [{ opacity: .65, translate: '0 3px' }, { opacity: 1, translate: '0 0' }],
    { duration: durationMs || 220, easing: styles.getPropertyValue('--ease-out').trim() || 'ease-out' });
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const cancel = () => animation.cancel();
    const preference = new MutationObserver(() => {
      if (document.documentElement.classList.contains('no-anim')) animation.cancel();
    });
    preference.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    media.addEventListener('change', cancel);
    return () => { animation.cancel(); preference.disconnect(); media.removeEventListener('change', cancel); };
  }, [key, kind]);
  return ref;
}

export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('no-anim') ? 'instant' : 'smooth';
}
