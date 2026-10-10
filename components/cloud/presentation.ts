// Presentation only: unknown values stay unknown; no entitlement or payment decisions here.
export function formatBillingDate(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === 0) return 'Date unavailable';
  const date = typeof value === 'number' ? new Date(value) : typeof value === 'string' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.getFullYear() < 2000) return 'Date unavailable';
  return date.toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'});
}
export function formatPrice(amount: unknown, currency = 'INR'): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return 'Amount unavailable';
  try { return new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(amount/100); }
  catch { return 'Amount unavailable'; }
}
