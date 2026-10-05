// Minimal HTTP plumbing: routing, cookies, form and file-upload parsing.
// No third-party packages, so the test version runs with Node alone.
const { URL } = require('node:url');

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler });
  }
  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const MAX_BODY = 12 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('The upload is too large (limit 12 MB).')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseUrlEncoded(buf) {
  const out = {};
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) out[k] = v;
  return out;
}

// Returns { fields, files } where files[name] = { filename, type, data }.
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!m) throw new Error('Bad upload');
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const fields = {};
  const files = {};
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const part = buf.slice(start + 2, next - 2); // skip CRLF after boundary and before next
    const headEnd = part.indexOf('\r\n\r\n');
    const head = part.slice(0, headEnd).toString('utf8');
    const body = part.slice(headEnd + 4);
    const name = /name="([^"]*)"/.exec(head)?.[1];
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1] || 'application/octet-stream';
    if (name != null) {
      if (filename != null) { if (filename) files[name] = { filename, type, data: body }; }
      else fields[name] = body.toString('utf8');
    }
    pos = next;
  }
  return { fields, files };
}

async function parseRequest(req) {
  const url = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(url.searchParams);
  let body = {};
  let files = {};
  if (req.method === 'POST') {
    const buf = await readBody(req);
    const ct = req.headers['content-type'] || '';
    if (ct.startsWith('multipart/form-data')) ({ fields: body, files } = parseMultipart(buf, ct));
    else body = parseUrlEncoded(buf);
  }
  return { path: url.pathname, query, body, files, cookies: parseCookies(req.headers.cookie) };
}

module.exports = { Router, parseRequest, parseMultipart, parseCookies };
