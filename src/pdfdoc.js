// A small PDF drawing kit for the reports the LIMS makes itself (the short
// client report). No outside packages: it embeds the Montserrat fonts the LIMS
// already serves, draws text, shapes and PNG pictures, and measures text so it
// can be wrapped. Positions are in points from the top-left corner of an A4 page.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const A4 = { w: 595.28, h: 841.89 };
const STATIC = path.join(__dirname, 'web', 'static');

// ---------- Text encoding (WinAnsi, the simple-font encoding every reader knows) ----------
const WIN_HIGH = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
const WIN_TO_UNI = {};
for (const [u, b] of Object.entries(WIN_HIGH)) WIN_TO_UNI[b] = Number(u);
// Characters outside WinAnsi, spelled so nothing prints as "?".
const SPELL = { 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'κ': 'kappa', 'μ': 'micro', '≥': '>=', '≤': '<=', '→': '-', '←': '-', '‐': '-', '‑': '-', '−': '-', '₂': '2', '₃': '3', ' ': ' ', '​': '' };

function winAnsi(str) {
  const out = [];
  for (const ch of String(str).normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (WIN_HIGH[c]) out.push(WIN_HIGH[c]);
    else if (SPELL[ch] != null) for (const s of SPELL[ch]) out.push(s.charCodeAt(0));
    else if (c === 0x09 || c === 0x0a) out.push(0x20);
    else out.push(0x3f);
  }
  return out;
}

// ---------- TrueType metrics ----------
function readFont(file) {
  const buf = fs.readFileSync(file);
  const tables = {};
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const at = 12 + 16 * i;
    tables[buf.toString('latin1', at, at + 4)] = { off: buf.readUInt32BE(at + 8), len: buf.readUInt32BE(at + 12) };
  }
  const head = tables.head.off;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const bbox = [36, 38, 40, 42].map((o) => buf.readInt16BE(head + o));
  const hhea = tables.hhea.off;
  const ascent = buf.readInt16BE(hhea + 4);
  const descent = buf.readInt16BE(hhea + 6);
  const numH = buf.readUInt16BE(hhea + 34);
  const hmtx = tables.hmtx.off;
  const adv = (g) => buf.readUInt16BE(hmtx + 4 * Math.min(g, numH - 1));
  // cmap: Windows Unicode BMP, format 4.
  const cmap = tables.cmap.off;
  let sub = null;
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const at = cmap + 4 + 8 * i;
    const off = cmap + buf.readUInt32BE(at + 4);
    if (buf.readUInt16BE(at) === 3 && buf.readUInt16BE(at + 2) === 1 && buf.readUInt16BE(off) === 4) sub = off;
  }
  if (sub == null) throw new Error(`No Unicode map in ${path.basename(file)}`);
  const segX2 = buf.readUInt16BE(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  const glyph = (u) => {
    for (let i = 0; i < segX2 / 2; i++) {
      const end = buf.readUInt16BE(ends + 2 * i);
      if (u > end) continue;
      const start = buf.readUInt16BE(starts + 2 * i);
      if (u < start) return 0;
      const delta = buf.readInt16BE(deltas + 2 * i);
      const ro = buf.readUInt16BE(ranges + 2 * i);
      if (!ro) return (u + delta) & 0xffff;
      const g = buf.readUInt16BE(ranges + 2 * i + ro + 2 * (u - start));
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  // Widths of WinAnsi codes 32..255, in thousandths of the font size.
  const widths = [];
  for (let b = 32; b <= 255; b++) {
    const u = WIN_TO_UNI[b] || b;
    widths.push(Math.round((adv(glyph(u)) * 1000) / unitsPerEm));
  }
  const scale = (v) => Math.round((v * 1000) / unitsPerEm);
  return { buf, widths, bbox: bbox.map(scale), ascent: scale(ascent), descent: scale(descent), name: /700/.test(file) ? 'Montserrat-Bold' : 'Montserrat-Regular' };
}

let FONTS = null;
function fonts() {
  if (!FONTS) {
    FONTS = {
      regular: readFont(path.join(STATIC, 'montserrat-400.ttf')),
      bold: readFont(path.join(STATIC, 'montserrat-700.ttf')),
    };
  }
  return FONTS;
}

// ---------- PNG pictures ----------
function readPng(data) {
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG picture.');
  let pos = 8;
  let w = 0; let h = 0; let depth = 0; let type = 0; let interlace = 0;
  const idat = [];
  while (pos < data.length) {
    const len = data.readUInt32BE(pos);
    const kind = data.toString('latin1', pos + 4, pos + 8);
    const body = data.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    if (kind === 'IDAT') idat.push(body);
    if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || ![2, 6].includes(type) || interlace) throw new Error('Only 8-bit RGB or RGBA, non-interlaced PNG pictures can be used.');
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0;
      const b = y ? px[dst - stride + x] : 0;
      const c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 0xff;
    }
  }
  const rgb = Buffer.alloc(w * h * 3);
  const alpha = bpp === 4 ? Buffer.alloc(w * h) : null;
  for (let i = 0; i < w * h; i++) {
    rgb[3 * i] = px[bpp * i]; rgb[3 * i + 1] = px[bpp * i + 1]; rgb[3 * i + 2] = px[bpp * i + 2];
    if (alpha) alpha[i] = px[4 * i + 3];
  }
  return { w, h, rgb: zlib.deflateSync(rgb), alpha: alpha && zlib.deflateSync(alpha) };
}

