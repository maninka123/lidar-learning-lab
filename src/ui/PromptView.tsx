import { useState } from 'react';
import { Btn } from './controls';
import { DEEPSEEK_MODEL } from '../apps/deepseek';

/** Shows the exact prompt that is sent, laid out as a chat: the system message, then the user message. Long data is cut short on screen (all of it is sent). */
export function PromptView({ system, user, testId }: { system: string; user: string; testId: string }) {
  const [open, setOpen] = useState(false);
  const cut = (t: string) => { const lines = t.split('\n'); return lines.length > 14 ? `${lines.slice(0, 12).join('\n')}\n… (${lines.length - 12} more lines, all are sent)` : t; };
  const box: React.CSSProperties = { margin: 0, padding: '8px 10px', borderRadius: 10, whiteSpace: 'pre-wrap', fontSize: '0.8125rem', maxHeight: 260, overflow: 'auto' };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Btn sm onClick={() => setOpen(!open)} testId={testId}>{open ? 'Hide the prompt' : 'Show the prompt'}</Btn>
      {open && (
        <div className="callout" style={{ gap: 8 }} data-testid={`${testId}-text`}>
          <b>The prompt sent to {DEEPSEEK_MODEL}</b>
          <div><span className="caption"><b>1 · System</b> (sets the role)</span><pre className="mono" style={{ ...box, background: '#eef3ff' }}>{system}</pre></div>
          <div><span className="caption"><b>2 · User</b> (the question and the data)</span><pre className="mono" style={{ ...box, background: '#f5f5f7' }}>{cut(user)}</pre></div>
        </div>
      )}
    </div>
  );
}
