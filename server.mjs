#!/usr/bin/env node
/*
 * Canvi MCP server — a design editor that Claude can drive, with no npm dependencies.
 *
 *  - Speaks MCP over stdio (JSON-RPC, one message per line).
 *  - Serves the Canvi editor (editor/canvi.html) on http://127.0.0.1:<port> so you can open any design and edit it by hand.
 *  - Renders designs with a headless Chrome/Edge that is already installed (talks to it over the DevTools protocol).
 *  - Stores every design as <CANVI_DIR>/designs/<id>.canvi.json (default CANVI_DIR: ~/Canvi).
 *
 * Needs: Node 22+ and Google Chrome, Microsoft Edge or Chromium. Environment: CANVI_DIR, CANVI_PORT, CHROME_PATH.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_FILE = path.join(HERE, 'editor', 'canvi.html');
const ROOT = process.env.CANVI_DIR || path.join(os.homedir(), 'Canvi');
const DESIGNS = path.join(ROOT, 'designs');
const EXPORTS = path.join(ROOT, 'exports');
const TRASH = path.join(ROOT, 'trash');
for (const d of [DESIGNS, EXPORTS, TRASH]) fs.mkdirSync(d, { recursive: true });

const log = (...a) => console.error('[canvi]', ...a);
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/;
const MAX_BODY = 60 * 1024 * 1024;

/* ------------------------------------------------------------------ files */
const slug = s => String(s || 'design').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'design';
const newId = name => `${slug(name)}-${crypto.randomBytes(2).toString('hex')}`;
const fileOf = id => { if (!ID_RE.test(id)) throw new Error(`Invalid design id "${id}".`); return path.join(DESIGNS, id + '.canvi.json'); };
async function readDesign(id) {
  const f = fileOf(id);
  let txt; try { txt = await fsp.readFile(f, 'utf8'); } catch { throw new Error(`Design "${id}" not found. Use list_designs to see the available ones.`); }
  const st = await fsp.stat(f); return { doc: JSON.parse(txt), rev: Math.floor(st.mtimeMs) };
}
async function writeDesign(id, doc) {
  const f = fileOf(id), tmp = f + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(doc), 'utf8'); await fsp.rename(tmp, f);
  return Math.floor((await fsp.stat(f)).mtimeMs);
}
async function listDesigns() {
  const out = [];
  for (const n of await fsp.readdir(DESIGNS)) {
    if (!n.endsWith('.canvi.json')) continue;
    const id = n.slice(0, -'.canvi.json'.length); if (!ID_RE.test(id)) continue;
    try { const f = path.join(DESIGNS, n), st = await fsp.stat(f), d = JSON.parse(await fsp.readFile(f, 'utf8'));
      out.push({ id, name: d.name, width: d.w, height: d.h, pages: d.pages?.length || 0, modified: st.mtime.toISOString() }); } catch { /* skip broken file */ }
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

/* ------------------------------------------------------------- doc helpers */
const uid = () => crypto.randomBytes(4).toString('hex');
function normalizeElement(el, taken) {
  if (!el || typeof el !== 'object' || !el.type) throw new Error('Every element needs a "type" (shape, text, line, image, graphic, draw, table, chart).');
  const o = { x: 0, y: 0, w: 200, h: 100, rot: 0, opacity: 1, locked: false, hidden: false, gid: '', ...el };
  if (!o.id || taken.has(o.id)) o.id = uid();
  taken.add(o.id); return o;
}
function normalizeDoc(d) {
  if (!d || typeof d !== 'object') throw new Error('The design must be an object.');
  const out = { palette: [], ...d, name: d.name || 'Untitled', w: Math.round(+d.w || 1080), h: Math.round(+d.h || 1080) };
  if (!Array.isArray(out.pages) || !out.pages.length) out.pages = [{ bg: '#ffffff', elements: [] }];
  const taken = new Set();
  out.pages = out.pages.map(pg => ({ bg: '#ffffff', title: '', guides: { x: [], y: [] }, ...pg, id: pg.id || uid(), elements: (pg.elements || []).map(el => normalizeElement(el, taken)) }));
  return out;
}
const allElements = d => d.pages.flatMap((pg, pi) => pg.elements.map(el => ({ el, pi })));
function findEl(d, id) { const r = allElements(d).find(x => x.el.id === id); if (!r) throw new Error(`No element with id "${id}". Use read_design to see the ids.`); return r; }
function mergeInto(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) mergeInto(target[k], v);
    else target[k] = v;
  }
}
function applyOps(d, ops) {
  const notes = [], taken = new Set(allElements(d).map(x => x.el.id));
  const pageAt = i => { const pg = d.pages[i ?? 0]; if (!pg) throw new Error(`Page ${i} does not exist (the design has ${d.pages.length}; pages start at 0).`); return pg; };
  ops.forEach((op, n) => {
    const tag = `op ${n + 1} (${op.op})`;
    switch (op.op) {
      case 'rename': d.name = String(op.name); notes.push(`${tag}: renamed`); break;
      case 'replace_text': {
        if (typeof op.find !== 'string' || typeof op.replace !== 'string') throw new Error(`${tag}: "find" and "replace" are required strings.`);
        let count = 0; const sub = s => { if (typeof s !== 'string' || !s.includes(op.find)) return s; count += s.split(op.find).length - 1; return s.split(op.find).join(op.replace); };
        allElements(d).filter(x => op.page == null || x.pi === op.page).forEach(({ el }) => {
          if (op.id && el.id !== op.id) return;
          if (el.text != null) el.text = sub(el.text);
          if (el.type === 'table' && Array.isArray(el.cells)) el.cells = el.cells.map(r => (r || []).map(sub));
          if (el.type === 'chart') { el.title = sub(el.title); (el.data || []).forEach(p => { p.label = sub(p.label); }); }
        });
        if (!count) throw new Error(`${tag}: the text "${op.find}" was not found.`); notes.push(`${tag}: ${count} replacement(s)`); break;
      }
      case 'update_element': { const { el } = findEl(d, op.id); if (!op.set || typeof op.set !== 'object') throw new Error(`${tag}: "set" must be an object.`); mergeInto(el, op.set); notes.push(`${tag}: updated ${op.id}`); break; }
      case 'add_element': { const pg = pageAt(op.page); const el = normalizeElement(op.element, taken); const i = op.index == null ? pg.elements.length : Math.max(0, Math.min(pg.elements.length, op.index)); pg.elements.splice(i, 0, el); notes.push(`${tag}: added ${el.id}`); break; }
      case 'delete_element': { const { pi } = findEl(d, op.id); d.pages[pi].elements = d.pages[pi].elements.filter(e => e.id !== op.id); notes.push(`${tag}: deleted ${op.id}`); break; }
      case 'reorder': {
        const { el, pi } = findEl(d, op.id), arr = d.pages[pi].elements, i = arr.indexOf(el); arr.splice(i, 1);
        const j = op.to === 'front' ? arr.length : op.to === 'back' ? 0 : op.to === 'forward' ? Math.min(arr.length, i + 1) : op.to === 'backward' ? Math.max(0, i - 1) : null;
        if (j == null) throw new Error(`${tag}: "to" must be front, back, forward or backward.`); arr.splice(j, 0, el); notes.push(`${tag}: ${op.id} moved ${op.to}`); break;
      }
      case 'add_page': { const pg = normalizeDoc({ pages: [{ bg: op.bg, title: op.title, elements: op.elements || [] }] }).pages[0]; if (op.bg == null) pg.bg = d.pages[0]?.bg || '#ffffff'; const i = op.index == null ? d.pages.length : Math.max(0, Math.min(d.pages.length, op.index)); d.pages.splice(i, 0, pg); notes.push(`${tag}: page added at ${i}`); break; }
      case 'delete_page': { if (d.pages.length < 2) throw new Error(`${tag}: a design needs at least one page.`); pageAt(op.page); d.pages.splice(op.page, 1); notes.push(`${tag}: page ${op.page} deleted`); break; }
      case 'set_page': { const pg = pageAt(op.page); if (op.bg != null) pg.bg = op.bg; if (op.title != null) pg.title = op.title; notes.push(`${tag}: page ${op.page ?? 0} updated`); break; }
      case 'resize_canvas': {
        const w = Math.round(+op.width), h = Math.round(+op.height); if (!(w > 0 && h > 0)) throw new Error(`${tag}: width and height must be positive.`);
        if (op.scale_content) { const fx = w / d.w, fy = h / d.h, fs_ = Math.min(fx, fy); allElements(d).forEach(({ el }) => { el.x *= fx; el.w *= fx; el.y *= fy; el.h *= fy; if (el.size) el.size *= fs_; if (el.strokeW) el.strokeW *= fs_; }); }
        d.w = w; d.h = h; notes.push(`${tag}: canvas ${w}x${h}`); break;
      }
      default: throw new Error(`${tag}: unknown operation. Valid: rename, replace_text, update_element, add_element, delete_element, reorder, add_page, delete_page, set_page, resize_canvas.`);
    }
  });
  return notes;
}

