import { ChevronRight, Boxes, MessageSquare, FolderOpen, Cpu, Settings, Pause, Square, Play, Activity, ChevronLeft, Users, Smartphone } from 'lucide-react';
import { currentProject, currentRun, useStore } from '../lib/store';
import { useNow } from '../lib/hooks';
import { duration } from '../lib/format';
import { Dot } from './ui';
import { LogoMark } from './Logo';
import { api } from '../lib/api';
import { computeGlobalRunStatus, getRunStatusLabel, getRunStatusTone } from '../lib/runStatus';

export function TopBar() {
  const view = useStore(s => s.view);
  const mode = useStore(s => s.mode);
  const project = useStore(currentProject);
  const run = useStore(currentRun);
  const runId = useStore(s => s.runId);
  const activeRuns = useStore(s => s.activeRuns);
  const tasks = useStore(s => s.runId ? s.tasks[s.runId] : undefined);
  const agents = useStore(s => s.runId ? s.agents[s.runId] : undefined);
  const canGoBack = useStore(s => s.canNavigateBack());
  const navigateBack = useStore(s => s.navigateBack);
  const now = useNow(1000, run?.status === 'running');
  const status = run ? computeGlobalRunStatus(run, Object.values(tasks ?? {}), agents ?? {}) : null;
  
  // Background runs = active runs not currently viewed
  const backgroundRuns = activeRuns.filter(r => r.id !== runId && r.status === 'running');
  const totalActiveAgents = backgroundRuns.reduce((sum, r) => {
    const runAgents = useStore.getState().agents[r.id];
    if (!runAgents) return sum;
    return sum + Object.values(runAgents).filter(a => a.status === 'working').length;
  }, 0);
  
  const control = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!run) return;
    try { await api.runs[action](run.id); }
    catch (e) { useStore.getState().toast({ level: 'error', title: 'Could not ' + action + ' run', body: String(e) }); }
  };
  
  const openBackgroundRun = () => {
    if (backgroundRuns.length === 0) return;
    // Open the most recently started background run
    const latest = backgroundRuns.sort((a, b) => b.startedAt - a.startedAt)[0];
    const proj = useStore.getState().projects.find(p => p.id === latest.projectId);
    if (proj) {
      void useStore.getState().openProject(proj.id, 'build');
    }
  };
  
  return <header className="app-topbar drag" style={{ paddingRight: window.swarm.platform === 'win32' ? 145 : 18 }}>
    {mode === 'BUILD' && <div className="app-brand"><LogoMark size={23} /><span>SWARM</span></div>}
    
    {/* Back button for navigation history */}
    {canGoBack && (
      <button 
        className="app-back-button no-drag" 
        onClick={navigateBack}
        title="Go back (Alt+Left Arrow)"
        aria-label="Navigate back"
      >
        <ChevronLeft size={16} />
      </button>
    )}
    
    <button className="no-drag px-3 text-xs text-fg-2" onClick={()=>useStore.setState({view:'settings',settingsSection:'account'})}>Account</button>
    <nav className="app-navigation no-drag" aria-label="Workspace navigation">
      <button aria-pressed={view === 'chat'} onClick={() => useStore.getState().setView('chat')}><MessageSquare size={16} /><span>Chat</span></button>
      <button aria-pressed={view === 'agents'} onClick={() => useStore.getState().setView('agents')}><Users size={16} /><span>Agents</span></button>
        <button aria-pressed={view === 'runs'} onClick={() => useStore.getState().setView('runs')}><FolderOpen size={16} /><span>Projects</span></button>
        <button aria-pressed={view === 'phone'} onClick={() => useStore.getState().setView('phone')}><Smartphone size={16} /><span>Phone</span></button>
        <button aria-pressed={view === 'settings'} onClick={() => useStore.getState().setView('settings')}><Settings size={16} /><span>Settings</span></button>
    </nav>
    
    {/* Global background build indicator */}
    {backgroundRuns.length > 0 && (
      <button 
        className="app-background-indicator no-drag" 
        onClick={openBackgroundRun}
        title={`${backgroundRuns.length} build${backgroundRuns.length > 1 ? 's' : ''} running in background`}
      >
        <Activity size={14} className="anim-pulse" />
        <span>
          SWARM is building · {totalActiveAgents} agent{totalActiveAgents !== 1 ? 's' : ''} active
        </span>
      </button>
    )}
    
    {mode === 'BUILD' && run && status && <div className="app-run-controls no-drag">
      <span className="app-run-status"><Dot tone={getRunStatusTone(status)} />{getRunStatusLabel(status)}</span>
      <time>{duration((run.endedAt ?? now) - run.startedAt)}</time>
      {run.status === 'running' ? <button onClick={() => void control('pause')}><Pause size={14} />Pause</button> : ['paused','failed','attention','cancelled'].includes(run.status) && <button onClick={() => void control('resume')}><Play size={14} />Resume</button>}
      {['running','paused'].includes(run.status) && <button onClick={() => void control('cancel')}><Square size={13} className="text-err" fill="currentColor" />Stop</button>}
    </div>}
  </header>;
}
