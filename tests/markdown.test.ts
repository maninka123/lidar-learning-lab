import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/ui/Markdown';

const html = (t: string) => renderToStaticMarkup(createElement(Markdown, { text: t }));

describe('Markdown tables', () => {
  const answer = `Objects (approximate positions, x, y in metres):

| Object | Position | Evidence |
|---|---|---|
| **Large blue-grey structure** (partition) | Spans from (-3.5, 2.5) to (1, 5.5) | Dense cluster at z 0.7–2.3 |
| **Brown floor covering** | Entire floor | Uniform brown points |
| **Ceiling** | z≈2.3–2.4 | Uniform light grey points |

What I cannot tell: the labels.`;
  it('turns a pipe table into a real table with header and body rows', () => {
    const h = html(answer);
    expect(h).toContain('<table');
    expect((h.match(/<th[ >]/g) ?? []).length).toBe(3);
    expect((h.match(/<tr/g) ?? []).length).toBe(4);
    expect(h).toContain('<b>Large blue-grey structure</b>');
    expect(h).not.toContain('|---|');
    expect(h).toContain('What I cannot tell');
  });
  it('handles alignment, ragged rows and a table without outer pipes', () => {
    const h = html('Name | Value\n:--- | ---:\nA | 1\nB | 2\nC');
    expect(h).toContain('<table'); expect(h).toContain('text-align:right');
    expect((h.match(/<td/g) ?? []).length).toBe(4);
  });
  it('does not turn ordinary text with a pipe into a table', () => {
    expect(html('a | b in the middle of a sentence')).not.toContain('<table');
  });
});
