#!/usr/bin/env node
'use strict';
// kn — knowledge notebook CLI for my-default-env.
// Zero dependencies. Used three ways: as a CLI inside projects (.knowledge/bin/kn.cjs),
// as a CLI from the plugin (init/upgrade), and as a library required by hooks/run.cjs.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '0.1.0';
const KN = '.knowledge';
const CURATED_DIRS = { attempt: 'attempts', finding: 'findings', research: 'research', entity: 'entities' };
const KIND_PREFIX = { attempt: 'att', finding: 'fnd', research: 'res', entity: 'ent' };
const PROFILES = ['code', 'experiment', 'automation', 'creative'];
const PLUGIN_ROOT = path.resolve(__dirname, '..');

const DEFAULT_CONFIG = {
  version: VERSION,
  profile: 'code',
  enforce: { stop: 'block', minEvents: 3 },
  capture: { maxField: 4000, maxPrompt: 20000, images: true },
  curate: { remindAfterFiles: 8 },
  context: { budget: 8000 },
};

// Tools that only look at things. They are journaled but do not count as "work that needs a note".
const READ_ONLY_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'TodoWrite', 'TaskList', 'TaskGet', 'TaskOutput',
  'ToolSearch', 'Skill', 'AskUserQuestion', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
  'WebSearch', 'WebFetch', 'view_image', 'read_file', 'list_dir', 'grep_files',
]);

// ---------------------------------------------------------------- basics

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

function nowIso(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function today(d = new Date()) { return nowIso(d).slice(0, 10); }

function slugify(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

function shortHash(s, n = 6) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, n); }

function toPosix(p) { return p.split(path.sep).join('/'); }

// Strips a UTF-8 BOM: PowerShell 5.1 (Codex on Windows) writes one with -Encoding utf8.
function readText(file) { try { return fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch { return null; } }

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function writeText(file, text) {
  // Write through symlinks (e.g. AGENTS.md -> CLAUDE.md) instead of replacing the link with a copy.
  try { if (fs.lstatSync(file).isSymbolicLink()) file = fs.realpathSync(file); } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      // Windows: a reader (editor, indexer, antivirus) can hold the target briefly.
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch {} throw e; }
      sleepMs(20 * (i + 1));
    }
  }
}

function readJson(file, fallback) { const t = readText(file); if (t == null) return fallback; try { return JSON.parse(t); } catch { return fallback; } }

function writeJson(file, obj) { writeText(file, JSON.stringify(obj, null, 2) + '\n'); }

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

// ---------------------------------------------------------------- project root & config

function findRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, KN, 'config.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function knPath(root, ...parts) { return path.join(root, KN, ...parts); }

function loadConfig(root) { return deepMerge(DEFAULT_CONFIG, readJson(knPath(root, 'config.json'), {})); }

// ---------------------------------------------------------------- frontmatter (YAML subset)