/* --------------------------------------------------------- headless browser */
function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const e = process.env, c = [];
  if (process.platform === 'win32') {
    for (const base of [e.PROGRAMFILES, e['PROGRAMFILES(X86)'], e.LOCALAPPDATA].filter(Boolean)) {
      c.push(path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Microsoft/Edge/Application/msedge.exe'), path.join(base, 'Chromium/Application/chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      try { const p = execFileSync('which', [n], { encoding: 'utf8' }).trim(); if (p) c.push(p); } catch { /* not installed */ }
    }
  }
  return c.find(p => fs.existsSync(p)) || null;
}

let browser = null; // { child, dir, ws, nextId, pending, renderer }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function cdpSend(method, params = {}, sessionId) {
  const b = browser; if (!b) throw new Error('Browser is not running.');
  const id = b.nextId++;
  return new Promise((resolve, reject) => {
    b.pending.set(id, { resolve, reject, method });
    b.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function startBrowser() {
  const exe = findBrowser();
  if (!exe) throw new Error('Could not find Chrome, Edge or Chromium. Install one of them or set CHROME_PATH to its executable.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvi-browser-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--disable-gpu', 'about:blank'];
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox');
  const child = spawn(exe, args, { stdio: 'ignore', windowsHide: true });
  let port = 0, wsPath = '';
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(150);
    try { const [p, w] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n'); port = +p; wsPath = w; } catch { /* not yet */ }
  }
  if (!port) { child.kill(); throw new Error('The browser did not start in time.'); }
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Could not connect to the browser.')); });
  const b = { child, dir, ws, nextId: 1, pending: new Map(), renderer: null };
  browser = b;
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data); const p = m.id && b.pending.get(m.id); if (!p) return;
    b.pending.delete(m.id); m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result);
  };
  const dead = () => { if (browser === b) browser = null; for (const p of b.pending.values()) p.reject(new Error('The browser closed.')); b.pending.clear(); };
  ws.onclose = dead; child.on('exit', dead);
}
async function getBrowser() { if (!browser) await startBrowser(); return browser; }
function stopBrowser() {
  const b = browser; browser = null; if (!b) return;
  try { b.ws.close(); } catch { /* closed */ } try { b.child.kill(); } catch { /* gone */ }
  setTimeout(() => fs.rm(b.dir, { recursive: true, force: true }, () => {}), 1500);
}
async function openTarget(url) {
  const { targetId } = await cdpSend('Target.createTarget', { url });
  const { sessionId } = await cdpSend('Target.attachToTarget', { targetId, flatten: true });
  return { targetId, sessionId };
}
async function evalIn(sessionId, expression) {
  const r = await cdpSend('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'Script error in the page.');
  return r.result.value;
}
async function getRenderer() {
  await getBrowser(); const b = browser;
  if (b.renderer) return b.renderer;
  const t = await openTarget(`http://127.0.0.1:${PORT}/editor.html?render=1`);
  for (let i = 0; i < 100; i++) {
    try { if (await evalIn(t.sessionId, `document.readyState === 'complete' && typeof pageToDataUrl === 'function' && typeof migrate === 'function'`)) break; } catch { /* loading */ }
    await sleep(150);
  }
  b.renderer = t; return t;
}

let queue = Promise.resolve();
const serialized = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

const RENDER_FN = `async (d, opts) => {
  d.pages.forEach(pg => pg.elements.forEach(el => { if (el.type === 'graphic' && !el.path && el.icon) { const g = GRAPHICS.find(x => x[0].toLowerCase() === String(el.icon).toLowerCase()); if (g) el.path = g[1]; } }));
  migrate(d); doc = d; pageIdx = 0; sel = []; editing = null;
  const jobs = [];
  d.pages.forEach(pg => pg.elements.forEach(el => {
    if (el.font) { const w = el.weight || 400; jobs.push(document.fonts.load((el.italic ? 'italic ' : '') + w + ' 20px "' + el.font + '"', String(el.text || '') || 'a')); if (el.type === 'table') jobs.push(document.fonts.load('700 20px "' + el.font + '"', 'a')); }
    if (el.type === 'image' && el.src) jobs.push(new Promise(res => { let im = imgCache.get(el.src); if (!im) { im = new Image(); imgCache.set(el.src, im); im.src = el.src; } if (im.complete) res(); else { im.addEventListener('load', res); im.addEventListener('error', res); } }));
  }));
  await Promise.all(jobs.map(p => Promise.resolve(p).catch(() => {})));
  await document.fonts.ready;
  const idx = opts.pages === 'all' ? d.pages.map((_, i) => i) : [opts.pages];
  const urls = idx.map(i => pageToDataUrl(d.pages[i], opts.scale, opts.fmt));
  const heights = {}, paths = {};
  d.pages.forEach(pg => pg.elements.forEach(el => { if (el.type === 'text') heights[el.id] = Math.round(el.h); if (el.type === 'graphic' && el.icon) paths[el.id] = el.path; }));
  return { urls, heights, paths, pageIndexes: idx };
}`;

/** Renders a design. Returns data URLs plus the measured height of each text box (text height is automatic). */
function render(doc, { scale = 1, pages = 'all', fmt = 'png' } = {}) {
  return serialized(async () => {
    const t = await getRenderer();
    const copy = JSON.parse(JSON.stringify(doc));
    return evalIn(t.sessionId, `(${RENDER_FN})(${JSON.stringify(copy)}, ${JSON.stringify({ scale, pages, fmt })})`);
  });
}
function applyMeasured(doc, r) {
  for (const { el } of allElements(doc)) { if (r.heights[el.id] != null) el.h = r.heights[el.id]; if (r.paths[el.id] && !el.path) el.path = r.paths[el.id]; }
}
const dataB64 = u => u.slice(u.indexOf(',') + 1);
const previewScale = d => Math.min(1, 900 / Math.max(d.w, d.h));

function toPdf(urls, w, h) {
  return serialized(async () => {
    await getBrowser();
    const html = `<!doctype html><meta charset="utf-8"><style>@page{size:${w}px ${h}px;margin:0}*{margin:0}body{background:#fff}img{display:block;width:${w}px;height:${h}px;break-after:page}img:last-child{break-after:auto}</style>${urls.map(u => `<img src="${u}">`).join('')}`;
    const t = await openTarget('about:blank');
    try {
      await evalIn(t.sessionId, `document.open(); document.write(${JSON.stringify(html)}); document.close(); Promise.all([...document.images].map(i => i.decode().catch(() => {}))).then(() => true)`);
      const r = await cdpSend('Page.printToPDF', { paperWidth: w / 96, paperHeight: h / 96, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, printBackground: true, preferCSSPageSize: true }, t.sessionId);
      return Buffer.from(r.data, 'base64');
    } finally { cdpSend('Target.closeTarget', { targetId: t.targetId }).catch(() => {}); }
  });
}

/* ---------------------------------------------------------------- http */
let PORT = 0;
const sendJson = (res, code, obj, extra = {}) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(b); };
const readBody = req => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); req.on('error', reject);
});
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function homePage() {
  const list = await listDesigns();
  const rows = list.map(d => `<li><a href="/editor.html?design=${encodeURIComponent(d.id)}">${esc(d.name)}</a> <small>${d.width}×${d.height} · ${d.pages} page${d.pages === 1 ? '' : 's'} · ${esc(d.id)}</small></li>`).join('') || '<li><small>No designs yet. Ask Claude to create one.</small></li>';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canvi · designs</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#1b1d2a}h1{font-size:28px}li{margin:8px 0}a{color:#5b4de8;font-weight:600}small{color:#656a7f;margin-left:6px}</style>
<h1>Canvi</h1><p>Designs stored in <code>${esc(DESIGNS)}</code></p><ul>${rows}</ul><p><a href="/editor.html">Open a blank local editor</a></p></html>`;
}
const server = http.createServer(async (req, res) => {
  try {
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host || '')) { res.writeHead(403); return res.end('Forbidden'); }
    const url = new URL(req.url, 'http://127.0.0.1'); const p = url.pathname;
    if (req.method === 'GET' && p === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(await homePage()); }
    if (req.method === 'GET' && (p === '/editor.html' || p === '/canvi.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(await fsp.readFile(EDITOR_FILE)); }
    if (p === '/api/designs' && req.method === 'GET') return sendJson(res, 200, await listDesigns());
    const m = p.match(/^\/api\/designs\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (req.method === 'GET') {
        const { doc, rev } = await readDesign(id);
        return url.searchParams.has('rev') ? sendJson(res, 200, { rev }) : sendJson(res, 200, { ...doc, __rev: rev });
      }
      if (req.method === 'PUT') {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) { res.writeHead(415); return res.end('JSON only'); }
        const doc = normalizeDoc(JSON.parse(await readBody(req))); delete doc.__rev;
        return sendJson(res, 200, { rev: await writeDesign(id, doc) });
      }
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) { sendJson(res, e.message?.includes('not found') ? 404 : 400, { error: String(e.message || e) }); }
});
async function listen() {
  const want = +process.env.CANVI_PORT || 8787;
  for (let p = want; p < want + 30; p++) {
    const ok = await new Promise(r => { server.once('error', () => r(false)); server.listen(p, '127.0.0.1', () => r(true)); });
    if (ok) { PORT = p; server.removeAllListeners('error'); return; }
  }
  throw new Error('No free port for the Canvi editor.');
}
const editorUrl = id => `http://127.0.0.1:${PORT}/editor.html?design=${encodeURIComponent(id)}`;
function openInBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    return true;
  } catch { return false; }
}

