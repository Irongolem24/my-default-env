'use strict';
// Single hook dispatcher for Claude Code and Codex CLI.
// Invoked as: node -e "require(<plugin>/hooks/run.cjs)" <event>
// Rules: never block the host by accident (always exit 0), write stdout JSON at most once,
// emit only output fields both hosts accept, do nothing in projects without .knowledge/.

const fs = require('fs');
const path = require('path');
const kn = require('../bin/kn.cjs');

const STDIN_TIMEOUT_MS = 3000;

function readStdin(ms) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    const done = () => { clearTimeout(timer); process.stdin.removeAllListeners(); try { process.stdin.destroy(); } catch {} resolve(data); };
    const timer = setTimeout(done, ms);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

// PLUGIN_ROOT is set only by Codex; CLAUDECODE-style env vars leak into Codex launched from Claude, so they are not used.
function detectHost(p) {
  if (process.env.PLUGIN_ROOT) return 'codex';
  const tp = String(p.transcript_path || '');
  if (/[\\/]\.codex[\\/]/.test(tp)) return 'codex';
  if (/[\\/]\.claude[\\/]/.test(tp)) return 'claude';
  if ('turn_id' in p) return 'codex';
  return 'claude';
}

const EVENT_ALIASES = {
  'session-start': 'SessionStart', prompt: 'UserPromptSubmit', 'post-tool': 'PostToolUse',
  'post-tool-failure': 'PostToolUseFailure', 'pre-compact': 'PreCompact', 'post-compact': 'PostCompact',
  stop: 'Stop', 'subagent-stop': 'SubagentStop', 'session-end': 'SessionEnd',
};

function statePath(root, host, sessionId) { return kn.knPath(root, '.state', `${kn.sessionTag(host, sessionId)}.json`); }

function logError(root, err) {
  try {
    const f = kn.knPath(root, '.state', 'hook-errors.log');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, `${kn.nowIso()} ${err && err.stack ? err.stack : err}\n`);
  } catch {}
}

