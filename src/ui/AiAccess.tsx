import { useState } from 'react';
import { loadWorkshopCode, loadWorkshopName, saveWorkshopCode, saveWorkshopName, useWorkshopStatus, validateWorkshopCode, WorkshopError } from '../apps/workshop';
import { saveOwnKey } from '../apps/deepseek';

const fmtEnd = (t?: number) => (t ? new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Where a student enters what the AI needs. During a workshop that is the instructor's access code; otherwise (and always
 * on request) it is the student's own DeepSeek key, exactly as before.
 */
export function AiAccess({ needKey, ownKey, setOwnKey, testId }: { needKey: boolean; ownKey: string; setOwnKey: (k: string) => void; testId?: string }) {
  const w = useWorkshopStatus();
  const [code, setCode] = useState(() => loadWorkshopCode());
  const [name, setName] = useState(() => loadWorkshopName());
  const [useOwn, setUseOwn] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' | 'checking' | 'ok' | 'bad'; text?: string }>({ kind: 'idle' });

  const keyField = (
    <label className="field"><span>Your DeepSeek key (kept only in this browser)</span>
      <input type="password" value={ownKey} onChange={(e) => { setOwnKey(e.target.value); saveOwnKey(e.target.value); }} placeholder="sk-…" data-testid={testId} autoComplete="off" />
      <span className="caption" data-testid="key-help">Get a key at <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">platform.deepseek.com</a>. Running the lab on your own computer? Put <code>DEEPSEEK_API_KEY=your-key</code> in a file named <code>.env.local</code> in the project folder instead, restart, and nothing needs pasting.</span></label>
  );
  if (!w.available) return needKey ? keyField : null;
  if (useOwn) return (<>{keyField}<button className="btn sm" onClick={() => setUseOwn(false)}>Use the workshop access code instead</button></>);
  if (!needKey && state.kind !== 'ok' && (loadWorkshopCode() || ownKey)) return null; // already set up: stay out of the way

  const check = async () => {
    const c = code.trim(); if (!c) return;
    setState({ kind: 'checking' });
    try { const r = await validateWorkshopCode(c, name); saveWorkshopCode(c); saveWorkshopName(name.trim()); setState({ kind: 'ok', text: `Code accepted. ${r.remainingRequests} AI requests left.` }); }
    catch (e) { saveWorkshopCode(''); setState({ kind: 'bad', text: e instanceof WorkshopError ? e.message : 'Could not check the code.' }); }
  };
  return (
    <div className="field" data-testid="ws-access">
      <span>Workshop access code{w.endsAt ? ` (workshop open until ${fmtEnd(w.endsAt)})` : ''}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="text" value={code} onChange={(e) => { setCode(e.target.value); setState({ kind: 'idle' }); }} onKeyDown={(e) => e.key === 'Enter' && void check()} placeholder="ABCDE-FGHJK" autoComplete="off" spellCheck={false} data-testid="ws-code" style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => void check()} disabled={state.kind === 'checking'} data-testid="ws-check">{state.kind === 'checking' ? 'Checking…' : 'Use code'}</button>
      </div>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" maxLength={30} autoComplete="off" data-testid="ws-name" />
      <span className="caption" data-testid="ws-privacy">With a code, your instructor can see your name (if you add one), your approximate city and country, when you were last active and how much AI you used. That is all, it is only recorded when you use a code{w.retentionDays ? `, and it is deleted ${w.retentionDays} days after the workshop` : ''}.</span>
      {state.text && <span className="caption" role="status" style={{ color: state.kind === 'bad' ? '#c4271c' : undefined }} data-testid="ws-msg">{state.text}</span>}
      <button className="btn sm" onClick={() => setUseOwn(true)} style={{ justifySelf: 'start' }}>Use my own DeepSeek key instead</button>
    </div>
  );
}
