export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 45_000) return 'just now';
  if (d < 3600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.round(d / 3600_000)}h ago`;
  if (d < 7 * 86400_000) return `${Math.round(d / 86400_000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function num(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ctxLen(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  return `${Math.round(n / 1000)}k`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const usd = (n: number) => `$${n.toFixed(2)}`;

export function groupByDay<T extends { updatedAt: number }>(items: T[]): { label: string; items: T[] }[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  const groups: Record<string, T[]> = { Today: [], Yesterday: [], 'This week': [], Earlier: [] };
  for (const it of items) {
    if (it.updatedAt >= t0) groups.Today.push(it);
    else if (it.updatedAt >= t0 - 86400_000) groups.Yesterday.push(it);
    else if (it.updatedAt >= t0 - 6 * 86400_000) groups['This week'].push(it);
    else groups.Earlier.push(it);
  }
  return Object.entries(groups).filter(([, v]) => v.length).map(([label, items]) => ({ label, items }));
}
