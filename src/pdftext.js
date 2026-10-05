// Reads the text, page sizes and file properties of a PDF so a report can be
// checked before release. Only what the leak check needs: it is not a renderer.
// Handles compressed streams, object streams, Type0/CID fonts with ToUnicode
// maps, simple fonts and form XObjects. Text inside pictures cannot be read.
const zlib = require('node:zlib');

// ---------- Lexer and object parser over a latin1 string ----------

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

class Ref { constructor(num, gen) { this.num = num; this.gen = gen; } }
class Name { constructor(v) { this.v = v; } }
class Op { constructor(v) { this.v = v; } }

class Parser {
  constructor(s, pos = 0) { this.s = s; this.pos = pos; }

  skipWs() {
    const s = this.s;
    for (;;) {
      while (this.pos < s.length && WS.has(s.charCodeAt(this.pos))) this.pos++;
      if (s[this.pos] === '%') { while (this.pos < s.length && s[this.pos] !== '\n' && s[this.pos] !== '\r') this.pos++; continue; }
      return;
    }
  }

  // Next raw token: numbers, names, strings, keywords and delimiters.
  token() {
    this.skipWs();
    const s = this.s;
    if (this.pos >= s.length) return null;
    const c = s[this.pos];
    if (c === '(') return { t: 'str', v: this.literal() };
    if (c === '<') {
      if (s[this.pos + 1] === '<') { this.pos += 2; return { t: '<<' }; }
      return { t: 'str', v: this.hex() };
    }
    if (c === '>' && s[this.pos + 1] === '>') { this.pos += 2; return { t: '>>' }; }
    if (c === '[' || c === ']' || c === '{' || c === '}') { this.pos++; return { t: c }; }
    if (c === '/') {
      this.pos++;
      const start = this.pos;
      while (this.pos < s.length && !WS.has(s.charCodeAt(this.pos)) && !DELIM.has(s.charCodeAt(this.pos))) this.pos++;
      return { t: 'name', v: s.slice(start, this.pos).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
    }
    const start = this.pos;
    while (this.pos < s.length && !WS.has(s.charCodeAt(this.pos)) && !DELIM.has(s.charCodeAt(this.pos))) this.pos++;
    if (this.pos === start) { this.pos++; return { t: 'kw', v: c }; }
    const w = s.slice(start, this.pos);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { t: 'num', v: Number(w) };
    return { t: 'kw', v: w };
  }

  literal() {
    const s = this.s;
    let depth = 0;
    let out = '';
    this.pos++;
    while (this.pos < s.length) {
      const c = s[this.pos++];
      if (c === '\\') {
        const n = s[this.pos++];
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
        if (n in map) out += map[n];
        else if (/[0-7]/.test(n)) {
          let oct = n;
          while (oct.length < 3 && /[0-7]/.test(s[this.pos])) oct += s[this.pos++];
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (n === '\r') { if (s[this.pos] === '\n') this.pos++; } else if (n !== '\n') out += n;
      } else if (c === '(') { depth++; out += c; } else if (c === ')') {
        if (depth === 0) break;
        depth--; out += c;
      } else out += c;
    }
    return out;
  }

  hex() {
    const end = this.s.indexOf('>', this.pos);
    let h = this.s.slice(this.pos + 1, end < 0 ? this.s.length : end).replace(/[^0-9a-fA-F]/g, '');
    this.pos = end < 0 ? this.s.length : end + 1;
    if (h.length % 2) h += '0';
    let out = '';
    for (let i = 0; i < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
    return out;
  }

  // A full object: dict, array, ref, number, name, string, bool or null.
  value(tok = this.token()) {
    if (!tok) return null;
    switch (tok.t) {
      case '<<': {
        const d = {};
        for (;;) {
          const k = this.token();
          if (!k || k.t === '>>') return d;
          if (k.t !== 'name') continue;
          d[k.v] = this.value();
        }
      }
      case '[': {
        const a = [];
        for (;;) {
          const t = this.token();
          if (!t || t.t === ']') return a;
          a.push(this.value(t));
        }
      }
      case 'num': {
        // "n g R" is a reference.
        const save = this.pos;
        const t2 = this.token();
        if (t2 && t2.t === 'num') {
          const t3 = this.token();
          if (t3 && t3.t === 'kw' && t3.v === 'R') return new Ref(tok.v, t2.v);
        }
        this.pos = save;
        return tok.v;
      }
      case 'name': return new Name(tok.v);
      case 'str': return tok.v;
      case 'kw':
        if (tok.v === 'true') return true;
        if (tok.v === 'false') return false;
        if (tok.v === 'null') return null;
        return new Op(tok.v);
      default: return null;
    }
  }
}

// ---------- Document ----------

function decodeStream(dict, raw) {
  let data = Buffer.from(raw, 'latin1');
  let filters = dict.Filter;
  if (!filters) return data;
  if (!Array.isArray(filters)) filters = [filters];
  for (const f of filters) {
    const n = f instanceof Name ? f.v : '';
    if (n === 'FlateDecode' || n === 'Fl') {
      try { data = zlib.inflateSync(data); } catch {
        try { data = zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return null; }
      }
    } else if (n === 'ASCIIHexDecode' || n === 'AHx') {
      data = Buffer.from(data.toString('latin1').replace(/[^0-9a-fA-F]/g, ''), 'hex');
    } else if (n === 'ASCII85Decode' || n === 'A85') {
      data = ascii85(data.toString('latin1'));
    } else return null; // Images and other filters carry no text.
  }
  return data;
}

function ascii85(s) {
  s = s.replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out = [];
  let group = [];
  for (const c of s) {
    if (c === 'z' && !group.length) { out.push(0, 0, 0, 0); continue; }
    group.push(c.charCodeAt(0) - 33);
    if (group.length === 5) {
      let v = 0;
      for (const g of group) v = v * 85 + g;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n - 1));
  }
  return Buffer.from(out);
}

class Doc {
  constructor(buf) {
    this.s = buf.toString('latin1');
    this.objs = new Map(); // num -> { value, stream (raw latin1) }
    this.trailer = {};
    this.scan();
  }

  scan() {
    const s = this.s;
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(s))) {
      const p = new Parser(s, re.lastIndex);
      let value;
      try { value = p.value(); } catch { continue; }
      const entry = { value, stream: null };
      p.skipWs();
      if (s.startsWith('stream', p.pos)) {
        let start = p.pos + 6;
        if (s[start] === '\r') start++;
        if (s[start] === '\n') start++;
        const len = value && typeof value.Length === 'number' ? value.Length : -1;
        let end = -1;
        if (len >= 0 && /^\s*endstream/.test(s.slice(start + len, start + len + 20))) end = start + len;
        if (end < 0) {
          end = s.indexOf('endstream', start);
          if (end < 0) end = s.length;
          while (end > start && (s[end - 1] === '\n' || s[end - 1] === '\r')) end--;
        }
        entry.stream = s.slice(start, end);
        re.lastIndex = end;
      }
      // Later definitions (incremental updates) win.
      this.objs.set(Number(m[1]), entry);
    }
    // Trailers: classic and cross-reference streams.
    const tr = /trailer\s*<</g;
    while ((m = tr.exec(s))) {
      try { Object.assign(this.trailer, new Parser(s, m.index + 7).value()); } catch { /* ignore */ }
    }
    for (const [, e] of this.objs) {
      const v = e.value;
      if (v && v.Type instanceof Name && v.Type.v === 'XRef') {
        for (const k of ['Root', 'Info', 'Encrypt']) if (v[k] && !this.trailer[k]) this.trailer[k] = v[k];
      }
    }
    // Objects packed inside object streams.
    for (const [, e] of [...this.objs]) {
      const v = e.value;
      if (!(v && v.Type instanceof Name && v.Type.v === 'ObjStm' && e.stream != null)) continue;
      const data = decodeStream(v, e.stream);
      if (!data) continue;
      const str = data.toString('latin1');
      const head = new Parser(str);
      const pairs = [];
      for (let i = 0; i < (v.N || 0); i++) {
        const a = head.token(); const b = head.token();
        if (!a || !b) break;
        pairs.push([a.v, b.v]);
      }
      for (const [num, off] of pairs) {
        if (this.objs.has(num)) continue;
        try { this.objs.set(num, { value: new Parser(str, (v.First || 0) + off).value(), stream: null }); } catch { /* ignore */ }
      }
    }
  }

