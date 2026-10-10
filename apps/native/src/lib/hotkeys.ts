const isMac = navigator.platform.toLowerCase().includes('mac');

/** Match a KeyboardEvent against a combo like "Mod+Shift+K" (Mod = Ctrl on Windows/Linux, Cmd on macOS). */
export function matches(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  const parts = combo.split('+').map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const want = { mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt') };
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (want.mod !== mod || want.shift !== e.shiftKey || want.alt !== e.altKey) return false;
  const k = e.key.toLowerCase();
  if (key === 'enter') return k === 'enter';
  if (key === ',') return k === ',';
  return k === key;
}

export function comboLabel(combo: string): string[] {
  return combo.split('+').map((p) => (p === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : p === 'Shift' ? (isMac ? '⇧' : 'Shift') : p === 'Alt' ? (isMac ? '⌥' : 'Alt') : p === 'Enter' ? '↵' : p));
}

export function comboFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(k);
  return parts.length > 1 ? parts.join('+') : null;
}