function splitList(s) {
  const out = []; let cur = ''; let q = null; let depth = 0;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseScalar(v) {
  v = v.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v.replace(/\s+#\s.*$/, '');
}

function parseValue(v) {
  v = v.trim();
  if (v.startsWith('[') && v.endsWith(']') && !v.startsWith('[[')) return splitList(v.slice(1, -1)).map(parseScalar);
  return parseScalar(v);
}

const FM_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

// Reads the YAML subset kn writes plus block scalars (|, >) and block lists. Nested maps are skipped.
function parseFrontmatter(text) {
  const m = FM_RE.exec(text || '');
  if (!m) return { data: {}, body: (text || '').replace(/^﻿/, ''), hasFm: false };
  const data = {}; let lastKey = null; let block = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (block) {
      if (/^\s+\S/.test(raw) || !raw.trim()) { block.lines.push(raw.trim()); continue; }
      data[block.key] = block.lines.join(block.fold ? ' ' : '\n').trim(); block = null;
    }
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && lastKey) {
      if (!Array.isArray(data[lastKey])) data[lastKey] = [];
      data[lastKey].push(parseScalar(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(raw);
    if (!kv) continue;
    lastKey = kv[1];
    if (kv[2] && /^[|>][+-]?$/.test(kv[2].trim())) { block = { key: lastKey, fold: kv[2].trim()[0] === '>', lines: [] }; continue; }
    data[lastKey] = kv[2] === undefined ? '' : parseValue(kv[2]);
  }
  if (block) data[block.key] = block.lines.join(block.fold ? ' ' : '\n').trim();
  return { data, body: text.slice(m[0].length), hasFm: true };
}

function yamlScalar(v) {
  if (v === null || v === undefined) return '""';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '') return '""';
  if (/^[A-Za-z0-9_./@+-][A-Za-z0-9_ ./@+:-]*$/.test(s) && !/:\s|\s$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return s;
  return JSON.stringify(s);
}

function yamlLine(k, v) { return Array.isArray(v) ? `${k}: [${v.map(yamlScalar).join(', ')}]` : `${k}: ${yamlScalar(v)}`; }

function stringifyFrontmatter(data) {
  return ['---', ...Object.entries(data).map(([k, v]) => yamlLine(k, v)), '---'].join('\n') + '\n';
}

// Rewrites only the given keys (and their continuation lines); every other line is kept verbatim,
// so YAML this parser does not understand (nested maps, comments) survives.
function updateFrontmatter(file, updates) {
  const text = readText(file);
  const m = FM_RE.exec(text);
  if (!m) { writeText(file, stringifyFrontmatter(updates) + text); return; }
  const lines = m[1].split(/\r?\n/);
  for (const [k, v] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}:`) && /^[^:]+:(\s|$)/.test(l));
    if (i === -1) { lines.push(yamlLine(k, v)); continue; }
    let j = i + 1;
    while (j < lines.length && (/^\s+\S/.test(lines[j]) || /^-\s/.test(lines[j]))) j++;
    lines.splice(i, j - i, yamlLine(k, v));
  }
  writeText(file, `---\n${lines.join('\n')}\n---\n${text.slice(m[0].length)}`);
}

function asList(v) { return Array.isArray(v) ? v : (v ? [v] : []); }

// ---------------------------------------------------------------- capture helpers (redact / truncate / images)

const REDACTIONS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED:private-key]'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, '[REDACTED:api-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, '[REDACTED:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, '[REDACTED:github-token]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '[REDACTED:slack-token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED:google-key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED:jwt]'],
  [/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1[REDACTED]@'],
  [/((?:api[_-]?key|secret|token|access[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?)[^\s"',;]{8,}/gi, '$1[REDACTED]'],
  [/((?:password|passwd|pwd)["']?\s*[:=]\s*["']?)[^\s"',;]{3,}/gi, '$1[REDACTED]'],
];

// Object keys whose values are secrets regardless of what the value looks like.
const SECRET_KEY = /^(.*[_-])?(pass(word|wd)?|pwd)$|password|secret|(^|[_-])token$|api[_-]?key|^auth(orization)?$|credential|private[_-]?key|cookie/i;

function redact(s) {
  if (typeof s !== 'string' || !s) return s;
  for (const [re, rep] of REDACTIONS) s = s.replace(re, rep);
  return s;
}

function truncate(s, max) {
  if (typeof s !== 'string' || s.length <= max) return s;
  const head = Math.floor(max * 0.6); const tail = Math.floor(max * 0.3);
  return `${s.slice(0, head)}\n…[truncated ${s.length - head - tail} chars]…\n${s.slice(-tail)}`;
}

const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function saveImage(root, mediaType, b64, keep) {
  const bytes = Math.floor(b64.length * 3 / 4);
  if (!keep || !root) return { image: 'elided', media_type: mediaType, bytes };
  const buf = Buffer.from(b64, 'base64');
  const rel = `assets/captured/${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${IMAGE_EXT[mediaType] || 'bin'}`;
  const abs = knPath(root, ...rel.split('/'));
  if (!fs.existsSync(abs)) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, buf); }
  return { image: rel, media_type: mediaType, bytes: buf.length };
}

// Replaces inline base64 images with a file reference (or a stub) and redacts/truncates strings.
function sanitize(value, opts, depth = 0) {
  const { root, keepImages, max } = opts;
  if (depth > 12) return '[depth-limit]';
  if (typeof value === 'string') {
    const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
    if (m && m[2].length > 200) return saveImage(root, m[1], m[2].replace(/\s/g, ''), keepImages);
    return truncate(redact(value), max);
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, opts, depth + 1));
  if (value && typeof value === 'object') {
    const src = value.source;
    if (value.type === 'image' && src && src.type === 'base64' && typeof src.data === 'string') {
      return saveImage(root, src.media_type || 'image/png', src.data, keepImages);
    }
    if (value.type === 'image' && value.file && typeof value.file.base64 === 'string') {
      return saveImage(root, value.file.type || value.file.media_type || 'image/png', value.file.base64, keepImages);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) && typeof v === 'string' && v.length ? '[REDACTED]' : sanitize(v, opts, depth + 1);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------- journal (raw layer)

function sessionTag(host, sessionId) {
  const s = String(sessionId || 'nosession').replace(/[^A-Za-z0-9]/g, '');
  return `${host || 'unknown'}-${s.slice(-10) || 'nosession'}`;
}

function journalFile(root, host, sessionId, date = today()) {
  return knPath(root, 'journal', date, `${sessionTag(host, sessionId)}.jsonl`);
}

function appendJournal(root, host, sessionId, entry) {
  const file = journalFile(root, host, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: nowIso(), host, ...entry }) + '\n');
  return file;
}

function notesFile(root, date = today()) { return knPath(root, 'journal', date, 'notes.md'); }

function appendNote(root, { title, body, host }) {
  const date = today();
  const file = notesFile(root, date);
  if (!fs.existsSync(file)) {
    // 'wx': two sessions creating the day's file at once must not overwrite each other's first note.
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, stringifyFrontmatter({
        title: `Notes ${date}`, type: 'journal', permalink: `journal/${date}/notes`,
        created: nowIso(), bm_parse_semantics: false,
      }) + `# Notes ${date}\n`, { flag: 'wx' });
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const time = nowIso().slice(11, 16);
  fs.appendFileSync(file, `\n## ${time} [${host || 'agent'}] ${String(title || 'note').trim()}\n\n${redact(String(body || '').trim())}\n`);
  return file;
}

function listFiles(dir, filter) {
  const out = [];
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (!filter || filter(p)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

function curatedLedgerPath(root) { return knPath(root, 'journal', '.curated.json'); }

// "path@size" pins a journal file to the bytes that were actually read, so appends that land
// between digest and mark-curated stay pending.
function parseSpec(spec) { const m = /^(.*)@(\d+)$/.exec(spec); return m ? { path: m[1], size: Number(m[2]) } : { path: spec, size: null }; }

function pendingJournal(root) {
  const ledger = readJson(curatedLedgerPath(root), {});
  const out = [];
  for (const f of listFiles(knPath(root, 'journal'), (p) => /\.(jsonl|md)$/.test(p))) {
    const rel = toPosix(path.relative(knPath(root), f));
    const size = fs.statSync(f).size;
    const from = ledger[rel] || 0;
    if (size > from) out.push({ path: rel, from, size });
  }
  return out;
}

function markCurated(root, specs) {
  const ledger = readJson(curatedLedgerPath(root), {});
  const pend = pendingJournal(root);
  const wanted = specs ? specs.map(parseSpec) : pend.map((p) => ({ path: p.path, size: p.size }));
  let n = 0;
  for (const w of wanted) {
    const p = pend.find((x) => x.path === w.path);
    if (!p) continue;
    ledger[p.path] = Math.max(ledger[p.path] || 0, Math.min(w.size == null ? p.size : w.size, p.size));
    n++;
  }
  writeJson(curatedLedgerPath(root), ledger);
  return n;
}

function summarizeValue(v, n) {
  if (v == null) return '';
  if (typeof v === 'string') return v.replace(/\s+/g, ' ').slice(0, n);
  if (typeof v === 'object') {
    for (const k of ['command', 'cmd', 'file_path', 'path', 'pattern', 'url', 'query', 'prompt', 'description']) {
      if (typeof v[k] === 'string') return `${k}=${v[k].replace(/\s+/g, ' ').slice(0, n)}`;
    }
  }
  return JSON.stringify(v).slice(0, n);
}

function digest(root, spec, from = 0) {
  const { path: rel, size } = parseSpec(spec);
  const file = knPath(root, ...rel.split('/'));
  const raw = fs.readFileSync(file);
  const buf = raw.subarray(from, size == null ? raw.length : size).toString('utf8');
  if (rel.endsWith('.md')) return buf;
  const lines = [];
  for (const line of buf.split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const t = String(e.ts || '').slice(11, 19);
    const who = e.agent_id ? `(sub:${e.agent_type || e.agent_id})` : '';
    switch (e.ev) {
      case 'prompt': lines.push(`${t} USER${who}: ${summarizeValue(e.prompt, 600)}`); break;
      case 'tool': lines.push(`${t} TOOL${who} ${e.tool}${e.error ? ' FAILED' : ''}: ${summarizeValue(e.input, 200)} => ${summarizeValue(e.error || e.response, 300)}`); break;
      case 'stop': lines.push(`${t} ASSISTANT${who}: ${summarizeValue(e.message, 800)}`); break;
      case 'compact': lines.push(`${t} COMPACT ${e.phase}: ${summarizeValue(e.summary, 1500)}`); break;
      default: lines.push(`${t} ${e.ev}${who} ${summarizeValue(e.detail || e.source || e.reason || '', 200)}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- curated notes

function loadNotes(root) {
  const notes = [];
  for (const [kind, dir] of Object.entries(CURATED_DIRS)) {
    for (const f of listFiles(knPath(root, dir), (p) => p.endsWith('.md'))) {
      const text = readText(f) || '';
      const { data, body } = parseFrontmatter(text);
      notes.push({ kind, file: f, rel: toPosix(path.relative(knPath(root), f)), stem: path.basename(f, '.md'), data, body, lines: text.split('\n').length });
    }
  }
  return notes;
}

function templateFor(root, kind) {
  for (const dir of ['templates.local', 'templates']) {
    const t = readText(knPath(root, dir, `${kind}.md`));
    if (t != null) return t;
  }
  return readText(path.join(PLUGIN_ROOT, 'templates', 'core', `${kind}.md`));
}

function fill(tpl, vars) { return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m)); }

function newNote(root, kind, { title, slug: slugOpt, fields = {} }) {
  if (!CURATED_DIRS[kind]) throw new Error(`unknown kind "${kind}" (use ${Object.keys(CURATED_DIRS).join('|')})`);
  if (!title) throw new Error('--title is required');
  title = String(title).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const now = nowIso();
  const id = `${KIND_PREFIX[kind]}-${shortHash(title + now + Math.random())}`;
  // A slug made from a mostly non-Latin title ("2") is noise; fall back to the id alone.
  let slug = slugify(slugOpt || title);
  if (!slugOpt && (slug.match(/[a-z]/g) || []).length < 3) slug = '';
  const stem = kind === 'entity' ? (slug || id) : `${today()}-${slug ? `${slug}-` : ''}${id.slice(4)}`;
  const rel = `${CURATED_DIRS[kind]}/${stem}.md`;
  const file = knPath(root, ...rel.split('/'));
  if (fs.existsSync(file)) throw new Error(`${rel} already exists${kind === 'entity' ? ' (reuse that entity, or pass a different --slug)' : ''}`);
  const tpl = templateFor(root, kind);
  if (!tpl) throw new Error(`no template for ${kind}`);
  const text = fill(tpl, { id, title: JSON.stringify(title).slice(1, -1), title_raw: title, now, date: today(), stem, permalink: rel.replace(/\.md$/, '') });
  const { data, body } = parseFrontmatter(text);
  writeText(file, stringifyFrontmatter({ ...data, ...fields }) + body);
  return { id, file, rel };
}

// ---------------------------------------------------------------- links, toc, graph

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

function wikilinks(text) { const out = []; let m; WIKILINK.lastIndex = 0; while ((m = WIKILINK.exec(text))) out.push(m[1].trim()); return out; }

function resolver(notes) {
  const map = new Map();
  for (const n of notes) {
    for (const key of [n.data.id, n.data.permalink, n.stem, n.rel.replace(/\.md$/, ''), n.data.title]) {
      if (key) map.set(String(key).toLowerCase(), n);
    }
    for (const a of asList(n.data.aliases)) map.set(String(a).toLowerCase(), n);
  }
  return (target) => map.get(String(target).toLowerCase()) || null;
}

function anchor(h) { return h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-'); }

function headings(body) {
  const out = []; let fence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2] });
  }
  return out;
}

const TOC_START = '<!-- toc:start -->';
const TOC_END = '<!-- toc:end -->';

function withToc(text) {
  const { body } = parseFrontmatter(text);
  const hs = headings(body.replace(new RegExp(`${TOC_START}[\\s\\S]*?${TOC_END}`), ''));
  const toc = [TOC_START, '**Contents**', ...hs.map((h) => `${h.level === 3 ? '  ' : ''}- [${h.text}](#${anchor(h.text)})`), TOC_END].join('\n');
  const head = text.slice(0, text.length - body.length);
  if (body.includes(TOC_START)) return head + body.replace(new RegExp(`${TOC_START}[\\s\\S]*?${TOC_END}`), toc);
  // Insert right after the first H1 of the body (outside code fences), or at the top of the body.
  let pos = 0; let fence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^# /.test(line)) { const at = pos + line.length; return `${head}${body.slice(0, at)}\n\n${toc}\n${body.slice(at)}`; }
    pos += line.length + 1;
  }
  return `${head}${toc}\n\n${body}`;
}

const RELATION_FIELDS = ['about', 'derived_from', 'depends_on', 'supersedes', 'superseded_by', 'related'];

function buildGraph(notes) {
  const resolve = resolver(notes);
  const nodes = notes.map((n) => ({ id: n.data.id || n.stem, title: n.data.title || n.stem, type: n.kind, path: n.rel, status: n.data.status || n.data.outcome || '' }));
  const edges = [];
  for (const n of notes) {
    const from = n.data.id || n.stem;
    for (const f of RELATION_FIELDS) {
      for (const v of asList(n.data[f])) for (const t of wikilinks(String(v)).concat(/\[\[/.test(String(v)) ? [] : [String(v)])) {
        const hit = resolve(t); if (hit) edges.push({ from, to: hit.data.id || hit.stem, rel: f });
      }
    }
    for (const t of wikilinks(n.body)) { const hit = resolve(t); if (hit) edges.push({ from, to: hit.data.id || hit.stem, rel: 'links_to' }); }
  }
  return { generated: nowIso(), nodes, edges };
}

// ---------------------------------------------------------------- INDEX.md

const PRIORITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 };
const MANUAL_START = '<!-- manual:start -->';
const MANUAL_END = '<!-- manual:end -->';
const BIG_DOC_LINES = 150;

function link(n) { return `[${n.data.title || n.stem}](${n.rel})`; }

// The hand-written block of INDEX.md. A damaged end marker must not lose the text: keep up to the next section.
function manualBlock(old) {
  const s = old.indexOf(MANUAL_START);
  if (s === -1) return `${MANUAL_START}\n<!-- 사람이 직접 쓰는 영역. kn index가 보존한다. 프로젝트 목표, 절대 규칙 등. -->\n${MANUAL_END}`;
  const e = old.indexOf(MANUAL_END, s);
  if (e !== -1) return old.slice(s, e + MANUAL_END.length);
  const next = old.indexOf('\n## ', s);
  return `${old.slice(s, next === -1 ? old.length : next).trimEnd()}\n${MANUAL_END}`;
}

function buildIndex(root) {
  const cfg = loadConfig(root);
  const notes = loadNotes(root);
  const graph = buildGraph(notes);
  const isLive = (n) => !['superseded', 'retracted'].includes(n.data.status);
  const live = notes.filter(isLive);
  const byPriority = (a, b) => (PRIORITY_RANK[a.data.priority] ?? 2) - (PRIORITY_RANK[b.data.priority] ?? 2);
  const L = [];
  const old = readText(knPath(root, 'INDEX.md')) || '';
  const manual = manualBlock(old);

  L.push(stringifyFrontmatter({ title: 'Knowledge Index', type: 'index', permalink: 'knowledge-index', modified: nowIso(), bm_parse_semantics: false }).trimEnd());
  L.push('# Knowledge Index', '');
  L.push(`> 자동 생성: \`node .knowledge/bin/kn.cjs index\` · profile: **${cfg.profile}** · 노트 ${notes.length}개 (유효 ${live.length}개)`);
  L.push('> 순서: 0 → 1에서 지금 상황에 맞는 문서를 찾고, 필요할 때만 나머지를 연다.', '');
  L.push('## 프로젝트 메모 (수동)', '', manual, '');

  const first = live.filter((n) => ['critical', 'high'].includes(n.data.priority)).sort(byPriority);
  L.push('## 0. 먼저 읽기', '');
  if (first.length) for (const n of first) L.push(`- **${n.data.priority}** ${link(n)}${n.data.claim ? ` — ${n.data.claim}` : ''}`);
  else L.push('- (priority: critical/high 노트 없음)');
  L.push('');

  const routed = live.filter((n) => n.data.when).sort(byPriority);
  L.push('## 1. 상황별 라우팅', '');
  if (routed.length) for (const n of routed) L.push(`- ${n.data.when} → ${link(n)}`);
  else L.push('- (노트의 `when:` 필드가 채워지면 여기에 나타난다)');
  L.push('');

  const findings = live.filter((n) => n.kind === 'finding' && n.data.status !== 'disputed').sort(byPriority);
  L.push('## 2. 확정된 지식 (findings)', '');
  if (findings.length) for (const n of findings) L.push(`- ${link(n)}${n.data.claim ? ` — ${n.data.claim}` : ''}${n.data.confidence ? ` _(${n.data.confidence})_` : ''}`);
  else L.push('- (없음)');
  L.push('');

  const attempts = notes.filter((n) => n.kind === 'attempt').sort((a, b) => String(b.data.created).localeCompare(String(a.data.created)));
  const open = attempts.filter((n) => ['pending', ''].includes(n.data.outcome || ''));
  L.push('## 3. 진행 중인 시도', '');
  if (open.length) for (const n of open) L.push(`- ${link(n)}`); else L.push('- (없음)');
  L.push('');
  L.push('## 4. 최근 시도', '');
  if (attempts.length) for (const n of attempts.slice(0, 15)) L.push(`- \`${n.data.outcome || '?'}\` ${String(n.data.created || '').slice(0, 10)} ${link(n)}`);
  else L.push('- (없음)');
  L.push('');

  const tags = new Map();
  for (const n of live) for (const t of asList(n.data.tags)) { if (!tags.has(t)) tags.set(t, []); tags.get(t).push(n); }
  L.push('## 5. 주제별', '');
  if (tags.size) for (const [t, ns] of [...tags].sort((a, b) => b[1].length - a[1].length)) L.push(`- **${t}** (${ns.length}): ${ns.slice(0, 12).map(link).join(', ')}`);
  else L.push('- (태그 없음)');
  L.push('');

  const inbound = new Map();
  for (const e of graph.edges) inbound.set(e.to, (inbound.get(e.to) || 0) + 1);
  const hubs = live.filter((n) => inbound.get(n.data.id || n.stem)).sort((a, b) => inbound.get(b.data.id || b.stem) - inbound.get(a.data.id || a.stem)).slice(0, 10);
  L.push('## 6. 허브 (많이 참조됨)', '');
  if (hubs.length) for (const n of hubs) L.push(`- ${link(n)} ← ${inbound.get(n.data.id || n.stem)}`); else L.push('- (링크 없음)');
  L.push('');

  const big = live.filter((n) => n.lines > BIG_DOC_LINES);
  L.push('## 7. 큰 문서 목차', '');
  if (big.length) {
    for (const n of big) {
      L.push(`- ${link(n)} (${n.lines}줄)`);
      for (const h of headings(n.body).filter((h) => h.level === 2)) L.push(`  - [${h.text}](${n.rel}#${anchor(h.text)})`);
    }
  } else L.push('- (없음)');
  L.push('');

  const disputed = live.filter((n) => n.data.status === 'disputed');
  L.push('## 8. 분쟁 중 (사람 확인 필요)', '');
  if (disputed.length) for (const n of disputed) L.push(`- ${link(n)}`); else L.push('- (없음)');
  L.push('');

  const pend = pendingJournal(root);
  L.push('## 9. 원본 기록 상태', '');
  L.push(`- 미정리 원본 파일: ${pend.length}개${pend.length >= cfg.curate.remindAfterFiles ? ' — **/curate 권장**' : ''}`);
  L.push('- 원본 위치: `journal/<날짜>/` (`*.jsonl` = 훅 자동 기록, `notes.md` = 에이전트 서술)', '');

  const history = notes.filter((n) => !isLive(n));
  L.push('## 10. 이력 (대체·철회됨)', '');
  if (history.length) {
    L.push('<details><summary>펼치기</summary>', '');
    for (const n of history) L.push(`- \`${n.data.status}\` ${link(n)}${asList(n.data.superseded_by).length ? ` → ${asList(n.data.superseded_by).join(', ')}` : ''}`);
    L.push('', '</details>');
  } else L.push('- (없음)');
  L.push('');

  // Only the timestamp changed → leave the files alone (no git noise).
  const stamp = /^(modified|  "generated"): .*$/gm;
  const next = L.join('\n');
  if (next.replace(stamp, '') !== old.replace(stamp, '')) writeText(knPath(root, 'INDEX.md'), next);
  const graphText = JSON.stringify(graph, null, 2) + '\n';
  if (graphText.replace(stamp, '') !== (readText(knPath(root, 'graph.json')) || '').replace(stamp, '')) writeText(knPath(root, 'graph.json'), graphText);
  return { notes: notes.length, live: live.length, pending: pend.length };
}

// ---------------------------------------------------------------- lint

const ENUMS = {
  status: ['active', 'superseded', 'retracted', 'disputed'],
  outcome: ['success', 'fail', 'partial', 'pending', 'abandoned'],
  priority: ['critical', 'high', 'normal', 'low'],
  confidence: ['high', 'medium', 'low'],
};

function lint(root, { fix = false } = {}) {
  const notes = loadNotes(root);
  const resolve = resolver(notes);
  const errors = []; const warnings = [];
  const seen = new Map();
  for (const n of notes) {
    const d = n.data; const at = n.rel;
    if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(path.basename(n.file))) errors.push(`${at}: 파일명은 ASCII kebab-case여야 한다 (Basic Memory permalink 호환)`);
    for (const k of ['id', 'title', 'type', 'permalink', 'created']) if (!d[k]) errors.push(`${at}: frontmatter '${k}' 없음`);
    if (d.type && d.type !== n.kind) errors.push(`${at}: type '${d.type}' ≠ 폴더 종류 '${n.kind}'`);
    const expectPermalink = n.rel.replace(/\.md$/, '');
    if (d.permalink && d.permalink !== expectPermalink) warnings.push(`${at}: permalink '${d.permalink}' ≠ '${expectPermalink}'`);
    if (d.id) { if (seen.has(d.id)) errors.push(`${at}: id 중복 (${seen.get(d.id)})`); seen.set(d.id, at); }
    for (const [k, vals] of Object.entries(ENUMS)) if (d[k] && !vals.includes(d[k])) errors.push(`${at}: ${k} '${d[k]}' ∉ {${vals.join(', ')}}`);
    if (n.kind === 'finding') {
      if (!asList(d.sources).length) errors.push(`${at}: finding은 sources가 1개 이상 필요`);
      if (d.status === 'superseded' && !asList(d.superseded_by).length) errors.push(`${at}: superseded인데 superseded_by 없음`);
    }
    for (const v of asList(d.superseded_by)) {
      for (const t of wikilinks(String(v))) {
        const hit = resolve(t);
        if (!hit) errors.push(`${at}: superseded_by 대상 없음 [[${t}]]`);
        else if (!asList(hit.data.supersedes).some((s) => wikilinks(String(s)).some((x) => resolve(x) === n))) {
          if (fix) {
            // Re-read: an earlier --fix in this loop may already have changed this file.
            const fresh = parseFrontmatter(readText(hit.file)).data;
            hit.data = fresh;
            updateFrontmatter(hit.file, { supersedes: [...asList(fresh.supersedes), `[[${d.id || n.stem}]]`] });
            hit.data.supersedes = [...asList(fresh.supersedes), `[[${d.id || n.stem}]]`];
            warnings.push(`${hit.rel}: supersedes 역링크 추가함`);
          }
          else errors.push(`${hit.rel}: supersedes에 [[${d.id || n.stem}]] 역링크 없음 (--fix로 추가)`);
        }
      }
    }
    for (const t of wikilinks(n.body).concat(...RELATION_FIELDS.map((f) => asList(d[f]).flatMap((v) => wikilinks(String(v)))))) {
      if (!resolve(t)) warnings.push(`${at}: 해석 안 되는 링크 [[${t}]] (아직 없는 노트라면 정상)`);
    }
    if (n.lines > BIG_DOC_LINES && !n.body.includes(TOC_START)) {
      if (fix) { writeText(n.file, withToc(readText(n.file))); warnings.push(`${at}: 목차 추가함`); }
      else warnings.push(`${at}: ${n.lines}줄 — 목차 없음 (--fix 또는 kn toc)`);
    }
  }
  return { errors, warnings, count: notes.length };
}

// ---------------------------------------------------------------- init / upgrade

const BLOCK_START = '<!-- my-default-env:start -->';
const BLOCK_END = '<!-- my-default-env:end -->';

function upsertBlock(file, block) {
  const text = readText(file);
  const wrapped = `${BLOCK_START}\n${block.trim()}\n${BLOCK_END}`;
  if (text == null) { writeText(file, wrapped + '\n'); return 'created'; }
  const s = text.indexOf(BLOCK_START); const e = text.indexOf(BLOCK_END);
  const count = (m) => text.split(m).length - 1;
  if (s !== -1 || e !== -1) {
    if (count(BLOCK_START) !== 1 || count(BLOCK_END) !== 1 || e < s) throw new Error(`${path.basename(file)}: my-default-env 블록 표시가 깨짐 — ${BLOCK_START} / ${BLOCK_END} 를 한 쌍만 남기고 다시 실행`);
    const next = text.slice(0, s) + wrapped + text.slice(e + BLOCK_END.length);
    if (next === text) return 'unchanged';
    writeText(file, next); return 'updated';
  }
  writeText(file, `${text.replace(/\s*$/, '')}\n\n${wrapped}\n`); return 'appended';
}

function ensureLines(file, lines) {
  const text = readText(file) || '';
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const add = lines.filter((l) => !have.has(l.trim()));
  if (!add.length) return 0;
  writeText(file, `${text.replace(/\s*$/, '')}${text.trim() ? '\n' : ''}${add.join('\n')}\n`);
  return add.length;
}

function profileFile(profile, name) {
  const p = path.join(PLUGIN_ROOT, 'templates', 'profiles', profile, name);
  return fs.existsSync(p) ? p : path.join(PLUGIN_ROOT, 'templates', 'core', name);
}

function install(dir, { profile, upgrade = false } = {}) {
  const root = path.resolve(dir);
  const log = [];
  const cfgPath = knPath(root, 'config.json');
  if (!fs.existsSync(path.join(PLUGIN_ROOT, 'templates', 'core'))) {
    throw new Error('templates not found — run init/upgrade with the plugin\'s kn.cjs, not the project copy (.knowledge/bin/kn.cjs)');
  }
  const existing = readJson(cfgPath, null);
  if (upgrade && !existing) throw new Error('.knowledge/config.json 없음 — 먼저 init');
  profile = profile || (existing && existing.profile) || 'code';
  if (!PROFILES.includes(profile)) throw new Error(`unknown profile "${profile}" (use ${PROFILES.join('|')})`);
  const profileCfg = readJson(path.join(PLUGIN_ROOT, 'templates', 'profiles', profile, 'config.json'), {});
  // Same profile: the project's own settings win. Switching profile: the new profile's settings win.
  const switching = existing && existing.profile && existing.profile !== profile;
  const cfg = switching
    ? deepMerge(deepMerge(DEFAULT_CONFIG, existing), profileCfg)
    : deepMerge(deepMerge(DEFAULT_CONFIG, profileCfg), existing || {});
  cfg.profile = profile; cfg.version = VERSION;
  if (!existing) cfg.created = nowIso();
  cfg.updated = nowIso();
  writeJson(cfgPath, cfg);
  log.push(`${existing ? 'updated' : 'created'} .knowledge/config.json (profile ${profile})`);

  for (const d of [...Object.values(CURATED_DIRS), 'journal', 'assets', 'templates.local']) {
    const p = knPath(root, d);
    if (!fs.existsSync(p)) { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, '.gitkeep'), ''); }
  }

  // Plugin-owned files are always refreshed; project customizations go to templates.local/.
  fs.copyFileSync(__filename, (fs.mkdirSync(knPath(root, 'bin'), { recursive: true }), knPath(root, 'bin', 'kn.cjs')));
  for (const kind of Object.keys(CURATED_DIRS)) fs.copyFileSync(profileFile(profile, `${kind}.md`), (fs.mkdirSync(knPath(root, 'templates'), { recursive: true }), knPath(root, 'templates', `${kind}.md`)));
  fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'core', 'README.md'), knPath(root, 'README.md'));
  log.push('refreshed .knowledge/bin/kn.cjs, templates/, README.md');

  const block = [readText(path.join(PLUGIN_ROOT, 'templates', 'core', 'AGENTS.block.md')), readText(path.join(PLUGIN_ROOT, 'templates', 'profiles', profile, 'AGENTS.profile.md')) || '']
    .join('\n').replace(/\{\{profile\}\}/g, profile).replace(/\{\{version\}\}/g, VERSION);
  log.push(`AGENTS.md: ${upsertBlock(path.join(root, 'AGENTS.md'), block)}`);
  const claudeMd = path.join(root, 'CLAUDE.md');
  const cm = readText(claudeMd);
  const real = (f) => { try { return fs.realpathSync(f); } catch { return f; } };
  if (cm == null) { writeText(claudeMd, '@AGENTS.md\n'); log.push('CLAUDE.md: created (@AGENTS.md stub)'); }
  else if (real(claudeMd) === real(path.join(root, 'AGENTS.md'))) log.push('CLAUDE.md: same file as AGENTS.md (symlink), left as is');
  else if (!/^@AGENTS\.md\s*$/m.test(cm)) { writeText(claudeMd, `@AGENTS.md\n\n${cm}`); log.push('CLAUDE.md: prepended @AGENTS.md'); }

  const { execFileSync } = require('child_process');
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  try { git(['rev-parse', '--git-dir']); } catch {
    try { git(['init', '-q']); log.push('git init'); } catch { log.push('WARN git 없음 — git을 설치하고 git init 하세요'); }
  }

  // A repo-wide LFS pattern over files already committed as normal blobs would make them all look modified.
  const rules = (readText(profileFile(profile, 'gitattributes')) || '').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const keep = rules.filter((r) => {
    const pattern = r.split(/\s+/)[0];
    if (pattern.startsWith('.knowledge/')) return true;
    let tracked = ''; try { tracked = git(['ls-files', '--', pattern]); } catch {}
    if (!tracked) return true;
    log.push(`WARN LFS rule skipped for ${pattern}: already-committed files match (convert with: git lfs migrate import --include="${pattern}")`);
    return false;
  });
  const added = ensureLines(path.join(root, '.gitattributes'), keep);
  log.push(`.gitattributes: +${added} LFS rules`);
  ensureLines(path.join(root, '.gitignore'), ['.knowledge/.state/', '.knowledge/**/*.tmp']);
  try { git(['lfs', 'install', '--local']); log.push('git lfs install --local'); } catch { log.push('WARN git-lfs 없음 — 이미지 LFS 추적이 동작하지 않음 (https://git-lfs.com)'); }

  buildIndex(root);
  log.push('built INDEX.md');
  return { root, profile, log };
}

// ---------------------------------------------------------------- status & context

function status(root) {
  const cfg = loadConfig(root);
  const notes = loadNotes(root);
  const count = (k) => notes.filter((n) => n.kind === k).length;
  const pend = pendingJournal(root);
  return {
    root, profile: cfg.profile, version: cfg.version, pluginVersion: VERSION,
    attempts: count('attempt'), findings: count('finding'), research: count('research'), entities: count('entity'),
    disputed: notes.filter((n) => n.data.status === 'disputed').length,
    pendingFiles: pend.length, pendingBytes: pend.reduce((a, p) => a + p.size - p.from, 0),
    curateRecommended: pend.length >= cfg.curate.remindAfterFiles,
  };
}

// Absolute command, so it works when the agent's cwd is a subfolder of the project.
function knCommand(root) { return `node "${toPosix(knPath(root, 'bin', 'kn.cjs'))}"`; }

function recentNotes(root, max = 3) {
  const jdir = knPath(root, 'journal');
  let days = []; try { days = fs.readdirSync(jdir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse(); } catch {}
  const out = [];
  for (const d of days) {
    const t = readText(path.join(jdir, d, 'notes.md'));
    if (!t) continue;
    const sections = parseFrontmatter(t).body.split(/\n(?=## \d{2}:\d{2} \[)/)
      .filter((s) => /^## \d{2}:\d{2} \[[^\]]*\] /.test(s) && !/^## \d{2}:\d{2} \[[^\]]*\] skip\s*$/m.test(s.split('\n')[0]));
    for (const s of sections.reverse()) { out.push(`[${d}] ${s.trim()}`); if (out.length >= max) return out; }
  }
  return out;
}

function sessionContext(root, { budget = 8000 } = {}) {
  const st = status(root);
  const idx = readText(knPath(root, 'INDEX.md')) || '';
  const pick = (title) => { const m = new RegExp(`## ${title}[\\s\\S]*?(?=\\n## |$)`).exec(idx); return m ? m[0].trim() : ''; };
  const kn = knCommand(root);
  const head = [
    `[my-default-env] 이 프로젝트는 연구노트 ${toPosix(knPath(root))}/ 를 쓴다 (profile: ${st.profile}). 프롬프트·도구 사용은 훅이 journal/에 자동 기록한다.`,
    `- 작업 전에 아래 "먼저 읽기"와 "상황별 라우팅"에서 지금 작업과 관련된 노트를 열어 본다. 전체: ${toPosix(knPath(root, 'INDEX.md'))}`,
    `- CLI: ${kn} (어느 폴더에서든 이 경로로 실행). 시도/실험 1건 = \`${kn} new attempt --title "..."\` 파일을 채운다. 작업 구간이 끝나면 \`${kn} note --title "..." "본문"\` (없으면 Stop 훅이 막는다).`,
    `- 노트: attempts ${st.attempts} · findings ${st.findings} · research ${st.research} · 분쟁 ${st.disputed} · 미정리 원본 ${st.pendingFiles}개${st.curateRecommended ? ' → **/curate 권장**' : ''}`,
  ].join('\n');
  const parts = [head, pick('0\\. 먼저 읽기'), pick('1\\. 상황별 라우팅'), pick('3\\. 진행 중인 시도')];
  const notes = recentNotes(root, 3);
  if (notes.length) parts.push(`## 최근 서술 기록 (다른 호스트 포함, 최신순)\n${notes.join('\n\n')}`);
  let text = parts.filter(Boolean).join('\n\n');
  // Shrink from the tail (oldest notes, then routing) until it fits.
  while (text.length > budget && parts.length > 1) { parts.pop(); text = parts.filter(Boolean).join('\n\n'); }
  if (text.length > budget) text = truncate(text, budget);
  return `<knowledge-context>\n${text}\n</knowledge-context>`;
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) opt[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[k] = argv[++i];
      else opt[k] = true;
      if (k === 'field') { opt.fields = opt.fields || []; opt.fields.push(opt.field); }
    } else pos.push(a);
  }
  return { pos, opt };
}

const HELP = `kn ${VERSION} — .knowledge notebook

  (init/upgrade work only from the plugin's kn.cjs, not the .knowledge/bin copy)
  init [--profile code|experiment|automation|creative] [--dir .]   set up .knowledge/ in a project
  upgrade [--dir .]                     refresh plugin-owned files, keep notes
  new <attempt|finding|research|entity> --title "..." [--slug ascii-name] [--field k=v ...]
  note --title "..." [--host claude|codex] ("body" | --file <path> | -)   append narrative note
  supersede <old> <new> [--reason "..."]   mark old finding superseded by new (both ways)
  index                                 rebuild INDEX.md and graph.json
  lint [--fix]                          check frontmatter, links, supersession, TOC
  toc <file>                            insert/refresh table of contents
  pending [--json]                      journal files not yet curated, as path@size
  digest <path[@size]> [--from N]       compact view of a raw journal file (up to size)
  mark-curated (--all | path@size ...)  record journal bytes as curated (use the @size you digested)
  status [--json]                       counts and backlog
  context                               print the SessionStart context block`;

// Which agent is running this shell. Codex is checked first: a Codex started from Claude inherits CLAUDECODE.
function shellHost() {
  if (process.env.KN_HOST) return process.env.KN_HOST;
  if (process.env.CODEX_THREAD_ID) return 'codex';
  if (process.env.CLAUDECODE) return 'claude';
  return 'human';
}

function readStdinSync() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }

function cli(argv) {
  const { pos, opt } = parseArgs(argv);
  const cmd = pos.shift();
  const out = (s) => process.stdout.write(s.endsWith('\n') ? s : s + '\n');
  if (!cmd || cmd === 'help' || opt.help) { out(HELP); return 0; }
  if (cmd === 'version') { out(VERSION); return 0; }
  if (cmd === 'init' || cmd === 'upgrade') {
    const r = install(opt.dir || process.cwd(), { profile: opt.profile, upgrade: cmd === 'upgrade' });
    out(`${cmd} ${r.root} (profile ${r.profile})\n` + r.log.map((l) => `  - ${l}`).join('\n'));
    return 0;
  }
  const root = findRoot(opt.dir || process.cwd());
  if (!root) { process.stderr.write('kn: .knowledge/config.json not found (run: kn init)\n'); return 2; }
  switch (cmd) {
    case 'new': {
      const fields = {};
      for (const f of opt.fields || []) { const [k, v] = f.split(/=(.*)/s); fields[k] = /^\[.*\]$/.test(v) ? parseValue(v) : v; }
      const r = newNote(root, pos[0], { title: opt.title, slug: opt.slug, fields });
      out(toPosix(path.relative(process.cwd(), r.file)));
      return 0;
    }
    case 'note': {
      let body = pos.join(' ');
      // Body from a file avoids shell quoting (PowerShell 5.1 mangles " and non-ASCII on stdin).
      if (opt.file) body = readText(path.resolve(opt.file)) ?? '';
      else if (body === '-') body = readStdinSync();
      if (!String(body).trim()) { process.stderr.write('kn: note body is empty (pass text, --file <path>, or - for stdin)\n'); return 2; }
      const f = appendNote(root, { title: opt.title, body, host: opt.host || shellHost() });
      out(toPosix(path.relative(process.cwd(), f)));
      return 0;
    }
    case 'supersede': {
      const notes = loadNotes(root); const resolve = resolver(notes);
      const oldN = resolve(pos[0]) || notes.find((n) => n.rel === pos[0] || n.file === path.resolve(pos[0]));
      const newN = resolve(pos[1]) || notes.find((n) => n.rel === pos[1] || n.file === path.resolve(pos[1]));
      if (!oldN || !newN) { process.stderr.write('kn: note not found\n'); return 2; }
      const now = nowIso(); const newId = newN.data.id || newN.stem; const oldId = oldN.data.id || oldN.stem;
      updateFrontmatter(oldN.file, { status: 'superseded', superseded_at: now, valid_until: oldN.data.valid_until || newN.data.valid_from || today(), superseded_by: [...new Set([...asList(oldN.data.superseded_by), `[[${newId}]]`])] });
      const t = readText(oldN.file); const { body } = parseFrontmatter(t);
      if (!body.includes('> SUPERSEDED')) writeText(oldN.file, `${t.slice(0, t.length - body.length)}\n> SUPERSEDED by [[${newId}]] (${today()})${opt.reason ? `: ${opt.reason}` : ''}\n${body}`);
      updateFrontmatter(newN.file, { supersedes: [...new Set([...asList(newN.data.supersedes), `[[${oldId}]]`])] });
      out(`${oldN.rel} → superseded by ${newN.rel}`);
      return 0;
    }
    case 'index': { const r = buildIndex(root); out(`INDEX.md: ${r.notes} notes (${r.live} live), ${r.pending} journal files pending`); return 0; }
    case 'lint': {
      const r = lint(root, { fix: !!opt.fix });
      for (const e of r.errors) out(`ERROR ${e}`);
      for (const w of r.warnings) out(`warn  ${w}`);
      out(`${r.count} notes, ${r.errors.length} errors, ${r.warnings.length} warnings`);
      return r.errors.length ? 1 : 0;
    }
    case 'toc': { const f = path.resolve(pos[0]); writeText(f, withToc(readText(f))); out(`toc: ${pos[0]}`); return 0; }
    case 'pending': {
      const p = pendingJournal(root);
      if (opt.json) out(JSON.stringify(p, null, 2));
      else out(p.length ? p.map((x) => `${x.path}@${x.size}\tfrom=${x.from}`).join('\n') : '(nothing pending)');
      return 0;
    }
    case 'digest': out(digest(root, pos[0], Number(opt.from || 0)) || '(empty)'); return 0;
    case 'mark-curated': out(`marked ${markCurated(root, opt.all ? null : pos)} file(s) curated`); return 0;
    case 'status': {
      const s = status(root);
      out(opt.json ? JSON.stringify(s, null, 2) : Object.entries(s).map(([k, v]) => `${k}: ${v}`).join('\n'));
      return 0;
    }
    case 'context': out(sessionContext(root, { budget: loadConfig(root).context.budget })); return 0;
    default: process.stderr.write(`kn: unknown command "${cmd}"\n${HELP}\n`); return 2;
  }
}

module.exports = {
  VERSION, KN, CURATED_DIRS, READ_ONLY_TOOLS, findRoot, knPath, loadConfig, nowIso, today,
  parseFrontmatter, stringifyFrontmatter, updateFrontmatter, sanitize, redact, truncate,
  sessionTag, journalFile, appendJournal, appendNote, knCommand, sleepMs, pendingJournal, markCurated, digest,
  loadNotes, newNote, buildIndex, buildGraph, lint, withToc, install, status, sessionContext, readJson, writeJson,
};

if (require.main === module) {
  try { process.exitCode = cli(process.argv.slice(2)); } catch (e) { process.stderr.write(`kn: ${e.message}\n`); process.exitCode = 1; }
}