  get(v) {
    let guard = 0;
    while (v instanceof Ref && guard++ < 32) {
      const e = this.objs.get(v.num);
      v = e ? e.value : null;
    }
    return v;
  }

  streamOf(ref) {
    const e = ref instanceof Ref ? this.objs.get(ref.num) : null;
    if (!e || e.stream == null) return null;
    return decodeStream(e.value || {}, e.stream);
  }

  pages() {
    const out = [];
    const root = this.get(this.trailer.Root) || [...this.objs.values()].map((e) => e.value).find((v) => v && v.Type instanceof Name && v.Type.v === 'Catalog');
    const walk = (node, inherited, depth) => {
      node = this.get(node);
      if (!node || depth > 64) return;
      const res = node.Resources !== undefined ? node.Resources : inherited.Resources;
      const box = node.MediaBox !== undefined ? node.MediaBox : inherited.MediaBox;
      const type = node.Type instanceof Name ? node.Type.v : '';
      if (type === 'Pages' || Array.isArray(node.Kids)) {
        for (const k of this.get(node.Kids) || []) walk(k, { Resources: res, MediaBox: box }, depth + 1);
      } else {
        out.push({ node, resources: res, mediaBox: this.get(box) });
      }
    };
    if (root) walk(root.Pages, {}, 0);
    return out;
  }
}

