import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

interface Result { workload: string; rows: { strategy: string; correct: number; cases: number; failures: number; calls: number; tokens: number; latencyMs: number }[] }
export function Experiments() {
  const ref = useRef<HTMLDialogElement>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const show = () => ref.current?.showModal();
    window.addEventListener('swarm:experiments', show);
    return () => window.removeEventListener('swarm:experiments', show);
  }, []);
  const cancel = () => { if (running) void window.swarm.invoke('experiments:cancel'); };
  const run = async () => {
    setRunning(true); setError(''); setResult(null);
    try { setResult(await window.swarm.invoke<Result>('experiments:run')); }
    catch (e) { setError(String(e)); }
    finally { setRunning(false); }
  };
  return <dialog ref={ref} onCancel={cancel} className="m-auto max-w-[90vw] w-[760px] bg-panel text-fg border border-line rounded-xl p-6 backdrop:bg-black/30">
    <h2 className="text-xl font-semibold">Routing experiments</h2>
    <p className="text-sm text-fg-2 my-3">Compare Auto, Fastest, and Quality on nine small synthetic checks using eligible free models. This consumes provider quota. Production settings stay unchanged.</p>
    {running && <p role="status" className="text-sm my-4">Running controlled checks…</p>}
    {error && <p role="alert" className="text-sm text-err my-4">{error}</p>}
    {result && <><div className="overflow-auto"><table className="w-full text-sm text-left my-4"><thead><tr>{['Strategy','Correct','Failures','Calls','Tokens','Time'].map(h => <th key={h} className="p-2 border-b border-line">{h}</th>)}</tr></thead><tbody>{result.rows.map(r => <tr key={r.strategy}><td className="p-2">{r.strategy}</td><td>{r.correct}/{r.cases}</td><td>{r.failures}</td><td>{r.calls}</td><td>{r.tokens}</td><td>{(r.latencyMs/1000).toFixed(1)}s</td></tr>)}</tbody></table></div><p className="text-xs text-fg-2">{result.workload}</p></>}
    <div className="flex justify-end gap-2 mt-5"><Button variant="ghost" onClick={() => { cancel(); ref.current?.close(); }}>Close</Button>{running ? <Button onClick={cancel}>Cancel experiment</Button> : <Button onClick={run}>Run benchmark</Button>}</div>
  </dialog>;
}
