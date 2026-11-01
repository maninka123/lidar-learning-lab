import { KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { chatDeepSeek, ChatMsg, NoKeyError } from '../apps/deepseek';
import { Markdown } from './Markdown';
import { AiAccess } from './AiAccess';
import { noKeyMessage } from '../apps/workshop';

export interface Turn { role: 'user' | 'assistant'; content: string; meta?: string }
const KEPT = new Map<string, Turn[]>(); // conversations survive switching tabs

/** A chat with the language model: your questions on the right, its answers on the left, and the conversation goes on. */
export function Chat({ id, system, suggestions, ownKey, setOwnKey, title = 'Ask anything', placeholder = 'Ask anything…', headerExtra, disabledReason, maxHistory = 14 }: {
  id: string; system: string; suggestions: string[]; ownKey: string; setOwnKey: (k: string) => void; title?: string; placeholder?: string; headerExtra?: ReactNode; disabledReason?: string; maxHistory?: number;
}) {
  const [turns, setTurns] = useState<Turn[]>(() => KEPT.get(id) ?? []);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [needKey, setNeedKey] = useState(false);
  const end = useRef<HTMLDivElement>(null), box = useRef<HTMLTextAreaElement>(null), scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { KEPT.set(id, turns); }, [id, turns]);
  useEffect(() => { const s = scroller.current; if (s) s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' }); }, [turns, busy, err]);
  useEffect(() => { const t = box.current; if (!t) return; t.style.height = 'auto'; t.style.height = `${Math.min(120, t.scrollHeight)}px`; }, [text]);

  async function send(q: string) {
    const question = q.trim(); if (!question || busy || disabledReason) return;
    const next: Turn[] = [...turns, { role: 'user', content: question }];
    setTurns(next); setText(''); setBusy(true); setErr(null); setNeedKey(false);
    const history: ChatMsg[] = next.slice(-maxHistory).map((t) => ({ role: t.role, content: t.content }));
    try {
      const r = await chatDeepSeek([{ role: 'system', content: system }, ...history], 900, ownKey);
      setTurns([...next, { role: 'assistant', content: r.text.trim() || '(empty answer)', meta: `${r.promptTokens.toLocaleString('en-US')} tokens read · ${r.completionTokens.toLocaleString('en-US')} written · ${(r.ms / 1000).toFixed(1)} s` }]);
    } catch (e) {
      if (e instanceof NoKeyError) { setNeedKey(true); setErr(noKeyMessage('Send')); } else setErr((e as Error).message);
    } finally { setBusy(false); box.current?.focus(); }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } };
  const lastUser = [...turns].reverse().find((t) => t.role === 'user')?.content;

  return (
    <div className="chat" data-testid={`${id}-chat`}>
      <div className="chat-head">
        <b>{title}</b>
        <span style={{ flex: 1 }} />
        {headerExtra}
        {turns.length > 0 && <button className="chat-link" onClick={() => { setTurns([]); setErr(null); setNeedKey(false); }} data-testid={`${id}-new`}>New chat</button>}
      </div>
      <div className="chat-scroll" ref={scroller} data-testid={`${id}-messages`}>
        {turns.length === 0 && !busy && (
          <div className="chat-empty">
            <b>Ask the AI anything</b>
            <span>It remembers the conversation, so you can keep asking follow-up questions.</span>
            <div className="chat-chips">{suggestions.map((s) => <button key={s} className="chip" onClick={() => void send(s)} disabled={!!disabledReason}>{s}</button>)}</div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`chat-row ${t.role}`}>
            <div className={`bub ${t.role}`} data-testid={t.role === 'assistant' ? `${id}-answer` : `${id}-ask`}>
              {t.role === 'assistant' ? <Markdown text={t.content} /> : t.content}
            </div>
            {t.meta && <span className="chat-meta">{t.meta}</span>}
          </div>
        ))}
        {busy && <div className="chat-row assistant"><div className="bub assistant" aria-label="The AI is writing"><span className="typing"><i /><i /><i /></span></div></div>}
        {err && (
          <div className="chat-row assistant">
            <div className="bub error" role="alert">{err}{lastUser && !needKey && <> <button className="chat-link" onClick={() => { setTurns(turns.slice(0, -1)); void send(lastUser); }}>Try again</button></>}</div>
          </div>
        )}
        <div ref={end} />
      </div>
      {needKey && <AiAccess needKey ownKey={ownKey} setOwnKey={(k) => { setOwnKey(k); if (k) { setNeedKey(false); setErr(null); } }} />}
      {disabledReason && <span className="caption" style={{ padding: '0 4px' }}>{disabledReason}</span>}
      <span className="chat-model" data-testid={`${id}-model`}>DeepSeek V4 Flash</span>
      <div className="chat-input">
        <textarea ref={box} rows={1} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} disabled={busy || !!disabledReason} aria-label="Your message" data-testid={`${id}-input`} />
        <button className="chat-send" onClick={() => void send(text)} disabled={busy || !text.trim() || !!disabledReason} aria-label="Send" data-testid={`${id}-send`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </div>
    </div>
  );
}
