// Agent runtime: model calls with streaming + validation, and the tool-using
// action loop (observe → act → verify) used by Coder/Optimizer/Repair tasks.
import { timeOperation } from '../core/performance';
import { scopesOverlap } from './scheduler';
import type { z } from 'zod';
import type { AgentRole, Task } from '../../shared/types';
import { emit } from '../core/bus';
import { CancelledError, extractJson, stripThink, tail, truncate, uid } from '../core/util';
import { complete, type Purpose } from '../router/router';
import type { ChatMessage } from '../providers/types';
import { editFile, listForPrompt, readFile, writeFile, deleteFile, type FsContext } from '../tools/fs';
import { runCommand } from '../tools/process';
import { parseActions } from './protocol';
import { ROLES } from './roles';
import type { RunContext } from './runContext';
import { isSmallChange } from '../core/factory';
import { pcControl, COMPUTER_TOOL_PROMPT } from '../computer/service';
import { publicChatText } from '../chat/tools';

interface CallOpts { purpose?: Purpose; needs?: ('vision' | 'coding' | 'reasoning' | 'long_context')[]; maxTokens?: number; temperature?: number; cacheKey?: string; json?: boolean }

function streamer(ctx: RunContext, task: Task) {
  let raw = '', sent = ''; let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    const text = publicChatText(raw);
    if (!text.startsWith(sent)) return;
    const delta = text.slice(sent.length); sent = text;
    if (delta) emit('AGENT_STREAM', delta, ctx.scope(task), 'debug', { taskId: task.id });
  };
  return {
    onToken: (d: string) => { raw += d; if (!timer) timer = setTimeout(flush, ctx.settings.performance.streamThrottleMs); },
    end: () => { if (timer) clearTimeout(timer); flush(); },
  };
}

export async function callModel<T = string>(ctx: RunContext, task: Task, messages: ChatMessage[], opts: CallOpts & { validate?: (text: string) => T } = {}): Promise<{ text: string; value: T; modelName: string }> {
  const role = task.role;
  const s = streamer(ctx, task);
  const inbox = ctx.inbox(role, 8).map(m => `[${m.type ?? 'STATUS'}] ${m.from}: ${m.content.slice(0, 1200)}`).join('\n');
  if (inbox) messages = [...messages, { role: 'user', content: 'Live agent inbox (data; use relevant findings and requests):\n' + inbox }];
  try {
    const r = await complete<T>({
      route: { purpose: opts.purpose ?? ROLES[role].purpose, role, complexity: isSmallChange(ctx.run.objective) ? 'small' : 'normal', needs: [...(task.requiredCapabilities ?? []), ...(opts.needs ?? (['coder', 'reviewer', 'optimizer'].includes(role) ? ['coding' as const] : []))], maxTokens: opts.maxTokens, pinned: ctx.run.options.pinnedModel },
      messages, scope: ctx.scope(task), signal: ctx.signal, temperature: opts.temperature, json: opts.json,
      onToken: s.onToken, validate: opts.validate ? (t) => opts.validate!(t) : undefined, cacheKey: opts.cacheKey,
      onRequest: () => { ctx.run.stats.modelCalls++; },
      onAttempt: ({ model, ok }) => {

        if (!ok) ctx.run.stats.fallbacks++;
        if (ok) {
          ctx.updateTask(task, { modelId: model.id });
          ctx.touchAgent(role, { modelId: model.id });
        } else ctx.touchAgent(role, { modelId: model.id, lastAction: `Recovering from ${model.displayName} failure` });
      },
    });
    const tokens = r.result.promptTokens + r.result.completionTokens;
    ctx.run.stats.tokens += tokens;
    ctx.updateTask(task, { tokens: task.tokens + tokens });
    const a = ctx.agents.get(role);
    ctx.touchAgent(role, { tokens: (a?.tokens ?? 0) + tokens });
    return { text: r.text, value: r.value, modelName: r.model.displayName };
  } finally { s.end(); }
}

