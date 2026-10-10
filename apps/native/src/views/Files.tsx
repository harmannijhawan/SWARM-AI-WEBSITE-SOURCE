import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, FilePlus2, FileText, Folder, FolderOpen, Pencil, RefreshCw, Save, Search, Sparkles, Trash2 } from 'lucide-react';
import type { FileChange, FileNode } from '../../shared/types';
import { api } from '../lib/api';
import { currentProject, useStore } from '../lib/store';
import { bytes, timeAgo } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { ChangesPane } from '../components/ChangesPane';
import { ROLE_META } from '../components/status';
import { ask } from '../components/Dialog';
import { Button, Empty, IconButton, Segmented, Spinner, cx } from '../components/ui';

function flatten(nodes: FileNode[], out: FileNode[] = []) { for (const n of nodes) { if (n.dir) { if (n.children) flatten(n.children, out); } else out.push(n); } return out; }

export function Files() {
  const project = useStore(currentProject);
  const selected = useStore((s) => s.selectedFile);
  const toast = useStore((s) => s.toast);
  const fileEvents = useStore((s) => (s.runId ? (s.events[s.runId] ?? []).filter((e) => e.type.startsWith('FILE_')).length : 0));
  const [tree, setTree] = useState<FileNode[]>([]);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 120);
  const [mode, setMode] = useState<'tree' | 'recent' | 'agents'>('tree');
  const [tab, setTab] = useState<'file' | 'changes'>('file');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [content, setContent] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = () => {
    if (!project) return;
    api.projects.tree(project.id).then(setTree).catch(() => setTree([]));
    api.projects.changes(project.id).then(setChanges).catch(() => undefined);
  };
  useEffect(reload, [project?.id, fileEvents]);
  useEffect(() => {
    if (!project || !selected) { setContent(null); return; }
    setLoading(true); setDraft(null);
    api.projects.readFile(project.id, selected).then(setContent).catch((e) => setContent(`Could not read file: ${e.message}`)).finally(() => setLoading(false));
    setOpen((o) => { const n = new Set(o); const parts = selected.split('/'); for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join('/')); return n; });
  }, [project?.id, selected, fileEvents]);

  const agentTouched = useMemo(() => { const m = new Map<string, FileChange>(); for (const c of changes) if (!m.has(c.path) && c.agent && c.agent !== 'user') m.set(c.path, c); return m; }, [changes]);
  const all = useMemo(() => flatten(tree), [tree]);
  const filtered = useMemo(() => {
    let list = all;
    if (dq) list = list.filter((f) => f.path.toLowerCase().includes(dq.toLowerCase()));
    if (mode === 'recent') list = [...list].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0)).slice(0, 80);
    if (mode === 'agents') list = list.filter((f) => agentTouched.has(f.path));
    return list;
  }, [all, dq, mode, agentTouched]);

  if (!project) return <Empty icon={FolderOpen} title="Open a project" body="Browse and edit the project's real files." />;

  const select = (p: string) => { useStore.setState({ selectedFile: p }); setTab('file'); };
  const save = async () => {
    if (draft === null || !selected) return;
    await api.projects.writeFile(project.id, selected, draft);
    setContent(draft); setDraft(null); toast({ level: 'success', title: `Saved ${selected}` }); reload();
  };
  const newFile = async () => {
    const r = await ask({ title: 'New file', input: { initial: '', placeholder: 'path/to/file.js' }, confirmLabel: 'Create' });
    if (r.ok && r.value.trim()) { await api.projects.writeFile(project.id, r.value.trim(), ''); reload(); select(r.value.trim().replace(/\\/g, '/')); }
  };
  const rename = async () => {
    if (!selected) return;
    const r = await ask({ title: 'Rename file', input: { initial: selected }, confirmLabel: 'Rename' });
    if (r.ok && r.value.trim() && r.value !== selected) { await api.projects.renameFile(project.id, selected, r.value.trim()); useStore.setState({ selectedFile: r.value.trim() }); reload(); }
  };
  const remove = async () => {
    if (!selected) return;
    const r = await ask({ title: `Delete ${selected}?`, body: 'The deletion is recorded in the change history and can be reverted.', confirmLabel: 'Delete', danger: true });
    if (r.ok) { await api.projects.deleteFile(project.id, selected); useStore.setState({ selectedFile: null }); reload(); }
  };

  const renderTree = (nodes: FileNode[], depth = 0): React.ReactNode => nodes.map((n) => {
    if (n.dir) {
      const isOpen = open.has(n.path) || !!dq;
      return (
        <div key={n.path}>
          <button onClick={() => setOpen((o) => { const x = new Set(o); if (x.has(n.path)) x.delete(n.path); else x.add(n.path); return x; })} className="w-full flex items-center gap-1 h-7 pr-2 hover:bg-hover/60 rounded-md text-[0.76rem] text-fg-2" style={{ paddingLeft: 8 + depth * 12 }}>
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{isOpen ? <FolderOpen size={13} className="text-fg-3" /> : <Folder size={13} className="text-fg-3" />}<span className="truncate">{n.name}</span>
            {!n.children && <span className="ml-auto text-[0.62rem] text-fg-3">not indexed</span>}
          </button>
          {isOpen && n.children && renderTree(dq ? n.children.filter((c) => c.dir || c.path.toLowerCase().includes(dq.toLowerCase())) : n.children, depth + 1)}
        </div>
      );
    }
    const ch = agentTouched.get(n.path);
    return (
      <button key={n.path} onClick={() => select(n.path)} className={cx('w-full flex items-center gap-1.5 h-7 pr-2 rounded-md text-[0.76rem] text-left', selected === n.path ? 'bg-hover text-fg' : 'text-fg-2 hover:bg-hover/60')} style={{ paddingLeft: 20 + depth * 12 }}>
        <FileCode2 size={13} className="text-fg-3 shrink-0" /><span className="truncate">{n.name}</span>
        {ch && <span title={`Last changed by ${ROLE_META[ch.agent as keyof typeof ROLE_META]?.name}`} className="ml-auto"><Sparkles size={11} className="text-accent" /></span>}
      </button>
    );
  });

  return (
    <div className="h-full flex min-h-0 p-4 gap-3">
      <aside className="w-[280px] shrink-0 rounded-2xl border border-line bg-panel flex flex-col min-h-0">
        <div className="p-2 space-y-2 border-b border-line">
          <div className="flex items-center gap-1">
            <label className="flex-1 flex items-center gap-2 h-8 px-2.5 rounded-lg bg-sunken border border-line focus-within:border-accent"><Search size={13} className="text-fg-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter files" aria-label="Filter files" className="flex-1 min-w-0 bg-transparent text-[0.78rem]" /></label>
            <IconButton icon={FilePlus2} label="New file" size="sm" onClick={newFile} />
            <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={reload} />
          </div>
          <Segmented size="sm" value={mode} onChange={setMode} label="File list mode" options={[{ value: 'tree', label: 'Tree' }, { value: 'recent', label: 'Recent' }, { value: 'agents', label: `By agents ${agentTouched.size}` }]} />
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {mode === 'tree' && !dq ? renderTree(tree) : filtered.map((f) => (
            <button key={f.path} onClick={() => select(f.path)} className={cx('w-full flex items-center gap-2 h-7 px-2 rounded-md text-left', selected === f.path ? 'bg-hover' : 'hover:bg-hover/60')}>
              <FileCode2 size={13} className="text-fg-3 shrink-0" /><span className="mono text-[0.7rem] truncate flex-1">{f.path}</span>
              <span className="text-[0.62rem] text-fg-3 shrink-0">{mode === 'agents' ? ROLE_META[agentTouched.get(f.path)!.agent as keyof typeof ROLE_META]?.name : timeAgo(f.mtime)}</span>
            </button>
          ))}
          {!all.length && <div className="p-4 text-[0.74rem] text-fg-3">This project folder is empty.</div>}
        </div>
      </aside>
      <section className="flex-1 min-w-0 rounded-2xl border border-line bg-panel flex flex-col min-h-0 overflow-hidden">
        <div className="h-10 flex items-center gap-2 px-3 border-b border-line shrink-0">
          <Segmented size="sm" value={tab} onChange={setTab} label="View" options={[{ value: 'file', label: 'File', icon: FileText }, { value: 'changes', label: `Changes ${changes.length}` }]} />
          {tab === 'file' && selected && (
            <>
              <span className="mono text-[0.72rem] text-fg-2 truncate">{selected}</span>
              {all.find((f) => f.path === selected)?.size !== undefined && <span className="text-[0.66rem] text-fg-3">{bytes(all.find((f) => f.path === selected)!.size!)}</span>}
              <div className="ml-auto flex items-center gap-1">
                {draft !== null && <Button size="sm" variant="primary" icon={Save} onClick={save}>Save</Button>}
                <IconButton icon={Pencil} label="Rename" size="sm" onClick={rename} />
                <IconButton icon={Trash2} label="Delete" size="sm" onClick={remove} />
                <IconButton icon={FolderOpen} label="Reveal in Explorer" size="sm" onClick={() => api.projects.reveal(project.id, selected)} />
              </div>
            </>
          )}
        </div>
        <div className="flex-1 min-h-0">
          {tab === 'changes' ? <ChangesPane projectId={project.id} /> : !selected ? <Empty icon={FileCode2} title="Select a file" body="Files changed by agents are marked with a spark. Open Changes to review diffs." /> : loading ? <div className="p-6"><Spinner /></div> : (
            <textarea aria-label={`Contents of ${selected}`} spellCheck={false} value={draft ?? content ?? ''} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save(); } }}
              className="w-full h-full resize-none p-4 mono text-[0.74rem] leading-[1.6] bg-sunken text-fg selectable" />
          )}
        </div>
      </section>
    </div>
  );
}
