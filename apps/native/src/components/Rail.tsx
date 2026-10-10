import { Bell, Boxes, Cpu, FolderTree, Globe2, History, Home, Moon, PanelLeft, Search, Settings, Sun, SquareTerminal, Workflow, BookOpenText, Smartphone } from 'lucide-react';
import { useStore, type View } from '../lib/store';
import { isDark } from '../lib/theme';
import { LogoMark } from './Logo';
import { cx } from './ui';

const ITEMS: { view: View; label: string; icon: typeof Home; needsProject?: boolean }[] = [
  { view: 'build', label: 'Project workspace', icon: Workflow },
  { view: 'runs', label: 'Projects', icon: Boxes },
  { view: 'files', label: 'Files', icon: FolderTree, needsProject: true },
  { view: 'terminal', label: 'Terminal', icon: SquareTerminal, needsProject: true },
  { view: 'browser', label: 'Browser', icon: Globe2, needsProject: true },
  { view: 'research', label: 'Research', icon: BookOpenText, needsProject: true },
];

export function Rail() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const projectId = useStore((s) => s.projectId);
  const activeRuns = useStore((s) => s.activeRuns);
  const settings = useStore((s) => s.settings)!;
  const unread = useStore((s) => s.notifications.filter((n) => !n.read).length);
  const save = useStore((s) => s.saveSettings);
  const dark = isDark(settings);
  
  // Count active running builds
  const activeBuildsCount = activeRuns.filter(r => r.status === 'running').length;

  return (
    <nav aria-label="Primary" className="app-rail w-[60px] shrink-0 flex flex-col items-center border-r border-line bg-panel">
      <div className="h-12 w-full flex items-center justify-center drag">
        
      </div>
      <div className="flex flex-col items-center gap-1 pt-2">
        {ITEMS.map(item => (
          <RailButton 
            key={item.view} 
            icon={item.icon} 
            label={item.label} 
            active={view === item.view} 
            disabled={item.needsProject && !projectId} 
            onClick={() => setView(item.view)}
            badge={item.view === 'build' && activeBuildsCount > 0 ? activeBuildsCount : undefined}
          />
        ))}
        <RailButton icon={PanelLeft} label={settings.interface.sidebarCollapsed ? 'Show projects' : 'Hide projects'} onClick={() => { if (view === 'build') setView('runs'); else void save({ interface: { sidebarCollapsed: !settings.interface.sidebarCollapsed } }); }} />
        <RailButton icon={Search} label="Search (Ctrl+K)" onClick={() => useStore.setState({ paletteOpen: true, paletteMode: 'all' })} />

      </div>
      <div className="mt-auto flex flex-col items-center gap-1 pb-3">
        <div className="relative">
          <RailButton icon={Bell} label="Notifications" onClick={() => useStore.setState((s) => ({ notificationsOpen: !s.notificationsOpen }))} />
          {unread > 0 && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-accent pointer-events-none" />}
        </div>
        <RailButton icon={dark ? Sun : Moon} label={dark ? 'Light theme' : 'Dark theme'} onClick={() => save({ appearance: { theme: dark ? 'light' : 'dark' } })} />
        <RailButton icon={Smartphone} label="Set up your phone" active={view === 'phone'} onClick={() => setView('phone')} />
        <RailButton icon={Settings} label="Settings" active={view === 'settings'} onClick={() => setView('settings')} />
      </div>
    </nav>
  );
}

function RailButton({ icon: Icon, label, active, disabled, onClick, badge }: { icon: typeof Home; label: string; active?: boolean; disabled?: boolean; onClick: () => void; badge?: number }) {
  return (
    <button aria-label={label} title={disabled ? `${label} — open a project first` : label} disabled={disabled} onClick={onClick}
      className={cx('relative h-9 w-9 rounded-lg flex items-center justify-center transition-colors duration-[var(--motion-fast)] disabled:opacity-30',
        active ? 'text-fg bg-hover' : 'text-fg-3 hover:text-fg hover:bg-hover')}>
      {active && <span className="absolute -left-[8px] top-2 bottom-2 w-[2px] rounded-full bg-fg" />}
      <Icon size={17} strokeWidth={1.7} />
      {badge && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-semibold rounded-full bg-accent-solid text-accent-fg pointer-events-none">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}