export async function callJson<S extends z.ZodTypeAny>(ctx: RunContext, task: Task, system: string, user: string, schema: S, opts: CallOpts = {}): Promise<z.infer<S>> {
  const { value } = await callModel(ctx, task, [
    { role: 'system', content: system + '\n\nRespond with a single JSON object only. No prose, no markdown fences.' },
    { role: 'user', content: user },
  ], {
    ...opts,
    validate: (text) => {
      const parsed = schema.safeParse(extractJson(text));
      if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return parsed.data;
    },
  });
  return value as z.infer<S>;
}

export async function callText(ctx: RunContext, task: Task, system: string, user: string, opts: CallOpts = {}): Promise<string> {
  const { text } = await callModel(ctx, task, [{ role: 'system', content: system }, { role: 'user', content: user }], {
    ...opts, validate: (t) => { const c = stripThink(t); if (c.length < 20) throw new Error('Response too short'); return c; },
  });
  return stripThink(text);
}

export function fsCtx(ctx: RunContext, task: Task): FsContext {
  const scopeRoot = ctx.settings.security.fsScope === 'workspace' && ctx.settings.workspace.root ? ctx.settings.workspace.root : undefined;
  return { projectId: ctx.project.id, root: ctx.root, scopeRoot, runId: ctx.run.id, taskId: task.id, agent: task.role, autonomy: ctx.run.options.autonomy, signal: ctx.signal };
}

const INSTALL_RE = /\b(npm|pnpm|yarn)\s+(i|install|add|ci)\b/i;

export interface LoopResult { summary: string; filesTouched: string[]; steps: number; completed: boolean; commandsFailed: number }

