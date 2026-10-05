// Writes a plain text PDF (Helvetica, A4). Used for the dummy reports in the
// demo data and in tests; real reports come from the partner lab or Report Studio.
const zlib = require('node:zlib');

function esc(s) {
  return String(s).replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7e]/g, '?');
}

// pages: array of arrays of lines; a line is a string or { text, size, bold }.
function write(pages, { title = '', author = '', producer = 'MyDNAPedia LIMS' } = {}) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const lines of pages) {
    let y = 800;
    let ops = '';
    for (const l of lines) {
      const line = typeof l === 'string' ? { text: l } : l;
      const size = line.size || 11;
      ops += `BT /${line.bold ? 'F2' : 'F1'} ${size} Tf 50 ${y} Td (${esc(line.text)}) Tj ET\n`;
      y -= size + 7;
    }
    const data = zlib.deflateSync(Buffer.from(ops, 'latin1'));
    const content = add({ dict: `<< /Length ${data.length} /Filter /FlateDecode >>`, data });
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${esc(title)}) /Author (${esc(author)}) /Producer (${esc(producer)}) >>`);
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(offset);
    const head = `${i + 1} 0 obj\n`;
    const buf = typeof o === 'string'
      ? Buffer.from(`${head}${o}\nendobj\n`, 'latin1')
      : Buffer.concat([Buffer.from(`${head}${o.dict}\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    parts.push(buf);
    offset += buf.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

module.exports = { write };
