import { useState } from 'react';
import { ArrowUp, BookOpenText, Info } from 'lucide-react';
import { api } from '../lib/api';
import { currentProject, useStore } from '../lib/store';
import { ResearchPane } from '../components/ResearchPane';
import { Empty, Spinner } from '../components/ui';

export function Research() {
  const project = useStore(currentProject);
  const boot = useStore((s) => s.boot);
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  if (!project) return <Empty icon={BookOpenText} title="Open a project" body="Research is stored with each project." />;

  const start = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await api.runs.start(project.id, `Research and write a cited report: ${q.trim()}`, { webResearch: true });
      useStore.setState({ runId: r.id, runs: { ...useStore.getState().runs, [r.id]: r } });
      setQ('');
      toast({ level: 'info', title: 'Research run started', body: 'Follow progress in Build, or watch sources arrive here.' });
    } catch (e) { toast({ level: 'error', title: 'Could not start research', body: String((e as Error).message) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-8 pt-7 pb-4 shrink-0">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.015em]">Research</h1>
        <p className="text-[0.8rem] text-fg-2 mt-1">Every source SWARM actually retrieved for {project.name}, and the cited findings extracted from them.</p>
        <form onSubmit={(e) => { e.preventDefault(); void start(); }} className="mt-4 flex items-center gap-2 h-11 pl-4 pr-1.5 rounded-xl border border-line-strong bg-raised focus-within:border-fg-3 max-w-[760px]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask SWARM to research something for this project" aria-label="Research question" className="flex-1 bg-transparent text-[0.86rem]" />
          <button type="submit" disabled={!q.trim() || busy} aria-label="Start research" className="h-8 w-8 rounded-lg bg-fg text-bg flex items-center justify-center disabled:opacity-30">{busy ? <Spinner size={12} /> : <ArrowUp size={15} />}</button>
        </form>
        {!boot?.fullWebSearch && (
          <p className="mt-2.5 text-[0.72rem] text-fg-3 flex items-start gap-1.5 max-w-[760px]"><Info size={12} className="mt-0.5 shrink-0" />
            Keyless mode: DuckDuckGo (when it doesn't challenge automated requests), DuckDuckGo Instant Answers, Wikipedia, and model-suggested URLs that SWARM verifies by fetching. For full web search add a free Tavily or Brave key, or a SearXNG URL, in Settings › Web Research.</p>
        )}
      </div>
      <div className="flex-1 min-h-0 mx-8 mb-6 rounded-2xl border border-line bg-panel overflow-hidden"><ResearchPane projectId={project.id} /></div>
    </div>
  );
}
