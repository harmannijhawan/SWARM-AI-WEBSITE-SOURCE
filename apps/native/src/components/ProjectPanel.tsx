import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Copy, FolderOpen, FolderInput, MoreHorizontal, Package, Pencil, Plus, Search, Star, Trash2 } from 'lucide-react';
import type { Project } from '../../shared/types';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { groupByDay, timeAgo } from '../lib/format';
import { Dot, IconButton, cx, type Tone } from './ui';
import { Menu } from './Menu';
import { ask } from './Dialog';

export function ProjectPanel() {
  const projects = useStore((s) => s.projects);
  const projectId = useStore((s) => s.projectId);
  const runs = useStore((s) => s.runs);
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return projects.filter((p) => p.archived === showArchived && (!ql || p.name.toLowerCase().includes(ql) || p.objective.toLowerCase().includes(ql)));
  }, [projects, q, showArchived]);
  const favorites = filtered.filter((p) => p.favorite);
  const groups = groupByDay(filtered.filter((p) => !p.favorite));
  const archivedCount = projects.filter((p) => p.archived).length;

  const newProject = () => { useStore.getState().openProject(null, 'build'); setTimeout(() => document.getElementById('composer-input')?.focus(), 50); };
  const openFolder = async () => {
    const dir = await api.pickFolder();
    if (!dir) return;
    const p = await api.projects.create({ path: dir, name: dir.split(/[\\/]/).pop() });
    await useStore.getState().refreshProjects();
    await useStore.getState().openProject(p.id, 'build');
  };

  return (
    <aside aria-label="Projects" className="w-[248px] shrink-0 border-r border-line bg-panel flex flex-col">
      <div className="h-10 flex items-center justify-between pl-4 pr-2 drag">
        <span className="text-[0.8rem] font-semibold">{showArchived ? 'Archived' : 'Projects'}</span>
        <div className="flex items-center no-drag">
          <IconButton icon={FolderInput} label="Open existing folder" size="sm" onClick={openFolder} />
          <IconButton icon={Plus} label="New project (Ctrl+N)" size="sm" onClick={newProject} />
        </div>
      </div>
      <div className="px-3 pb-2">
        <label className="flex items-center gap-2 h-8 px-2.5 rounded-lg bg-sunken border border-line text-fg-3 focus-within:border-accent transition-colors">
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" className="flex-1 bg-transparent text-[0.8rem] text-fg placeholder:text-fg-3 min-w-0" />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {favorites.length > 0 && <Group label="Favorites">{favorites.map((p) => <Row key={p.id} p={p} active={p.id === projectId} runStatus={p.lastRunId ? runs[p.lastRunId]?.status : undefined} />)}</Group>}
        {groups.map((g) => <Group key={g.label} label={g.label}>{g.items.map((p) => <Row key={p.id} p={p} active={p.id === projectId} runStatus={p.lastRunId ? runs[p.lastRunId]?.status : undefined} />)}</Group>)}
        {!filtered.length && <div className="px-3 py-8 text-center text-xs text-fg-3">{q ? 'No matching projects' : showArchived ? 'Nothing archived' : 'No projects yet. Describe an outcome to start one.'}</div>}
        {(archivedCount > 0 || showArchived) && (
          <button onClick={() => setShowArchived((v) => !v)} className="mt-3 mx-2 text-xs text-fg-3 hover:text-fg-2 flex items-center gap-1.5">
            <Archive size={12} /> {showArchived ? 'Back to projects' : `Archived (${archivedCount})`}
          </button>
        )}
      </div>
    </aside>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="px-2.5 py-1.5 text-[0.68rem] font-medium text-fg-3">{label}</div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

function statusLine(p: Project, runStatus?: string): { text: string; tone: Tone; live: boolean } {
  if (p.status === 'running' || runStatus === 'running') return { text: 'Building…', tone: 'accent', live: true };
  if (p.status === 'completed') return { text: `Completed · ${timeAgo(p.updatedAt)}`, tone: 'ok', live: false };
  if (p.status === 'failed') return { text: `Failed · ${timeAgo(p.updatedAt)}`, tone: 'err', live: false };
  if (p.status === 'attention') return { text: `Needs attention · ${timeAgo(p.updatedAt)}`, tone: 'warn', live: false };
  return { text: p.isDemo && !p.lastRunId ? 'Demo · ready to run' : `Idle · ${timeAgo(p.updatedAt)}`, tone: 'neutral', live: false };
}

function Row({ p, active, runStatus }: { p: Project; active: boolean; runStatus?: string }) {
  const st = statusLine(p, runStatus);
  const refresh = () => useStore.getState().refreshProjects();
  const toast = useStore((s) => s.toast);
  const rename = async () => {
    const r = await ask({ title: 'Rename project', input: { initial: p.name }, confirmLabel: 'Rename' });
    if (r.ok && r.value.trim()) { await api.projects.update(p.id, { name: r.value.trim() }); refresh(); }
  };
  const remove = async () => {
    if (useStore.getState().settings?.general.confirmDestructive === false) {
      await api.projects.remove(p.id, true);
      if (useStore.getState().projectId === p.id) useStore.getState().openProject(null, 'home');
      refresh(); toast({ level: 'info', title: 'Project deleted', body: 'Files were kept on disk' });
      return;
    }
    const r = await ask({ title: `Delete “${p.name}”?`, body: p.external ? 'SWARM metadata and history will be removed. The folder on disk is not touched.' : 'SWARM metadata and history will be removed.', checkbox: p.external ? undefined : { label: 'Also move project files to the Recycle Bin', initial: false }, confirmLabel: 'Delete', danger: true });
    if (!r.ok) return;
    await api.projects.remove(p.id, !r.checked);
    if (useStore.getState().projectId === p.id) useStore.getState().openProject(null, 'home');
    refresh();
    toast({ level: 'info', title: 'Project deleted', body: r.checked ? 'Files moved to the Recycle Bin' : undefined });
  };
  return (
    <div className={cx('motion-project group relative flex items-center rounded-lg transition-colors', active ? 'bg-hover' : 'hover:bg-hover/60')}>
      {active && <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-fg" />}
      <button onClick={() => useStore.getState().openProject(p.id, 'build')} className="flex-1 min-w-0 text-left pl-3 pr-1 py-2">
        <div className="flex items-center gap-1.5">
          <span className={cx('truncate text-[0.8rem]', active ? 'font-medium text-fg' : 'text-fg')}>{p.name}</span>
          {p.favorite && <Star size={10} className="text-fg-3 shrink-0" fill="currentColor" />}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-[0.7rem] text-fg-3">
          <Dot tone={st.tone} pulse={st.live} />
          <span className="truncate">{st.text}</span>
        </div>
      </button>
      <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 pr-1">
        <Menu trigger={(open) => <IconButton icon={MoreHorizontal} label={`Actions for ${p.name}`} size="sm" onClick={open} />} items={[
          { label: 'Rename', icon: Pencil, onClick: rename },
          { label: p.favorite ? 'Remove favorite' : 'Favorite', icon: Star, onClick: async () => { await api.projects.update(p.id, { favorite: !p.favorite }); refresh(); } },
          { label: 'Duplicate', icon: Copy, onClick: async () => { await api.projects.duplicate(p.id); refresh(); toast({ level: 'success', title: 'Project duplicated' }); } },
          { label: 'Reveal in Explorer', icon: FolderOpen, onClick: () => api.projects.reveal(p.id) },
          { label: 'Export as .zip', icon: Package, onClick: async () => { const f = await api.projects.exportZip(p.id).catch((e) => { toast({ level: 'error', title: 'Export failed', body: String(e.message ?? e) }); return null; }); if (f) toast({ level: 'success', title: 'Exported', body: f }); } },
          { label: p.archived ? 'Restore' : 'Archive', icon: p.archived ? ArchiveRestore : Archive, onClick: async () => { await api.projects.update(p.id, { archived: !p.archived }); refresh(); } },
          { label: '', separator: true, onClick: () => undefined },
          { label: 'Delete…', icon: Trash2, danger: true, onClick: remove },
        ]} />
      </div>
    </div>
  );
}