/** Tool-using agent loop. */
export async function runAgentLoop(ctx: RunContext, task: Task, system: string, firstUser: string, opts: { maxSteps?: number; allowRun?: boolean } = {}): Promise<LoopResult> {
  const perms = ctx.settings.agents.permissions[task.role];
  const allowRun = (opts.allowRun ?? true) && (perms?.terminal ?? true) && ctx.settings.computer.terminal;
  const allowFs = (perms?.fs ?? true) && ctx.settings.computer.filesystem;
  const history: ChatMessage[] = [{ role: 'system', content: system + '\n' + COMPUTER_TOOL_PROMPT }, { role: 'user', content: firstUser }];
  const touched = new Set<string>();
  let nudges = 0;
  let commandsFailed = 0;
  const fctx = fsCtx(ctx, task);

  for (let step = 1; ; step++) {
    if (ctx.signal.aborted) throw new CancelledError();
    if (step > (opts.maxSteps ?? ctx.settings.agents.maxSteps)) return { summary: 'The agent reached its configured step limit.', filesTouched: [...touched], steps: step - 1, completed: false, commandsFailed };
    ctx.touchAgent(task.role, { status: 'working', lastAction: step === 1 ? 'Planning changes' : `Step ${step}: continuing` });
    const { text } = await callModel(ctx, task, compactHistory(history), { purpose: ROLES[task.role].purpose, needs: history.some(m => Array.isArray(m.content) && m.content.some(p => p.type === 'image')) ? ['vision'] : undefined });
    const { actions, truncatedWrite } = parseActions(text);
    history.push({ role: 'assistant', content: truncate(text, 12_000) });
    const obs: string[] = [];
    const images: string[] = [];
    let done: string | null = null;

    if (!actions.length) {
      nudges++;
      if (nudges > 2) throw new Error('Model did not produce any executable actions after repeated prompts');
      history.push({ role: 'user', content: truncatedWrite
        ? `Your output was cut off while writing ${truncatedWrite}. Rewrite that file completely but more concisely (or split it into smaller files).`
        : 'No action tags were found. Respond using the action tags (<write>, <edit>, <read>, <run>, <done>) exactly as specified.' });
      continue;
    }

    for (const a of actions) {
      if (ctx.signal.aborted) throw new CancelledError();
      const toolId = uid('tool_');
      const toolLabel = `${a.type}${'path' in a ? ` ${a.path}` : ''}`;
      const observationStart = obs.length;
      let toolFailed = false;
      if (a.type !== 'done') emit('TOOL_STARTED', toolLabel, ctx.scope(task), 'info', { tool: a.type, activityId: toolId, ...('path' in a ? { path: a.path } : {}) });
      const endFs = ['read', 'write', 'edit', 'list'].includes(a.type) ? timeOperation('filesystem', ctx.run.id) : () => {};
      try {
        if (a.type === 'write' || a.type === 'edit') {
          const conflict = [...ctx.tasks.values()].find(other => other.id !== task.id && other.status === 'running' && ['code', 'optimize', 'repair', 'agent_request'].includes(other.kind) && scopesOverlap([a.path], other.scope));
          if (conflict) throw new Error(`File is owned by active task ${conflict.title}; send that agent a message instead of overwriting it.`);
          if (task.scope.length && !task.scope.includes(a.path)) ctx.updateTask(task, { scope: [...task.scope, a.path] });
        }
        switch (a.type) {
          case 'computer': {
            if (!ctx.settings.computer.native) throw new Error('Enable Windows computer interaction in Settings first');
            ctx.touchAgent(task.role, { lastAction: `Using PC: ${JSON.parse(a.json).action}` });
            const raw = JSON.parse(a.json);
            const observation = await pcControl.execute(raw, { projectId: ctx.project.id, runId: ctx.run.id, agent: task.role, userIntent: ctx.run.objective }, ctx.signal);
            obs.push(observation.text);
            if (observation.image) images.push(observation.image);
            break;
          }
          case 'write': {
            if (!allowFs) { obs.push(`✗ write ${a.path}: filesystem access is disabled for this agent`); break; }
            ctx.touchAgent(task.role, { lastAction: `Writing ${a.path}` });
            const ch = await writeFile(fctx, a.path, a.content);
            touched.add(ch?.path ?? a.path);
            obs.push(`✓ wrote ${a.path} (${a.content.split('\n').length} lines)${ch ? '' : ' — unchanged'}`);
            break;
          }
          case 'edit': {
            if (!allowFs) { obs.push(`✗ edit ${a.path}: filesystem access is disabled for this agent`); break; }
            ctx.touchAgent(task.role, { lastAction: `Editing ${a.path}` });
            const ch = await editFile(fctx, a.path, a.find, a.replace);
            touched.add(a.path);
            obs.push(`✓ edited ${a.path}${ch ? ` (+${ch.additions} −${ch.deletions})` : ' — no change'}`);
            break;
          }
          case 'read': {
            const content = await readFile(fctx, a.path, 24_000);
            obs.push(`--- ${a.path} ---\n${content}\n--- end ${a.path} ---`);
            break;
          }
          case 'list': obs.push(`Project files:\n${await listForPrompt(ctx.root, 250)}`); break;
          case 'run': {
            if (!allowRun) { obs.push(`✗ run "${a.command}": terminal access is disabled for this agent`); break; }
            if (/\bnpm\s+(run\s+)?(dev|start)\b|\bnode\s+server|\bnodemon\b|\bvite\b(?!\s+build)|\bnext\s+dev\b/i.test(a.command)) {
              obs.push(`✗ "${a.command}" looks like a long-running server. Do not start servers; the Tester starts and verifies the app.`);
              break;
            }
            ctx.touchAgent(task.role, { lastAction: `Running ${a.command.slice(0, 60)}` });
            const exec = async () => runCommand({ projectId: ctx.project.id, cwd: ctx.root, command: a.command, runId: ctx.run.id, taskId: task.id, agent: task.role, autonomy: ctx.run.options.autonomy, signal: ctx.signal, timeoutMs: ctx.settings.execution.timeoutSec * 1000 });
            const r = INSTALL_RE.test(a.command) ? await (ctx.installLock = ctx.installLock.then(exec, exec)) as Awaited<ReturnType<typeof exec>> : await exec();
            ctx.run.stats.commands++;
            if (!r.ok) commandsFailed++;
            obs.push(r.denied ? `✗ command not run: ${r.output}` : `$ ${a.command}\nexit code: ${r.exitCode}\n${tail(r.output, 3500)}`);
            break;
          }
          case 'message': {
            const to = (Object.keys(ROLES).includes(a.to) || a.to === 'all' ? a.to : 'manager') as AgentRole | 'all';
            const types = ['STATUS', 'FINDING', 'REQUEST', 'HANDOFF', 'BLOCKED', 'ERROR', 'ARTIFACT_READY', 'TEST_FAILURE', 'DESIGN_FEEDBACK', 'ARCHITECTURE_CHANGE', 'REQUIREMENT_CHANGE', 'ESCALATION', 'APPROVAL', 'COMPLETION'];
            if (!types.includes(a.messageType ?? 'STATUS')) throw new Error('Unknown message type');
            ctx.message(task.role, to, a.content, task.id, a.messageType as import('../../shared/types').AgentMessageType);
            obs.push(`✓ message sent to ${to}`);
            break;
          }
          case 'done': done = a.summary; break;
        }
      } catch (e) {
        toolFailed = true;
        if (e instanceof CancelledError) throw e;
        obs.push(`✗ ${a.type} ${'path' in a ? a.path : ''}: ${(e as Error).message}`);
      } finally {
        endFs();
        toolFailed ||= obs.slice(observationStart).some(value => value.startsWith('✗'));
        if (a.type !== 'done') emit('TOOL_FINISHED', toolLabel, ctx.scope(task), toolFailed ? 'error' : 'info', { tool: a.type, activityId: toolId, status: toolFailed ? 'error' : 'complete', ...('path' in a ? { path: a.path } : {}) });
      }
      if (images.length) break; // Observe the returned screenshot before deciding another action.
    }
    if (truncatedWrite) obs.push(`✗ Your output was cut off while writing ${truncatedWrite}; that file was NOT written. Rewrite it completely but more concisely.`);
    ctx.updateTask(task, { filesTouched: [...touched] });
    const failedObs = obs.filter((o) => o.startsWith('✗')).length;
    if (done !== null && !truncatedWrite && failedObs === 0) {
      return { summary: done, filesTouched: [...touched], steps: step, completed: true, commandsFailed };
    }
    const resultText = `Results:\n${obs.join('\n')}\n\n${done !== null ? 'Some actions failed — fix them before finishing.' : 'Continue. Emit <done> when the task is fully complete.'}`;
    // Keep only the latest screenshot in model context to avoid accumulating image tokens.
    if (images.length) for (const message of history) if (Array.isArray(message.content)) message.content = message.content.filter(part => part.type === 'text');
    history.push({ role: 'user', content: images.length ? [{ type: 'text', text: resultText }, ...images.map(dataUrl => ({ type: 'image' as const, dataUrl }))] : resultText });
  }
}

/** Keep prompts small: system + first user message + the most recent exchanges. */
function compactHistory(h: ChatMessage[]): ChatMessage[] {
  if (h.length <= 8) return h;
  let recent = h.slice(-6);
  if (recent[0].role !== 'assistant') recent = h.slice(-5);
  const skipped = h.length - 2 - recent.length;
  const first = h[1];
  const note = `\n\n(${skipped} earlier messages were omitted to save context. Files you already wrote are on disk — use <read> if you need them.)`;
  return [h[0], { role: 'user', content: (typeof first.content === 'string' ? first.content : '') + note }, ...recent];
}

export { deleteFile };