// ---------- The document ----------
const num = (v) => (Math.round(v * 100) / 100).toString();
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#000000');
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => num(v)).join(' ');
}

class Doc {
  constructor({ title = '', author = 'MyDNAPedia', subject = '' } = {}) {
    this.meta = { title, author, subject };
    this.pages = [];
    this.images = [];
    this.f = fonts();
    this.W = A4.w;
    this.H = A4.h;
  }

  addPage() { this.page = { ops: [] }; this.pages.push(this.page); return this.page; }
  op(s) { this.page.ops.push(s); }

  width(text, size = 10, bold = false) {
    const w = (bold ? this.f.bold : this.f.regular).widths;
    let total = 0;
    for (const b of winAnsi(text)) total += w[b - 32] || 0;
    return (total * size) / 1000;
  }

  // Splits text into lines no wider than maxW.
  wrap(text, maxW, size = 10, bold = false) {
    const lines = [];
    for (const para of String(text || '').split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (this.width(next, size, bold) <= maxW || !line) line = next;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }

  text(x, y, str, { size = 10, bold = false, color = '#1f2a44', align = 'left' } = {}) {
    const bytes = winAnsi(str);
    if (!bytes.length) return;
    let dx = x;
    if (align !== 'left') { const w = this.width(str, size, bold); dx = align === 'right' ? x - w : x - w / 2; }
    const hex = Buffer.from(bytes).toString('hex');
    this.op(`BT ${rgb(color)} rg /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(dx)} ${num(this.H - y)} Td <${hex}> Tj ET`);
  }

  // Wrapped text; returns the height used. y is the top of the first line.
  para(x, y, str, maxW, { size = 10, bold = false, color, lead = 1.38 } = {}) {
    const lines = this.wrap(str, maxW, size, bold);
    lines.forEach((l, i) => this.text(x, y + size + i * size * lead, l, { size, bold, color }));
    return lines.length * size * lead;
  }

  paraHeight(str, maxW, { size = 10, bold = false, lead = 1.38 } = {}) {
    return this.wrap(str, maxW, size, bold).length * size * lead;
  }

  rect(x, y, w, h, { fill, stroke, lineWidth = 0.8, r = 0 } = {}) {
    const Y = this.H - y - h;
    let p;
    if (r) {
      const k = r * 0.5523;
      p = `${num(x + r)} ${num(Y)} m ${num(x + w - r)} ${num(Y)} l ${num(x + w - r + k)} ${num(Y)} ${num(x + w)} ${num(Y + r - k)} ${num(x + w)} ${num(Y + r)} c `
        + `${num(x + w)} ${num(Y + h - r)} l ${num(x + w)} ${num(Y + h - r + k)} ${num(x + w - r + k)} ${num(Y + h)} ${num(x + w - r)} ${num(Y + h)} c `
        + `${num(x + r)} ${num(Y + h)} l ${num(x + r - k)} ${num(Y + h)} ${num(x)} ${num(Y + h - r + k)} ${num(x)} ${num(Y + h - r)} c `
        + `${num(x)} ${num(Y + r)} l ${num(x)} ${num(Y + r - k)} ${num(x + r - k)} ${num(Y)} ${num(x + r)} ${num(Y)} c h`;
    } else p = `${num(x)} ${num(Y)} ${num(w)} ${num(h)} re`;
    this.paint(p, fill, stroke, lineWidth);
  }

  circle(cx, cy, r, { fill, stroke, lineWidth = 0.8 } = {}) {
    const Y = this.H - cy;
    const k = r * 0.5523;
    const p = `${num(cx + r)} ${num(Y)} m ${num(cx + r)} ${num(Y + k)} ${num(cx + k)} ${num(Y + r)} ${num(cx)} ${num(Y + r)} c `
      + `${num(cx - k)} ${num(Y + r)} ${num(cx - r)} ${num(Y + k)} ${num(cx - r)} ${num(Y)} c `
      + `${num(cx - r)} ${num(Y - k)} ${num(cx - k)} ${num(Y - r)} ${num(cx)} ${num(Y - r)} c `
      + `${num(cx + k)} ${num(Y - r)} ${num(cx + r)} ${num(Y - k)} ${num(cx + r)} ${num(Y)} c h`;
    this.paint(p, fill, stroke, lineWidth);
  }

  line(x1, y1, x2, y2, { color = '#d6dae3', lineWidth = 0.8 } = {}) {
    this.op(`q ${rgb(color)} RG ${num(lineWidth)} w ${num(x1)} ${num(this.H - y1)} m ${num(x2)} ${num(this.H - y2)} l S Q`);
  }

  paint(p, fill, stroke, lineWidth) {
    if (!fill && !stroke) return;
    const parts = ['q'];
    if (fill) parts.push(`${rgb(fill)} rg`);
    if (stroke) parts.push(`${rgb(stroke)} RG ${num(lineWidth)} w`);
    parts.push(p, fill && stroke ? 'B' : fill ? 'f' : 'S', 'Q');
    this.op(parts.join(' '));
  }

  // Registers a PNG once; draw it with image().
  png(data) { const img = readPng(data); this.images.push(img); return this.images.length; }
  image(id, x, y, w, h) { this.op(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.H - y - h)} cm /Im${id} Do Q`); }

  save() {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const stream = (dict, data) => ({ dict: `<< ${dict} /Length ${data.length} >>`, data });
    const catalog = add(null);
    const pagesRef = add(null);
    const fontRef = {};
    for (const [key, f] of [['F1', this.f.regular], ['F2', this.f.bold]]) {
      const file = add(stream(`/Filter /FlateDecode /Length1 ${f.buf.length}`, zlib.deflateSync(f.buf)));
      const desc = add(`<< /Type /FontDescriptor /FontName /${f.name} /Flags 32 /FontBBox [${f.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight 700 /StemV ${key === 'F2' ? 140 : 80} /FontFile2 ${file} 0 R >>`);
      fontRef[key] = add(`<< /Type /Font /Subtype /TrueType /BaseFont /${f.name} /FirstChar 32 /LastChar 255 /Widths [${f.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${desc} 0 R >>`);
    }
    const imgRefs = this.images.map((img) => {
      const smask = img.alpha ? add(stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, img.alpha)) : null;
      return add(stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${smask ? ` /SMask ${smask} 0 R` : ''}`, img.rgb));
    });
    const xobj = imgRefs.length ? ` /XObject << ${imgRefs.map((r, i) => `/Im${i + 1} ${r} 0 R`).join(' ')} >>` : '';
    const kids = this.pages.map((pg) => {
      const content = add(stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(pg.ops.join('\n'), 'latin1'))));
      return add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${num(this.W)} ${num(this.H)}] /Resources << /Font << /F1 ${fontRef.F1} 0 R /F2 ${fontRef.F2} 0 R >>${xobj} >> /Contents ${content} 0 R >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRef} 0 R >>`;
    objs[pagesRef - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const pdfStr = (s) => `<FEFF${Buffer.from(String(s), 'utf16le').swap16().toString('hex')}>`;
    const info = add(`<< /Title ${pdfStr(this.meta.title)} /Author ${pdfStr(this.meta.author)} /Subject ${pdfStr(this.meta.subject)} /Creator (MyDNAPedia LIMS) /Producer (MyDNAPedia LIMS) >>`);
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
}

module.exports = { Doc, winAnsi, readFont, readPng, A4 };
