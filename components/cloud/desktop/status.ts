import {
  Brain, ClipboardList, Code2, Compass, Eye, FlaskConical, Gauge, Globe, LayoutTemplate, Network, PackageCheck, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import type { AgentRole, AgentStatus, ModelHealth, TaskStatus } from './types';
import type { Tone } from './ui';

export const ROLE_META: Record<AgentRole, { name: string; title: string; icon: LucideIcon }> = {
  manager: { name: 'Manager', title: 'Planning & orchestration', icon: Brain },
  planner: { name: 'Planner', title: 'Task graph', icon: Network },
  researcher: { name: 'Researcher', title: 'Web research', icon: Globe },
  designer: { name: 'Designer', title: 'UI/UX design', icon: LayoutTemplate },
  architect: { name: 'Architect', title: 'System architecture', icon: Compass },
  coder: { name: 'Coder', title: 'Development', icon: Code2 },
  tester: { name: 'Tester', title: 'Testing & QA', icon: FlaskConical },
  reviewer: { name: 'Reviewer', title: 'Code & UX review', icon: ShieldCheck },
  optimizer: { name: 'Optimizer', title: 'Performance', icon: Gauge },
  vision: { name: 'Vision QA', title: 'Visual inspection', icon: Eye },
  finalizer: { name: 'Finalizer', title: 'Verification & delivery', icon: PackageCheck },
};
export const TaskIcon = ClipboardList;

export const agentTone = (s: AgentStatus | undefined): Tone =>
  s === 'working' || s === 'planning' ? 'accent' : s === 'completed' ? 'ok' : s === 'failed' ? 'err' : s === 'blocked' ? 'warn' : 'neutral';
export const agentLabel = (s: AgentStatus | undefined) =>
  ({ idle: 'Idle', available: 'Ready', waiting: 'Waiting', planning: 'Planning', working: 'Working', blocked: 'Blocked', failed: 'Failed', completed: 'Completed' } as const)[s ?? 'idle'] ?? 'Idle';

export const taskTone = (s: TaskStatus): Tone =>
  s === 'running' ? 'accent' : s === 'completed' ? 'ok' : s === 'failed' ? 'err' : s === 'blocked' ? 'warn' : 'neutral';
export const taskLabel = (s: TaskStatus) =>
  ({ waiting: 'Waiting', ready: 'Ready', running: 'Running', blocked: 'Blocked', failed: 'Failed', completed: 'Done', skipped: 'Skipped', cancelled: 'Cancelled' } as const)[s];

export const healthTone = (h: ModelHealth): Tone =>
  h === 'healthy' ? 'ok' : h === 'degraded' ? 'warn' : h === 'rate_limited' ? 'warn' : h === 'offline' || h === 'unsupported' ? 'err' : h === 'auth_required' ? 'neutral' : 'neutral';
export const healthLabel = (h: ModelHealth) =>
  ({ healthy: 'Healthy', degraded: 'Degraded', rate_limited: 'Rate limited', offline: 'Offline', auth_required: 'Key required', unsupported: 'Unsupported', unknown: 'Not tested' } as const)[h];
