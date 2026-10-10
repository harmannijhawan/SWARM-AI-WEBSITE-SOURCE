import { useEffect, useState } from 'react';
import { Globe2, Images, X } from 'lucide-react';
import type { Screenshot, VisualIssue } from '../../shared/types';
import { api } from '../lib/api';
import { currentProject, useStore } from '../lib/store';
import { BrowserPane } from '../components/BrowserPane';
import { Badge, Empty, IconButton, cx } from '../components/ui';
import { timeAgo } from '../lib/format';

export function BrowserView() {
  const project = useStore(currentProject);
  const previewUrl = useStore((s) => s.previewUrl);
  const runId = useStore((s) => s.runId);
  const shotEvents = useStore((s) => (s.runId ? (s.events[s.runId] ?? []).filter((e) => e.type === 'SCREENSHOT_CAPTURED').length : 0));
  const [shots, setShots] = useState<Screenshot[]>([]);
  const [issues, setIssues] = useState<VisualIssue[]>([]);
  const [showGallery, setShowGallery] = useState(true);
  const [images, setImages] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    api.runs.screenshots({ projectId: project.id }).then(setShots).catch(() => undefined);
    if (runId) api.runs.visualIssues(runId).then(setIssues).catch(() => undefined);
  }, [project?.id, runId, shotEvents]);
  useEffect(() => {
    for (const s of shots.slice(0, 12)) if (!images[s.id]) api.runs.readImage(s.path).then((d) => setImages((m) => ({ ...m, [s.id]: d }))).catch(() => undefined);
  }, [shots]);

  if (!project) return <Empty icon={Globe2} title="Open a project" body="The browser previews the project's running app." />;

  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 m-4 mr-2 rounded-2xl border border-line bg-panel overflow-hidden"><BrowserPane url={previewUrl} projectId={project.id} /></div>
      </div>
      {showGallery ? (
        <aside className="w-[300px] shrink-0 my-4 mr-4 ml-2 rounded-2xl border border-line bg-panel flex flex-col min-h-0">
          <div className="h-10 flex items-center justify-between px-3 border-b border-line"><span className="text-[0.78rem] font-medium">Captures & visual QA</span><IconButton icon={X} size="sm" label="Hide" onClick={() => setShowGallery(false)} /></div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {issues.length > 0 && (
              <div>
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-fg-3 mb-1.5">Issues found (latest run)</div>
                <ul className="space-y-1.5">{issues.slice(-12).map((i) => (
                  <li key={i.id} className="text-[0.72rem] text-fg-2 flex gap-1.5"><Badge tone={i.severity === 'high' ? 'err' : i.severity === 'medium' ? 'warn' : 'neutral'}>{i.source}</Badge><span className="min-w-0 break-words">{i.description}</span></li>
                ))}</ul>
              </div>
            )}
            {shots.length ? shots.slice(0, 12).map((s) => (
              <button key={s.id} onClick={() => setZoom(s.id)} className="block w-full text-left group">
                <div className="rounded-lg border border-line overflow-hidden bg-sunken aspect-[16/10]">{images[s.id] ? <img src={images[s.id]} alt={`${s.viewport} screenshot`} className="w-full h-full object-cover object-top group-hover:opacity-90" /> : null}</div>
                <div className="mt-1 text-[0.68rem] text-fg-3 flex justify-between"><span className="capitalize">{s.viewport}</span><span>{timeAgo(s.ts)}</span></div>
              </button>
            )) : <div className="text-[0.74rem] text-fg-3">Screenshots captured by the Tester, Vision QA or you appear here.</div>}
          </div>
        </aside>
      ) : <div className="p-4"><IconButton icon={Images} label="Show captures" onClick={() => setShowGallery(true)} /></div>}
      {zoom && images[zoom] && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-10 anim-fade" onClick={() => setZoom(null)}>
          <img src={images[zoom]} alt="Screenshot" className={cx('max-h-full max-w-full rounded-xl shadow-float')} />
        </div>
      )}
    </div>
  );
}