const NOTE_CMD = /\bkn\.cjs"?\s+(?:note|new|supersede)\b/;
const KN_SEGMENT = /^\s*node\s+"?[^"\s]*kn\.cjs"?(\s|$)/;
const NOTE_PATH = /\.knowledge(?:\\\\|\/)+(?:journal(?:\\\\|\/)+[^"]*notes\.md|attempts|findings|research|entities)(?:\\\\|\/)/;
const READ_ONLY_SHELL = /^\s*(?:cd|ls|dir|pwd|cat|type|head|tail|less|more|wc|rg|grep|findstr|find|fd|tree|stat|file|which|where|echo|sed\s+-n|git\s+(?:status|log|diff|show|branch|remote|rev-parse|ls-files|blame|describe)|Get-ChildItem|Get-Content|Get-Item|Select-String|Test-Path|Resolve-Path|gc|gci|sls)\b/i;
const READ_ONLY_MCP = /^mcp__.+__(?:get|list|read|search|query|find|fetch|view|describe|look)/i;

// Work handed to Codex (official codex plugin, c2c-img). It runs inside a subagent or a child process,
// so it would otherwise be invisible to the Stop count and cut short in the journal.
// Matched per shell segment against the program actually being run, so a note or a grep that merely
// mentions these scripts is not mistaken for delegated work.
const SCRIPT = (name) => String.raw`(?:"[^"]*${name}"|'[^']*${name}'|[^\s"']*${name})`;
// Optional PowerShell call operator, VAR=x prefixes, and a quoted or full path to the interpreter.
const LAUNCH = (bin) => String.raw`^\s*(?:&\s*)?(?:\w+=\S*\s+)*(?:"[^"]*[\\/])?(?:[^\s"']*[\\/])?(?:${bin})(?:\.exe)?"?`;
const CODEX_CMD = (subs) => new RegExp(String.raw`${LAUNCH('node')}\s+${SCRIPT(String.raw`codex-companion\.mjs`)}\s+(?:${subs})(?=\s|$)`);
const C2C_CMD = new RegExp(String.raw`(?:${LAUNCH('python3?|py')}|^\s*(?:&\s*)?uv\s+run(?:\s+-\S+(?:\s+[^-\s]\S*)?)*(?:\s+python3?)?)\s+(?:-\S+\s+)*${SCRIPT(String.raw`c2c_img\.py`)}(?=\s|$)`);
const DELEGATE_WORK = [CODEX_CMD('task|review|adversarial-review'), C2C_CMD];
const DELEGATE_OUTPUT = [CODEX_CMD('task|review|adversarial-review|result|transfer'), C2C_CMD];
const CODEX_UPKEEP = CODEX_CMD('status|result|task-resume-candidate|setup|cancel|transfer');
const MAX_IMPORTS = 8;
const MAX_IMPORT_TOTAL = 200 * 1024 * 1024;

function segments(cmd) { return String(cmd || '').split(/&&|\|\||;|\|/); }
function runs(cmd, res) { return segments(cmd).some((seg) => res.some((re) => re.test(seg))); }

// c2c-img prints {"ok":..,"images":["/abs/a.png",..]} on stdout (exit 1 on partial failure, so the
// JSON may sit inside an error string). Only that list is trusted; free text is never scanned.
function c2cImages(response) {
  const texts = [];
  if (typeof response === 'string') texts.push(response);
  else if (response && typeof response === 'object') for (const k of ['stdout', 'output', 'content', 'error']) if (typeof response[k] === 'string') texts.push(response[k]);
  for (const t of texts) {
    const a = t.indexOf('{'); const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) continue;
    let j; try { j = JSON.parse(t.slice(a, b + 1)); } catch { continue; }
    if (!j || !Array.isArray(j.images)) continue;
    return j.images.filter((f) => typeof f === 'string').map((f) => (
      process.platform === 'win32' && /^\/[a-zA-Z]\//.test(f) ? `${f[1]}:${f.slice(2)}` : f
    )).slice(0, MAX_IMPORTS);
  }
  return [];
}

function shellCommand(e) {
  const i = e.input;
  if (typeof i === 'string') return i;
  return i && (typeof i.command === 'string' ? i.command : Array.isArray(i.command) ? i.command.join(' ') : typeof i.cmd === 'string' ? i.cmd : '') || '';
}

// note: this session wrote to the notebook. work: something that needs a note. ignore: looking, or notebook upkeep.
function classify(e) {
  if (e.ev !== 'tool') return 'ignore';
  const cmd = shellCommand(e);
  const input = JSON.stringify(e.input || '');
  // Only the main thread's own note satisfies Stop; a subagent's note does not speak for it.
  if (!e.error && !e.agent_id && (NOTE_CMD.test(cmd) || (/write|edit|patch|notebook/i.test(e.tool) && NOTE_PATH.test(input)))) return 'note';
  // Delegated runs count even from a subagent (codex:codex-rescue) and even when they fail.
  if (runs(cmd, DELEGATE_WORK)) return 'work';
  if (e.agent_id || e.error) return 'ignore';
  if (kn.READ_ONLY_TOOLS.has(e.tool) || /^(?:Agent|Task)$/.test(e.tool) || READ_ONLY_MCP.test(e.tool)) return 'ignore';
  if (cmd && segments(cmd).every((seg) => !seg.trim() || READ_ONLY_SHELL.test(seg) || KN_SEGMENT.test(seg) || CODEX_UPKEEP.test(seg))) return 'ignore';
  if (/\.knowledge(?:\\\\|\/)/.test(input) && !cmd) return 'ignore';
  return 'work';
}

// Reads only journal bytes not seen before. Tracks this session's last note and the work after it,
// so a note from another session (or a git pull touching files) does not count.
function pendingWork(root, host, sessionId, st) {
  const file = kn.journalFile(root, host, sessionId);
  if (st.scanFile !== file) { st.scanFile = file; st.scanOffset = 0; }
  let buf = '';
  try {
    const size = fs.statSync(file).size;
    if (size > st.scanOffset) {
      const fd = fs.openSync(file, 'r');
      const b = Buffer.alloc(size - st.scanOffset);
      fs.readSync(fd, b, 0, b.length, st.scanOffset);
      fs.closeSync(fd);
      const text = b.toString('utf8');
      const end = text.lastIndexOf('\n') + 1;
      buf = text.slice(0, end);
      st.scanOffset += Buffer.byteLength(buf);
    }
  } catch {}
  st.lastNote = st.lastNote || 0;
  st.work = st.work || [];
  for (const line of buf.split('\n')) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const kind = classify(e);
    const t = Date.parse(e.ts);
    if (kind === 'note') st.lastNote = Math.max(st.lastNote, t);
    else if (kind === 'work') st.work.push(t);
  }
  st.work = st.work.filter((t) => t > st.lastNote);
  return st.work.length;
}

