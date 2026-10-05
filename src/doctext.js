// Reads the text and file properties of a Word (.docx) file so an action plan
// can be checked before it goes to the client. A .docx is a zip of XML parts.
const zlib = require('node:zlib');

// Lists and reads entries from a zip file using its central directory.
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a Word document.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const lp = e.local;
    if (buf.readUInt32LE(lp) !== 0x04034b50) return null;
    const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
    const data = buf.slice(start, start + e.size);
    if (e.method === 0) return data;
    if (e.method === 8) return zlib.inflateRawSync(data);
    return null;
  };
  return { names: [...entries.keys()], read };
}

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

// Paragraphs and table cells become new lines; runs inside a paragraph join up.
function xmlText(xml) {
  return decodeXml(xml
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<w:br\/>|<\/w:p>|<\/w:tc>/g, '\n')
    .replace(/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, '')
    .replace(/<[^>]+>/g, ''));
}

// Returns { text, parts: [{ name, text }], info: { title, creator, … } }.
function extract(buf) {
  if (!Buffer.isBuffer(buf) || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('This file is not a Word document.');
  const zip = unzip(buf);
  if (!zip.names.includes('word/document.xml')) throw new Error('This file is not a Word document.');
  const wanted = zip.names.filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n));
  const parts = wanted.map((name) => ({ name, text: xmlText(zip.read(name)?.toString('utf8') || '') }));
  const info = {};
  for (const name of ['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml']) {
    const xml = zip.read(name)?.toString('utf8');
    if (!xml) continue;
    for (const m of xml.matchAll(/<(?:[a-z]+:)?([A-Za-z]+)[^>]*>([^<]+)<\/(?:[a-z]+:)?\1>/g)) info[m[1]] = decodeXml(m[2]);
  }
  // Text in shapes and alt text of pictures counts too.
  const alt = [];
  for (const p of wanted) {
    const xml = zip.read(p)?.toString('utf8') || '';
    for (const m of xml.matchAll(/\b(?:descr|title|name)="([^"]+)"/g)) alt.push(decodeXml(m[1]));
  }
  return { text: parts.map((p) => p.text).join('\n'), parts, info, alt: alt.join('\n'), images: zip.names.filter((n) => n.startsWith('word/media/')).length };
}

module.exports = { extract, unzip };
