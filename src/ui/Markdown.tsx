import { Fragment, ReactNode } from 'react';

/** A small Markdown renderer for model answers: headings, bold / italic / code, bullet and numbered lists, rules and paragraphs. */
function inline(t: string): ReactNode[] {
  const out: ReactNode[] = [], re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(t))) {
    if (m.index > last) out.push(t.slice(last, m.index));
    const x = m[0];
    out.push(x.startsWith('**') ? <b key={k++}>{x.slice(2, -2)}</b> : x.startsWith('`') ? <code key={k++} className="mono" style={{ background: '#eef0f4', borderRadius: 5, padding: '0 4px' }}>{x.slice(1, -1)}</code> : <i key={k++}>{x.slice(1, -1)}</i>);
    last = m.index + x.length;
  }
  if (last < t.length) out.push(t.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n'), blocks: ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { const size = [1.15, 1.05, 0.98, 0.95][h[1].length - 1]; blocks.push(<div key={k++} style={{ fontWeight: 700, fontSize: `${size}rem`, margin: '6px 0 2px' }}>{inline(h[2])}</div>); i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(l)) { blocks.push(<hr key={k++} style={{ border: 0, borderTop: '1px solid #d9d9de', margin: '6px 0' }} />); i++; continue; }
    const ul = /^\s*[-*•]\s+/, ol = /^\s*\d+[.)]\s+/;
    if (ul.test(l) || ol.test(l)) {
      const ordered = ol.test(l), items: string[] = [];
      while (i < lines.length && (ordered ? ol : ul).test(lines[i])) { items.push(lines[i].replace(ordered ? ol : ul, '')); i++; }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={k++} style={{ margin: '2px 0', paddingLeft: '1.25rem', display: 'grid', gap: 3 }}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</Tag>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !ul.test(lines[i]) && !ol.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(<p key={k++} style={{ margin: '2px 0' }}>{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p)}</Fragment>)}</p>);
  }
  return <div style={{ display: 'grid', gap: 4, lineHeight: 1.45 }}>{blocks}</div>;
}