// ---------- Fonts ----------

function utf16be(bin) {
  let out = '';
  for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
  return out;
}

function parseCMap(text) {
  const map = new Map();
  let codeLen = 0;
  const hexes = (str) => [...str.matchAll(/<([0-9a-fA-F\s]*)>/g)].map((x) => x[1].replace(/\s/g, ''));
  const toStr = (h) => utf16be(Buffer.from(h.length % 2 ? h + '0' : h, 'hex').toString('latin1'));
  for (const block of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const h of hexes(block[1])) codeLen = Math.max(codeLen, h.length / 2);
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const h = hexes(block[1]);
    for (let i = 0; i + 1 < h.length; i += 2) map.set(parseInt(h[i], 16), toStr(h[i + 1]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1];
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g;
    let m;
    while ((m = re.exec(body))) {
      const lo = parseInt(m[1], 16);
      const hi = Math.min(parseInt(m[2], 16), lo + 65535);
      if (m[3].startsWith('[')) {
        const list = hexes(m[3]);
        for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, toStr(list[c - lo]));
      } else {
        const base = m[3].slice(1, -1);
        const baseStr = toStr(base);
        for (let c = lo; c <= hi; c++) {
          map.set(c, baseStr.slice(0, -1) + String.fromCharCode(baseStr.charCodeAt(baseStr.length - 1) + (c - lo)));
        }
      }
      if (!codeLen) codeLen = m[1].length / 2;
    }
  }
  return { map, codeLen: codeLen || 1 };
}

// A few glyph names for simple fonts with a /Differences encoding.
const GLYPHS = { space: ' ', hyphen: '-', period: '.', comma: ',', colon: ':', semicolon: ';', ampersand: '&', parenleft: '(', parenright: ')', slash: '/', quoteright: "'", quotesingle: "'", at: '@', percent: '%', plus: '+', underscore: '_', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };

function fontDecoder(doc, fontRef, cache) {
  const key = fontRef instanceof Ref ? fontRef.num : fontRef;
  if (cache.has(key)) return cache.get(key);
  const font = doc.get(fontRef) || {};
  const subtype = font.Subtype instanceof Name ? font.Subtype.v : '';
  let cmap = null;
  if (font.ToUnicode instanceof Ref) {
    const data = doc.streamOf(font.ToUnicode);
    if (data) cmap = parseCMap(data.toString('latin1'));
  }
  const twoByte = subtype === 'Type0';
  const codeLen = cmap ? cmap.codeLen : twoByte ? 2 : 1;
  const diff = new Map();
  const enc = doc.get(font.Encoding);
  if (enc && Array.isArray(enc.Differences)) {
    let code = 0;
    for (const d of enc.Differences) {
      if (typeof d === 'number') code = d;
      else if (d instanceof Name) { diff.set(code, d.v.length === 1 ? d.v : GLYPHS[d.v] ?? ''); code++; }
    }
  }
  const dec = (bin) => {
    let out = '';
    for (let i = 0; i < bin.length; i += codeLen) {
      let code = 0;
      for (let j = 0; j < codeLen && i + j < bin.length; j++) code = (code << 8) | bin.charCodeAt(i + j);
      if (cmap && cmap.map.has(code)) out += cmap.map.get(code);
      else if (diff.has(code)) out += diff.get(code);
      else if (codeLen === 1 && !twoByte) out += String.fromCharCode(code);
      else out += '�';
    }
    return out;
  };
  cache.set(key, dec);
  return dec;
}