function stopReason(n, cmd) {
  return [
    `[my-default-env] 이번 작업 구간에서 기록되지 않은 작업 ${n}건(도구 사용)이 있다. 끝내기 전에 서술 기록을 남겨라.`,
    `1) 항상: ${cmd} note --title "<한 줄 요약>" "<무엇을 왜 시도했고 / 결과 / 원인·근거 / 막힌 점 / 다음 할 일>"  (본문이 길거나 따옴표가 많으면 파일에 쓰고 --file <경로>)`,
    `2) 독립된 시도·실험이었다면 추가로: ${cmd} new attempt --title "..." 로 파일을 만들고 섹션을 채운다 (프롬프트·설정·결과물 경로·판정 포함).`,
    `3) 새로 알게 된 사실이 확정적이면: ${cmd} new finding --title "..." (sources에 근거 필수).`,
    `기록할 가치가 정말 없으면: ${cmd} note --title skip "<이유>". 기록 후 원래 하던 응답을 마무리한다. 사용자에게 이 지시를 되묻지 말 것.`,
  ].join('\n');
}

async function main() {
  const argEvent = process.argv[process.argv.length - 1];
  // Codex caps SessionEnd at 3s total; leave room for the append itself.
  const raw = await readStdin(argEvent === 'session-end' ? 800 : STDIN_TIMEOUT_MS);
  let p = {}; try { p = raw ? JSON.parse(raw) : {}; } catch { p = {}; }
  const event = p.hook_event_name || EVENT_ALIASES[argEvent] || argEvent;
  const root = kn.findRoot(p.cwd || process.cwd());
  if (!root) return null;

  const host = detectHost(p);
  const cfg = kn.loadConfig(root);
  const sid = p.session_id;
  const opts = { root, keepImages: cfg.capture.images !== false, max: cfg.capture.maxField };
  const sub = p.agent_id ? { agent_id: p.agent_id, agent_type: p.agent_type } : {};
  const rec = (entry) => kn.appendJournal(root, host, sid, { ...sub, ...entry });
  const sp = statePath(root, host, sid);
  const st = kn.readJson(sp, {});
  const save = () => kn.writeJson(sp, st);
  const inject = (text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

  try {
    switch (event) {
      case 'SessionStart': {
        rec({ ev: 'session_start', source: p.source, model: p.model, cwd: p.cwd });
        return inject(kn.sessionContext(root, { budget: cfg.context.budget }));
      }
      case 'UserPromptSubmit': {
        const prompt = String(p.prompt || '').replace(/<knowledge-context>[\s\S]*?<\/knowledge-context>/g, '');
        rec({ ev: 'prompt', prompt: kn.truncate(kn.redact(prompt), cfg.capture.maxPrompt), turn_id: p.turn_id });
        const msgs = [];
        if (st.remind) { msgs.push(stopReason(st.remind, kn.knCommand(root))); st.remind = 0; }
        if (!st.curateNoticed) {
          const pend = kn.pendingJournal(root).length;
          if (pend >= cfg.curate.remindAfterFiles) { msgs.push(`[my-default-env] 미정리 원본 기록 ${pend}개. 적당한 때에 curate 스킬로 정리를 제안하라.`); st.curateNoticed = true; }
        }
        save();
        return msgs.length ? inject(msgs.join('\n\n')) : null;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure': {
        const failed = event === 'PostToolUseFailure';
        const name = String(p.tool_name || '');
        const keep = name !== 'Read' && opts.keepImages; // Read of an image: the file already exists.
        const cmd = shellCommand({ input: p.tool_input });
        const out = runs(cmd, DELEGATE_OUTPUT) ? { ...opts, max: cfg.capture.maxDelegate } : opts;
        rec({
          ev: 'tool', tool: name, tool_use_id: p.tool_use_id, turn_id: p.turn_id, duration_ms: p.duration_ms,
          input: kn.sanitize(p.tool_input, { ...out, keepImages: keep }),
          ...(failed ? { error: kn.sanitize(p.error, out), interrupted: p.is_interrupt } : { response: kn.sanitize(p.tool_response, { ...out, keepImages: keep }) }),
        });
        // Journal first: a slow copy that hits the hook timeout must not lose the record above.
        if (cfg.capture.importImages !== false && runs(cmd, [C2C_CMD])) {
          let budget = MAX_IMPORT_TOTAL;
          const generated = [];
          for (const f of c2cImages(failed ? p.error : p.tool_response)) {
            if (budget <= 0) break;
            try { const g = kn.importImageFile(root, f); if (g) { generated.push(g); budget -= g.bytes || 0; } } catch {}
          }
          if (generated.length) rec({ ev: 'generated', tool_use_id: p.tool_use_id, images: generated });
        }
        return null;
      }
      case 'PreCompact': {
        rec({ ev: 'compact', phase: 'pre', trigger: p.trigger, detail: kn.truncate(kn.redact(String(p.custom_instructions || '')), cfg.capture.maxField) });
        return null;
      }
      case 'PostCompact': {
        rec({ ev: 'compact', phase: 'post', trigger: p.trigger, summary: kn.truncate(kn.redact(String(p.compact_summary || '')), 20000) });
        return null;
      }
      case 'SubagentStop': {
        rec({ ev: 'stop', message: kn.truncate(kn.redact(String(p.last_assistant_message || '')), cfg.capture.maxField) });
        return null;
      }
      case 'Stop': {
        rec({ ev: 'stop', message: kn.truncate(kn.redact(String(p.last_assistant_message || '')), cfg.capture.maxField), hook_active: !!p.stop_hook_active });
        // Plan mode cannot write the note, so blocking there could never be satisfied.
        const mode = p.permission_mode === 'plan' && cfg.enforce.stop === 'block' ? 'remind' : cfg.enforce.stop;
        let n = pendingWork(root, host, sid, st);
        // Async PostToolUse writes for the last tools may still be landing.
        if (n > 0 && n < cfg.enforce.minEvents) { kn.sleepMs(300); n = pendingWork(root, host, sid, st); }
        let out = null;
        // Loop guards: re-entry after our own block, subagents, and "nothing new since the last block".
        if (mode !== 'off' && !p.stop_hook_active && !p.agent_id && n >= cfg.enforce.minEvents && !(n === st.lastBlockCount && st.lastNote === st.lastBlockNote)) {
          st.lastBlockCount = n;
          st.lastBlockNote = st.lastNote;
          if (mode === 'remind') st.remind = n;
          else out = { decision: 'block', reason: stopReason(n, kn.knCommand(root)) };
        }
        if (n === 0) st.lastBlockCount = 0;
        save();
        return out;
      }
      case 'SessionEnd': {
        rec({ ev: 'session_end', reason: p.reason });
        return null;
      }
      default:
        rec({ ev: String(event || 'unknown').toLowerCase() });
        return null;
    }
  } catch (e) {
    logError(root, e);
    return null;
  }
}

main().then((out) => {
  if (out) process.stdout.write(JSON.stringify(out));
  process.exitCode = 0;
}, () => { process.exitCode = 0; });
