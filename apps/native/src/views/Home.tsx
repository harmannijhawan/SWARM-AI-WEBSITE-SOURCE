import { ArrowRight, Cpu, FolderInput, Play, Plug, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { timeAgo } from '../lib/format';
import { Composer } from '../components/Composer';
import { LogoMark } from '../components/Logo';
import { Dot } from '../components/ui';

const EXAMPLES = [
  { label: 'Build a website', text: 'Build a modern, responsive website for ' },
  { label: 'Build an app', text: 'Build a full-stack web app that ' },
  { label: 'Research something', text: 'Research the current market for ' },
  { label: 'Fix my project', text: 'Find and fix the problems in this project: ' },
  { label: 'Analyze a repository', text: 'Analyze this repository and summarize its architecture, risks and next steps.' },
  { label: 'Create a design', text: 'Design a clean landing page for ' },
  { label: 'Automate a task', text: 'Write a Node.js script that automates ' },
];

export function Home() {
  const projects = useStore((s) => s.projects);
  const runs = useStore((s) => s.runs);
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const boot = useStore((s) => s.boot);
  const recent = projects.filter((p) => !p.archived).slice(0, 5);
  const active = Object.values(runs).filter((r) => r.status === 'running');
  const demo = projects.find((p) => p.isDemo);
  const healthy = models.filter((m) => m.health === 'healthy').length;
  const connected = providers.filter((p) => p.configured && p.enabled).length;
  const ollama = providers.find((p) => p.id === 'ollama');

  const prefill = (t: string) => window.dispatchEvent(new CustomEvent('swarm:prefill', { detail: t }));
  const runDemo = async () => {
    if (!demo) return;
    await useStore.getState().openProject(demo.id, 'build');
    setTimeout(() => prefill(demo.objective), 150);
  };
  const openFolder = async () => {
    const dir = await api.pickFolder();
    if (!dir) return;
    const p = await api.projects.create({ path: dir, name: dir.split(/[\\/]/).pop() });
    await useStore.getState().refreshProjects();
    await useStore.getState().openProject(p.id, 'build');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-8 pt-[12vh] pb-16 anim-fade">
        <div className="flex items-center gap-2.5 mb-6 text-fg-2">
          <LogoMark size={18} />
          <span className="text-[0.8rem]">Give SWARM an outcome.</span>
        </div>
        <h1 className="text-[2.1rem] leading-[1.15] font-semibold tracking-[-0.025em] mb-6">What do you want to build?</h1>
        <Composer variant="hero" />
        <div className="flex flex-wrap gap-1.5 mt-4">
          {EXAMPLES.map((e) => (
            <button key={e.label} onClick={() => prefill(e.text)} className="h-7 px-2.5 rounded-lg border border-line text-[0.75rem] text-fg-2 hover:text-fg hover:border-line-strong hover:bg-raised transition-colors">{e.label}</button>
          ))}
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-10">
          <section aria-label="Recent projects" className="min-w-0">
            <div className="text-[0.72rem] font-medium text-fg-3 mb-2">Recent</div>
            {recent.length ? (
              <ul className="-mx-2">
                {recent.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => useStore.getState().openProject(p.id, 'build')} className="w-full group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-hover text-left">
                      <Dot tone={p.status === 'running' ? 'accent' : p.status === 'completed' ? 'ok' : p.status === 'failed' ? 'err' : p.status === 'attention' ? 'warn' : 'neutral'} pulse={p.status === 'running'} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[0.82rem] truncate">{p.name}</span>
                        <span className="block text-[0.7rem] text-fg-3 truncate">{p.memory.summary || p.objective || 'No runs yet'}</span>
                      </span>
                      <span className="text-[0.7rem] text-fg-3 tabular shrink-0">{timeAgo(p.updatedAt)}</span>
                      <ArrowRight size={13} className="text-fg-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <div className="text-[0.8rem] text-fg-3 py-2">Projects you start appear here.</div>}
            {active.length > 0 && (
              <div className="mt-6">
                <div className="text-[0.72rem] font-medium text-fg-3 mb-2">Active runs</div>
                {active.map((r) => (
                  <button key={r.id} onClick={() => useStore.getState().openProject(r.projectId, 'build')} className="w-full flex items-center gap-2 px-2 -mx-2 py-2 rounded-lg hover:bg-hover text-left">
                    <Dot tone="accent" pulse /><span className="text-[0.8rem] truncate">{r.brief?.title ?? r.objective}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section aria-label="Quick actions" className="min-w-0">
            <div className="text-[0.72rem] font-medium text-fg-3 mb-2">Quick actions</div>
            <div className="flex flex-col -mx-2">
              {demo && <Quick icon={Play} title="Run the demo" sub="Delhi Sneaker Store — full pipeline" onClick={runDemo} />}
              <Quick icon={FolderInput} title="Open a folder" sub="Fix or analyze an existing project" onClick={openFolder} />
              <Quick icon={Plug} title="Connect providers" sub={`${connected} connected`} onClick={() => useStore.setState({ view: 'settings', settingsSection: 'providers' })} />
              <Quick icon={Cpu} title="Model Center" sub={`${models.length} free models · ${healthy} healthy`} onClick={() => useStore.getState().setView('models')} />
            </div>
          </section>
        </div>
        <div className="mt-14 flex items-center gap-4 text-[0.7rem] text-fg-3">
          <span className="flex items-center gap-1.5"><Sparkles size={12} /> {models.length} free models registered</span>
          <span className="flex items-center gap-1.5"><Dot tone={ollama?.health === 'offline' ? 'neutral' : ollama?.modelCount ? 'ok' : 'neutral'} /> Ollama {ollama?.modelCount ? `· ${ollama.modelCount} local` : boot?.ollama.installed ? 'installed, not running' : 'not detected'}</span>
          <span className="ml-auto">Cloud $0.00 · Local $0.00</span>
        </div>
      </div>
    </div>
  );
}

function Quick({ icon: Icon, title, sub, onClick }: { icon: typeof Play; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-hover text-left group">
      <span className="h-8 w-8 rounded-lg border border-line flex items-center justify-center text-fg-2 group-hover:text-fg"><Icon size={14} strokeWidth={1.8} /></span>
      <span className="min-w-0">
        <span className="block text-[0.8rem]">{title}</span>
        <span className="block text-[0.7rem] text-fg-3 truncate">{sub}</span>
      </span>
    </button>
  );
}
