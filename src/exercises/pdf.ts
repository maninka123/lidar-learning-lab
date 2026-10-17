/** Tiny dependency-free PDF writer (Helvetica text only) for the exercise summary. */
export function makePdf(title: string, lines: string[]): Blob {
  const esc = (t: string) => t.replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const wrap = (t: string, n = 92): string[] => {
    const out: string[] = []; let cur = '';
    for (const w of t.split(' ')) { if ((cur + ' ' + w).length > n) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
    if (cur) out.push(cur);
    return out;
  };
  const all = lines.flatMap((l) => (l === '' ? [''] : wrap(l)));
  const perPage = 46;
  const pages: string[][] = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  if (!pages.length) pages.push([]);
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages placeholder
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  pages.forEach((p, pi) => {
    let content = `BT /F1 16 Tf 50 800 Td (${esc(title)}) Tj ET\n`;
    if (pi > 0) content = '';
    let y = pi === 0 ? 775 : 800;
    for (const l of p) { content += `BT /F1 10 Tf 50 ${y} Td (${esc(l)}) Tj ET\n`; y -= 16; }
    const cn = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${cn} 0 R >>`));
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}
