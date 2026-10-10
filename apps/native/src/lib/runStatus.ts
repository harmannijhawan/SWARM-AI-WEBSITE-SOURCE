// Utilities for computing global run status vs individual agent/task statuses
import type { Run, Task, AgentState } from '../../shared/types';

export type GlobalRunStatus = 
  | 'preparing'      // Initial phase, manager working
  | 'planning'       // Planner creating task graph
  | 'executing'      // Active execution with tasks running
  | 'verifying'      // Running tests/QA
  | 'recovering'     // Self-repair cycle active
  | 'paused'         // Execution paused (not implemented yet)
  | 'completing'     // Finalizing
  | 'completed'      // All done successfully
  | 'attention'      // Needs user attention
  | 'failed'         // Fatal failure
  | 'cancelled'      // User cancelled
  | 'stalled';       // No progress detected

/**
 * Compute the global run status based on run state, tasks, and agents.
 * This provides a more nuanced status than just run.status for UI display.
 */
export function computeGlobalRunStatus(
  run: Run,
  tasks: Task[],
  agents: Partial<Record<string, AgentState>>
): GlobalRunStatus {
  // Terminal states from run
  if (run.status === 'completed') return 'completed';
  if (run.status === 'cancelled') return 'cancelled';
  if (run.status === 'failed') return 'failed';
  if (run.status === 'attention') return 'attention';
  if (run.status === 'paused') return 'paused';
  
  // Not running
  if (run.status !== 'running') return 'completed';
  
  // Check for stalled state (no activity)
  const recentActivity = tasks.some(t => 
    t.status === 'running' && t.startedAt && (Date.now() - t.startedAt < 5 * 60 * 1000)
  );
  if (!recentActivity && tasks.some(t => t.status === 'running')) {
    return 'stalled';
  }
  
  // Check current execution phase
  const runningTasks = tasks.filter(t => t.status === 'running');
  const completedTasks = tasks.filter(t => t.status === 'completed');
  
  // Early phases
  if (tasks.length === 0 || (tasks.length === 1 && tasks[0].kind === 'plan')) {
    return 'preparing';
  }
  
  if (runningTasks.some(t => t.kind === 'decompose')) {
    return 'planning';
  }
  
  // Self-repair
  if (run.repairCycles > 0 && runningTasks.some(t => t.kind === 'repair')) {
    return 'recovering';
  }
  
  // Verification phase
  if (runningTasks.some(t => ['test', 'visual_qa', 'review'].includes(t.kind))) {
    return 'verifying';
  }
  
  // Finalization
  if (runningTasks.some(t => t.kind === 'finalize')) {
    return 'completing';
  }
  
  // Active execution
  if (runningTasks.length > 0) {
    return 'executing';
  }
  
  // Has waiting tasks but nothing running - between tasks
  if (tasks.some(t => t.status === 'waiting')) {
    return 'executing';
  }
  
  // All tasks complete but run not marked complete yet
  if (completedTasks.length === tasks.length && tasks.length > 0) {
    return 'completing';
  }
  
  return 'executing';
}

/**
 * Get a human-readable status label for global run status.
 */
export function getRunStatusLabel(status: GlobalRunStatus): string {
  const labels: Record<GlobalRunStatus, string> = {
    preparing: 'Preparing',
    planning: 'Planning',
    executing: 'Running',
    verifying: 'Verifying',
    recovering: 'Recovering',
    paused: 'Paused',
    completing: 'Completing',
    completed: 'Completed',
    attention: 'Needs Attention',
    failed: 'Failed',
    cancelled: 'Cancelled',
    stalled: 'Stalled',
  };
  return labels[status];
}

/**
 * Get the tone/color for a global run status.
 */
export function getRunStatusTone(status: GlobalRunStatus): 'accent' | 'ok' | 'warn' | 'err' | 'neutral' {
  switch (status) {
    case 'preparing':
    case 'planning':
    case 'executing':
    case 'verifying':
      return 'accent';
    case 'recovering':
      return 'warn';
    case 'paused':
      return 'neutral';
    case 'completing':
      return 'accent';
    case 'completed':
      return 'ok';
    case 'attention':
      return 'warn';
    case 'failed':
      return 'err';
    case 'cancelled':
      return 'neutral';
    case 'stalled':
      return 'warn';
  }
}

/**
 * Determine if the run status should show a pulse animation.
 */
export function shouldPulse(status: GlobalRunStatus): boolean {
  return ['preparing', 'planning', 'executing', 'verifying', 'recovering', 'completing'].includes(status);
}

/**
 * Get a detailed description of the current run phase.
 */
export function getRunPhaseDescription(
  status: GlobalRunStatus,
  run: Run,
  tasks: Task[]
): string {
  const runningTask = tasks.find(t => t.status === 'running');
  
  switch (status) {
    case 'preparing':
      return 'Understanding objective and selecting tools';
    case 'planning':
      return 'Breaking down into executable tasks';
    case 'executing':
      return runningTask ? runningTask.title : 'Executing tasks';
    case 'verifying':
      return runningTask ? runningTask.title : 'Running quality checks';
    case 'recovering':
      return `Self-repair cycle ${run.repairCycles}: fixing issues`;
    case 'completing':
      return 'Finalizing and generating report';
    case 'completed':
      return 'All tasks completed successfully';
    case 'attention':
      return run.summary || 'Some quality gates failed';
    case 'failed':
      return run.summary || 'Execution failed';
    case 'cancelled':
      return 'Execution cancelled by user';
    case 'stalled':
      return 'No progress detected - investigating';
    case 'paused':
      return 'Execution paused';
  }
}