/* ----------------------------------------------------------------- tools */
const text = s => ({ type: 'text', text: s });
const image = url => ({ type: 'image', data: dataB64(url), mimeType: url.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png' });
const json = o => text(JSON.stringify(o, null, 1));
const PAGES_PROP = { type: 'array', description: 'Pages in order. Each: {bg (hex or gradient {type:"linear"|"radial",angle,stops:[hex,...]}), title?, elements:[...]}.', items: { type: 'object' } };

async function previewOf(doc, page = 0) {
  const r = await render(doc, { scale: previewScale(doc), pages: Math.min(page, doc.pages.length - 1), fmt: 'jpeg' });
  applyMeasured(doc, r); return r.urls[0];
}
function summarize(doc) {
  return doc.pages.map((pg, i) => ({ page: i, bg: pg.bg, title: pg.title || undefined,
    elements: pg.elements.map(el => ({ id: el.id, type: el.type, x: Math.round(el.x), y: Math.round(el.y), w: Math.round(el.w), h: Math.round(el.h),
      ...(el.type === 'text' ? { text: el.text, font: el.font, size: el.size } : {}), ...(el.type === 'shape' && el.text ? { text: el.text } : {}) })) }));
}
const stripImages = doc => JSON.parse(JSON.stringify(doc, (k, v) => (k === 'src' && typeof v === 'string' && v.startsWith('data:') ? `<embedded image, ${Math.round(v.length / 1024)} KB>` : v)));

const TOOLS = [
  {
    name: 'get_schema',
    description: 'Read this first when creating or editing designs. Returns the design format: element types with all their properties and defaults, the font list, canvas presets, shapes, icons, text effects and ready-made templates. Coordinates are pixels from the top-left of the canvas; text height is automatic (measured on render).',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const t = await getRenderer();
      const s = await serialized(() => evalIn(t.sessionId, `({ defaults: DEFAULTS, presets: PRESETS, fonts: FONTS, shapes: SHAPES.map(s => s[0]), icons: GRAPHICS.map(g => g[0]), textEffects: FX_KINDS.map(f => f[0]), templates: TEMPLATES.map(t => ({ id: t.id, name: t.name, category: t.cat, width: t.w, height: t.h })) })`));
      return [text(`Design = {name, w, h, palette:[hex...], pages:[{bg, title?, elements:[...]}]}. Elements are drawn in array order (last = on top). Common element props: id (optional, give readable ids like "title" so you can edit them later), type, x, y, w, h, rot (degrees), opacity (0-1), locked, hidden.
Types: shape (rect, rrect, ellipse, triangle, diamond, pentagon, hexagon, star, heart, arrowblock, plus, parallelogram, semicircle, bubble, arch, blob; "fill" and "color" accept a hex string or a gradient object; optional "text" inside the shape), text (text, font, size, weight, italic, align, color, lineHeight, letterSpacing, fx, fill = background box, h is ignored), line, image (src = https URL or data: URL), graphic (icon: one of the icon names, fill), table (rows, cols, cells[row][col]), chart (kind: column|bar|line|pie|donut, data:[{label,value}], colors, title), draw (free hand). Fonts are Google Fonts loaded from the internet. Use the defaults below for the full property list of each type.`),
        json(s)];
    },
  },
  {
    name: 'create_design',
    description: 'Create a new design and return a preview image. Give either width/height, a preset id, or a template id (see get_schema), plus the pages with their elements. Returns the design id, the editor link (the person can open it and edit by hand) and the measured height of every text box so you can check for overflow or overlap. Check the preview and fix problems with edit_design.',
    inputSchema: { type: 'object', properties: {
      name: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, preset: { type: 'string', description: 'Preset id such as ig, story, slide, a4v, a4h, poster.' },
      template: { type: 'string', description: 'Template id to start from (pages are ignored when given unless you also pass pages).' }, palette: { type: 'array', items: { type: 'string' } }, pages: PAGES_PROP } },
    async run(a) {
      let doc;
      if (a.template) {
        const t = await getRenderer();
        const tpl = await serialized(() => evalIn(t.sessionId, `(() => { const t = TEMPLATES.find(x => x.id === ${JSON.stringify(a.template)}); if (!t) return null; return { name: t.name, w: t.w, h: t.h, palette: t.pal.slice(), pages: t.pages().map(p => ({ bg: p.bg, title: p.title, elements: p.elements })) }; })()`));
        if (!tpl) throw new Error(`Unknown template "${a.template}". See get_schema for the ids.`);
        doc = tpl; if (a.pages) doc.pages = a.pages;
      } else doc = { pages: a.pages };
      if (a.preset) {
        const t = await getRenderer();
        const pr = await serialized(() => evalIn(t.sessionId, `PRESETS.find(p => p.id === ${JSON.stringify(a.preset)}) || null`));
        if (!pr || !pr.w) throw new Error(`Unknown or non-sized preset "${a.preset}". See get_schema for the ids.`);
        doc.w = pr.w; doc.h = pr.h;
      }
      if (a.width) doc.w = a.width; if (a.height) doc.h = a.height;
      doc.name = a.name || doc.name || 'Untitled'; if (a.palette) doc.palette = a.palette;
      doc = normalizeDoc(doc);
      const id = newId(doc.name), url = await previewOf(doc);
      await writeDesign(id, doc);
      return [text(`Created "${doc.name}" (${doc.w}x${doc.h}, ${doc.pages.length} page(s)).\nid: ${id}\neditor: ${editorUrl(id)}\nText heights measured on render (use them to check overlaps): ${JSON.stringify(Object.fromEntries(allElements(doc).filter(x => x.el.type === 'text').map(x => [x.el.id, Math.round(x.el.h)])))}`), image(url)];
    },
  },
  {
    name: 'read_design',
    description: 'Read a design: its pages, element ids, positions, texts and styles. By default embedded images are shortened; pass full=true for the exact JSON. Returns a preview of the requested page. Use this to see what the person changed by hand in the editor before you edit.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, page: { type: 'number', description: 'Page to preview (default 0).' }, full: { type: 'boolean' }, preview: { type: 'boolean', description: 'Default true.' } }, required: ['id'] },
    async run(a) {
      const { doc } = await readDesign(a.id);
      const out = [];
      let url = null; if (a.preview !== false) url = await previewOf(doc, a.page || 0);
      out.push(text(`"${doc.name}" ${doc.w}x${doc.h}, ${doc.pages.length} page(s). editor: ${editorUrl(a.id)}`));
      out.push(json(a.full ? stripImages(doc) : { outline: summarize(doc) }));
      if (url) out.push(image(url)); return out;
    },
  },
  {
    name: 'edit_design',
    description: 'Apply one or more operations to a design and return a preview. The editor picks up the change within a couple of seconds if the person has it open. Operations (field "op"): rename {name}; replace_text {find, replace, page?, id?}; update_element {id, set:{...props}} (nested objects like fx are merged); add_element {page?, element, index?}; delete_element {id}; reorder {id, to: front|back|forward|backward}; add_page {bg?, title?, elements?, index?}; delete_page {page}; set_page {page, bg?, title?}; resize_canvas {width, height, scale_content?}. Operations are applied in order and either all succeed or none are saved.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, operations: { type: 'array', items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] } }, preview_page: { type: 'number' } }, required: ['id', 'operations'] },
    async run(a) {
      const { doc } = await readDesign(a.id);
      const notes = applyOps(doc, a.operations);
      const next = normalizeDoc(doc), url = await previewOf(next, a.preview_page || 0);
      await writeDesign(a.id, next);
      return [text(`${notes.join('\n')}\nSaved. editor: ${editorUrl(a.id)}`), image(url)];
    },
  },
  {
    name: 'export_design',
    description: 'Export a design to files: png, jpeg or pdf (one PDF page per design page, sized exactly to the canvas). Returns the file paths. Default folder: <CANVI_DIR>/exports/<id>/.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, format: { type: 'string', enum: ['png', 'jpeg', 'pdf'] }, scale: { type: 'number', description: 'Pixel multiplier (default 1 for images, 2 for pdf).' }, page: { type: 'number', description: 'Export only this page (default: all).' }, output_dir: { type: 'string' } }, required: ['id', 'format'] },
    async run(a) {
      const { doc } = await readDesign(a.id); const fmt = a.format;
      const scale = Math.min(Math.max(+a.scale || (fmt === 'pdf' ? 2 : 1), 0.25), 8);
      const r = await render(doc, { scale, pages: a.page == null ? 'all' : a.page, fmt: fmt === 'jpeg' ? 'jpeg' : 'png' });
      const dir = a.output_dir ? path.resolve(a.output_dir) : path.join(EXPORTS, a.id); await fsp.mkdir(dir, { recursive: true });
      const files = [];
      if (fmt === 'pdf') { const f = path.join(dir, `${a.id}.pdf`); await fsp.writeFile(f, await toPdf(r.urls, doc.w, doc.h)); files.push(f); }
      else for (let i = 0; i < r.urls.length; i++) { const f = path.join(dir, `${a.id}${r.urls.length > 1 || a.page != null ? '-p' + (r.pageIndexes[i] + 1) : ''}.${fmt === 'jpeg' ? 'jpg' : 'png'}`); await fsp.writeFile(f, Buffer.from(dataB64(r.urls[i]), 'base64')); files.push(f); }
      const out = [text(`Exported ${files.length} file(s):\n${files.join('\n')}`)];
      if (fmt !== 'pdf') { const pr = await previewOf(doc, 0); out.push(image(pr)); }
      return out;
    },
  },
  {
    name: 'list_designs',
    description: 'List the saved designs (newest first) with id, name, size, number of pages and last modification.',
    inputSchema: { type: 'object', properties: {} },
    async run() { const l = await listDesigns(); return [text(`${l.length} design(s) in ${DESIGNS}\nAll designs: http://127.0.0.1:${PORT}/`), json(l)]; },
  },
  {
    name: 'open_editor',
    description: 'Open a design in the Canvi editor in the person\'s browser, so they can move, restyle and add things by hand. Their changes are saved automatically and you can read them with read_design.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, open: { type: 'boolean', description: 'Open the browser window (default true). False only returns the link.' } }, required: ['id'] },
    async run(a) { await readDesign(a.id); const u = editorUrl(a.id); const ok = a.open === false ? false : openInBrowser(u); return [text(`${ok ? 'Opened in the browser: ' : 'Link: '}${u}\nThe link only works while this Canvi server is running (it starts with Claude).`)]; },
  },
  {
    name: 'duplicate_design',
    description: 'Copy a design under a new name and return the new id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } }, required: ['id'] },
    async run(a) { const { doc } = await readDesign(a.id); doc.name = a.name || `${doc.name} (copy)`; const id = newId(doc.name); await writeDesign(id, doc); return [text(`Copied to id: ${id}\neditor: ${editorUrl(id)}`)]; },
  },
  {
    name: 'delete_design',
    description: 'Move a design to the trash folder (<CANVI_DIR>/trash). It is not erased permanently. Only call it when the person asked.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async run(a) { await readDesign(a.id); const dest = path.join(TRASH, path.basename(fileOf(a.id))); await fsp.rename(fileOf(a.id), dest); return [text(`Moved to ${dest}`)]; },
  },
];

/* ------------------------------------------------------------------- mcp */
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
async function handle(msg) {
  const { id, method, params } = msg;
  const reply = result => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'canvi', version: VERSION },
      instructions: 'Canvi is a design editor (posters, infographics, social posts, slides, A4 documents). Call get_schema once, build with create_design, look at the preview image, refine with edit_design, deliver with export_design, and offer open_editor so the person can touch it up by hand.' });
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool ${params?.name}`);
      try { return reply({ content: await tool.run(params.arguments || {}) }); }
      catch (e) { log('tool error', params.name, e.message); return reply({ isError: true, content: [text(String(e.message || e))] }); }
    }
    if (method?.startsWith('notifications/')) return;
    fail(-32601, `Method not found: ${method}`);
  } catch (e) { fail(-32603, String(e.message || e)); }
}

function shutdown() { stopBrowser(); try { server.close(); } catch { /* closed */ } setTimeout(() => process.exit(0), 200); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
process.on('exit', () => { try { browser?.child.kill(); } catch { /* gone */ } });

if (process.argv.includes('--version')) { console.log(VERSION); process.exit(0); }
await listen();
log(`editor on http://127.0.0.1:${PORT}  designs in ${DESIGNS}`);
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
// If the client dies without closing the pipe, do not stay behind holding the port and a browser.
const parent = process.ppid;
setInterval(() => { try { process.kill(parent, 0); } catch { shutdown(); } }, 5000).unref();