// ---------- Content streams ----------

function contentText(doc, data, resources, cache, depth = 0) {
  if (!data || depth > 8) return '';
  const res = doc.get(resources) || {};
  const fonts = doc.get(res.Font) || {};
  const xobjs = doc.get(res.XObject) || {};
  const p = new Parser(data.toString('latin1'));
  let ops = [];
  let dec = (b) => b;
  let out = '';
  for (;;) {
    let tok;
    try { tok = p.token(); } catch { break; }
    if (!tok) break;
    if (tok.t !== 'kw') { ops.push(p.value(tok)); continue; }
    const op = tok.v;
    if (op === 'BI') { // Inline image: skip to EI.
      const end = p.s.indexOf('EI', p.pos);
      p.pos = end < 0 ? p.s.length : end + 2;
    } else if (op === 'Tf') {
      const n = ops[ops.length - 2];
      if (n instanceof Name && fonts[n.v] !== undefined) dec = fontDecoder(doc, fonts[n.v], cache);
    } else if (op === 'Tj' || op === "'" || op === '"') {
      if (op !== 'Tj') out += '\n';
      const sArg = ops[ops.length - 1];
      if (typeof sArg === 'string') out += dec(sArg);
    } else if (op === 'TJ') {
      const arr = ops[ops.length - 1];
      if (Array.isArray(arr)) {
        for (const x of arr) {
          if (typeof x === 'string') out += dec(x);
          else if (typeof x === 'number' && x < -180) out += ' ';
        }
      }
    } else if (op === 'Td' || op === 'TD' || op === 'T*' || op === 'Tm') {
      out += ' ';
    } else if (op === 'ET') {
      out += '\n';
    } else if (op === 'Do') {
      const n = ops[ops.length - 1];
      const ref = n instanceof Name ? xobjs[n.v] : null;
      const x = doc.get(ref);
      if (x && x.Subtype instanceof Name && x.Subtype.v === 'Form') {
        out += contentText(doc, doc.streamOf(ref), x.Resources !== undefined ? x.Resources : resources, cache, depth + 1);
      }
    }
    ops = [];
  }
  return out;
}

function countImages(doc, resources, depth = 0) {
  const res = doc.get(resources) || {};
  const xobjs = doc.get(res.XObject) || {};
  let n = 0;
  for (const k of Object.keys(xobjs)) {
    const x = doc.get(xobjs[k]);
    if (!x || !(x.Subtype instanceof Name)) continue;
    if (x.Subtype.v === 'Image') n++;
    else if (x.Subtype.v === 'Form' && depth < 4) n += countImages(doc, x.Resources, depth + 1);
  }
  return n;
}

function textString(v) {
  if (typeof v !== 'string') return '';
  if (v.startsWith('\xfe\xff')) return utf16be(v.slice(2));
  return v;
}

// Returns { pages: [{ text, width, height, images }], info: {Title, …}, xmp, encrypted }.
function extract(buf) {
  if (!Buffer.isBuffer(buf) || !buf.slice(0, 1024).toString('latin1').includes('%PDF')) throw new Error('This file is not a PDF.');
  const doc = new Doc(buf);
  const cache = new Map();
  const pages = doc.pages().map(({ node, resources, mediaBox }) => {
    let contents = doc.get(node.Contents);
    const refs = Array.isArray(contents) ? contents : [node.Contents];
    const parts = refs.map((r) => doc.streamOf(r)).filter(Boolean);
    const text = contentText(doc, Buffer.concat(parts.flatMap((b) => [b, Buffer.from('\n')])), resources, cache);
    const box = Array.isArray(mediaBox) ? mediaBox.map((x) => doc.get(x)) : [0, 0, 0, 0];
    return { text, width: Math.round(box[2] - box[0]), height: Math.round(box[3] - box[1]), images: countImages(doc, resources) };
  });
  const infoObj = doc.get(doc.trailer.Info) || {};
  const info = {};
  for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) if (infoObj[k] !== undefined) info[k] = textString(doc.get(infoObj[k]));
  let xmp = '';
  for (const [, e] of doc.objs) {
    const v = e.value;
    if (v && v.Type instanceof Name && v.Type.v === 'Metadata' && e.stream != null) {
      const d = decodeStream(v, e.stream);
      if (d) xmp += d.toString('utf8');
    }
  }
  return { pages, info, xmp, encrypted: !!doc.trailer.Encrypt };
}

module.exports = { extract, parseCMap };
