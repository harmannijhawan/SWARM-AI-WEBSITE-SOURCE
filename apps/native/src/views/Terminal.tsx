import { SquareTerminal } from 'lucide-react';
import { currentProject, useStore } from '../lib/store';
import { TerminalPane } from '../components/TerminalPane';
import { Empty } from '../components/ui';

export function Terminal() {
  const project = useStore(currentProject);
  const autonomy = useStore((s) => s.settings?.behavior.autonomy);
  if (!project) return <Empty icon={SquareTerminal} title="Open a project" body="The terminal runs inside the project folder." />;
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-8 pt-6 pb-3 shrink-0 flex items-end justify-between">
        <div>
          <h1 className="text-[1.35rem] font-semibold tracking-[-0.015em]">Terminal</h1>
          <p className="text-[0.76rem] text-fg-2 mt-1 mono">{project.path}</p>
        </div>
        <p className="text-[0.7rem] text-fg-3 max-w-[380px] text-right">Non-interactive shell scoped to this project. Dangerous commands are blocked; high-risk commands ask first. Agent approval mode: {autonomy}.</p>
      </div>
      <div className="flex-1 min-h-0 mx-8 mb-6 rounded-2xl border border-line bg-panel overflow-hidden"><TerminalPane projectId={project.id} /></div>
    </div>
  );
}
