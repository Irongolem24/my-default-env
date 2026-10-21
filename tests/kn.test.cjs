'use strict';
// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'my-default-env');
const KN = path.join(PLUGIN, 'bin', 'kn.cjs');
const kn = require(KN);

function project(profile = 'code') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-test-'));
  kn.install(dir, { profile });
  return dir;
}

function cli(dir, ...args) {
  const r = spawnSync(process.execPath, [path.join(dir, '.knowledge', 'bin', 'kn.cjs'), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, KN_HOST: 'test' } });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

function hook(dir, event, payload, env = {}) {
  const code = "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT||process.env.PLUGIN_ROOT,'hooks','run.cjs'))";
  const r = spawnSync(process.execPath, ['-e', code, event], {
    input: JSON.stringify({ session_id: 'sess-0001-abcdef', cwd: dir, ...payload }),
    encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, PLUGIN_ROOT: '', ...env },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

test('frontmatter round-trips lists, booleans, quoted Korean and wikilinks', () => {
  const text = kn.stringifyFrontmatter({ title: '손 오류: 테스트', tags: ['a', 'b c'], flag: false, about: ['[[sqlite]]'], empty: [] }) + 'body';
  const { data, body } = kn.parseFrontmatter(text);
  assert.deepStrictEqual(data, { title: '손 오류: 테스트', tags: ['a', 'b c'], flag: 'false', about: ['[[sqlite]]'], empty: [] });
  assert.strictEqual(body, 'body');
  assert.match(text, /^flag: false$/m);
});

test('redact masks known secret shapes', () => {
  const s = kn.redact('key sk-ant-abcdefghijklmnopqrstuvwxyz token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 password: hunter2hunter2');
  assert.doesNotMatch(s, /abcdefghijklmnopqrstuvwxyz|hunter2/);
});

test('sanitize moves base64 images to assets and truncates long strings', () => {
  const dir = project();
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const out = kn.sanitize({ img: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }, long: 'x'.repeat(5000) }, { root: dir, keepImages: true, max: 1000 });
  assert.match(out.img.image, /^assets\/captured\/[0-9a-f]{16}\.png$/);
  assert.ok(fs.existsSync(path.join(dir, '.knowledge', out.img.image)));
  assert.ok(out.long.length < 1100 && out.long.includes('truncated'));
});

test('init is idempotent and preserves user content', () => {
  const dir = project('experiment');
  fs.appendFileSync(path.join(dir, 'AGENTS.md'), '\nmy own rule\n');
  kn.install(dir, { upgrade: true });
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.strictEqual(agents.split('<!-- my-default-env:start -->').length, 2);
  assert.match(agents, /my own rule/);
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /^@AGENTS\.md/);
  const attrs = fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8');
  assert.strictEqual(attrs.match(/^\*\.png filter=lfs/gm).length, 1);
  assert.strictEqual(kn.loadConfig(dir).profile, 'experiment');
});

test('new / supersede / lint / index work together', () => {
  const dir = project();
  const a = cli(dir, 'new', 'finding', '--title', 'Old claim', '--field', 'sources=[journal:x]', '--field', 'priority=high');
  const b = cli(dir, 'new', 'finding', '--title', 'New claim', '--field', 'sources=[journal:y]', '--field', 'when=when X breaks');
  assert.strictEqual(a.code, 0, a.err);
  const idOf = (rel) => kn.parseFrontmatter(fs.readFileSync(path.join(dir, rel), 'utf8')).data.id;
  const oldId = idOf(a.out); const newId = idOf(b.out);
  assert.strictEqual(cli(dir, 'supersede', oldId, newId, '--reason', 'changed').code, 0);
  const old = kn.parseFrontmatter(fs.readFileSync(path.join(dir, a.out), 'utf8'));
  assert.strictEqual(old.data.status, 'superseded');
  assert.deepStrictEqual(old.data.superseded_by, [`[[${newId}]]`]);
  assert.match(old.body, /> SUPERSEDED by/);
  const lint = cli(dir, 'lint');
  assert.strictEqual(lint.code, 0, lint.out);
  cli(dir, 'index');
  const index = fs.readFileSync(path.join(dir, '.knowledge', 'INDEX.md'), 'utf8');
  assert.match(index, /when X breaks → \[New claim\]/);
  assert.match(index, /`superseded` \[Old claim\]/);
  assert.doesNotMatch(index.split('## 10.')[0], /\[Old claim\]/);
});

test('Korean-only titles get an id-based ASCII filename', () => {
  const dir = project();
  const r = cli(dir, 'new', 'attempt', '--title', '참조 이미지 2장 테스트');
  assert.match(r.out, /attempts\/\d{4}-\d{2}-\d{2}-[0-9a-f]{6}\.md$/);
  assert.strictEqual(cli(dir, 'lint').code, 0);
});

test('lint reports missing reverse supersession links and --fix repairs them', () => {
  const dir = project();
  const a = cli(dir, 'new', 'finding', '--title', 'A', '--field', 'sources=[s]').out;
  const b = cli(dir, 'new', 'finding', '--title', 'B', '--field', 'sources=[s]').out;
  const idB = kn.parseFrontmatter(fs.readFileSync(path.join(dir, b), 'utf8')).data.id;
  kn.updateFrontmatter(path.join(dir, a), { status: 'superseded', superseded_by: [`[[${idB}]]`] });
  assert.strictEqual(cli(dir, 'lint').code, 1);
  cli(dir, 'lint', '--fix');
  assert.strictEqual(cli(dir, 'lint').code, 0);
});

test('pending / mark-curated track journal growth by byte offset', () => {
  const dir = project();
  cli(dir, 'note', '--title', 'one', 'body');
  assert.strictEqual(kn.pendingJournal(dir).length, 1);
  cli(dir, 'mark-curated', '--all');
  assert.strictEqual(kn.pendingJournal(dir).length, 0);
  cli(dir, 'note', '--title', 'two', 'more');
  const p = kn.pendingJournal(dir);
  assert.strictEqual(p.length, 1);
  assert.ok(p[0].from > 0);
  assert.match(cli(dir, 'digest', p[0].path, '--from', String(p[0].from)).out, /two/);
});

test('hooks: journal, context injection, Stop enforcement and loop guards', () => {
  const dir = project();
  const start = hook(dir, 'session-start', { hook_event_name: 'SessionStart', source: 'startup' });
  assert.strictEqual(start.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(start.hookSpecificOutput.additionalContext, /<knowledge-context>/);

  for (let i = 0; i < 5; i++) hook(dir, 'post-tool', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: `make ${i}` }, tool_response: 'ok' });
  hook(dir, 'post-tool', { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'x' }, tool_response: 'x' });

  const blocked = hook(dir, 'stop', { hook_event_name: 'Stop', stop_hook_active: false });
  assert.deepStrictEqual(Object.keys(blocked), ['decision', 'reason']);
  assert.match(blocked.reason, /5건/);
  assert.strictEqual(hook(dir, 'stop', { hook_event_name: 'Stop', stop_hook_active: true }), null);
  assert.strictEqual(hook(dir, 'stop', { hook_event_name: 'Stop', stop_hook_active: false }), null, 'no new work since last block');

  // The note is recognised from this session's own tool call; upkeep and read-only shell do not count as work.
  const tool = (command) => hook(dir, 'post-tool', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: 'ok' });
  tool('node .knowledge/bin/kn.cjs note --title "did it" "body"');
  tool('node .knowledge/bin/kn.cjs index');
  tool('git status && ls -la | head');
  hook(dir, 'post-tool', { hook_event_name: 'PostToolUse', tool_name: 'mcp__docs__search_pages', tool_input: { q: 'x' }, tool_response: 'x' });
  assert.strictEqual(hook(dir, 'stop', { hook_event_name: 'Stop', stop_hook_active: false }), null, 'upkeep and reads do not count');

  for (let i = 0; i < 4; i++) tool(`npm run build-${i}`);
  assert.strictEqual(hook(dir, 'stop', { hook_event_name: 'Stop', permission_mode: 'plan' }), null, 'plan mode never blocks');
  const again = hook(dir, 'stop', { hook_event_name: 'Stop' });
  assert.strictEqual(again, null, 'same count as the plan-mode reminder');
  tool('npm run build-5');
  const blocked2 = hook(dir, 'stop', { hook_event_name: 'Stop' });
  assert.match(blocked2.reason, /5건/);
  assert.match(blocked2.reason, /node "[^"]+\/\.knowledge\/bin\/kn\.cjs" note/, 'absolute kn path');

  // A note written by another session must not satisfy this one.
  hook(dir, 'post-tool', { session_id: 'other-session-zzzz', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'node .knowledge/bin/kn.cjs note --title x y' }, tool_response: 'ok' });
  tool('npm run build-6');
  assert.ok(hook(dir, 'stop', { hook_event_name: 'Stop' }), 'still blocked');

  const lines = fs.readFileSync(kn.journalFile(dir, 'claude', 'sess-0001-abcdef'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(lines.every((l) => l.host === 'claude' && l.ts));
});

test('regression: entity is never overwritten', () => {
  const dir = project();
  assert.strictEqual(cli(dir, 'new', 'entity', '--title', 'SQLite').code, 0);
  const r = cli(dir, 'new', 'entity', '--title', 'SQLite');
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /already exists/);
});

test('regression: updateFrontmatter keeps lines it does not own, BOM and block scalars', () => {
  const dir = project();
  const f = path.join(dir, 'n.md');
  fs.writeFileSync(f, '\uFEFF---\nid: x\nclaim: >\n  long folded\n  text\nmeta:\n  owner: me\ndraft: true\n---\n# Body\n');
  assert.strictEqual(kn.parseFrontmatter(fs.readFileSync(f, 'utf8')).data.claim, 'long folded text');
  kn.updateFrontmatter(f, { status: 'superseded', draft: false });
  const t = fs.readFileSync(f, 'utf8');
  assert.strictEqual(t.split('---\n').length, 3, 'exactly one frontmatter block');
  assert.match(t, /claim: >\n  long folded\n  text\nmeta:\n  owner: me\ndraft: false\n/);
  assert.match(t, /status: superseded\n---\n# Body/);
});

test('regression: INDEX manual memo survives a missing end marker', () => {
  const dir = project();
  const idx = path.join(dir, '.knowledge', 'INDEX.md');
  fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/<!-- manual:start -->[\s\S]*?<!-- manual:end -->/, '<!-- manual:start -->\nMY GOALS\n'));
  kn.buildIndex(dir);
  assert.match(fs.readFileSync(idx, 'utf8'), /<!-- manual:start -->\nMY GOALS\n<!-- manual:end -->/);
});

test('regression: secrets under object keys, URL credentials, Basic auth and short passwords are masked', () => {
  const out = JSON.stringify(kn.sanitize({
    password: 's3cretpw', env: { OPENAI_API_KEY: 'abcdefghijklmnop1234' }, headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    url: 'postgres://user:hunter2@db.local/x', cmd: 'login --password=abc1', max_tokens: 100,
  }, { root: null, keepImages: false, max: 4000 }));
  for (const leak of ['s3cretpw', 'abcdefghijklmnop1234', 'dXNlcjpwYXNz', 'hunter2', 'abc1']) assert.ok(!out.includes(leak), leak);
  assert.match(out, /"max_tokens":100/);
});

test('regression: titles with backslashes and quotes survive', () => {
  const dir = project();
  const title = 'Fix C:\\temp\\new path "quoted" \\d+';
  const r = cli(dir, 'new', 'attempt', '--title', title);
  assert.strictEqual(kn.parseFrontmatter(fs.readFileSync(path.join(dir, r.out), 'utf8')).data.title, title);
});

test('regression: mark-curated only marks the digested size', () => {
  const dir = project();
  cli(dir, 'note', '--title', 'one', 'body');
  const [p] = kn.pendingJournal(dir);
  cli(dir, 'note', '--title', 'two', 'appended after digest');
  cli(dir, 'mark-curated', `${p.path}@${p.size}`);
  const [left] = kn.pendingJournal(dir);
  assert.strictEqual(left.from, p.size);
  assert.match(cli(dir, 'digest', `${left.path}@${left.size}`, '--from', String(left.from)).out, /appended after digest/);
});

test('regression: project copy refuses init/upgrade; switching profile applies its settings', () => {
  const dir = project('code');
  const r = cli(dir, 'upgrade');
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /plugin's kn\.cjs/);
  assert.strictEqual(kn.loadConfig(dir).enforce.minEvents, 4);
  kn.install(dir, { profile: 'experiment' });
  assert.strictEqual(kn.loadConfig(dir).enforce.minEvents, 2);
});

test('regression: repo-wide LFS rules are skipped when matching files are already committed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-lfs-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); fs.writeFileSync(path.join(dir, 'old.png'), 'x'); git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x');
  const r = kn.install(dir, { profile: 'experiment' });
  const attrs = fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8');
  assert.doesNotMatch(attrs, /^\*\.png /m);
  assert.match(attrs, /^\*\.jpg /m);
  assert.ok(r.log.some((l) => /LFS rule skipped for \*\.png/.test(l)));
});

test('regression: kn note with no body fails instead of waiting on stdin', () => {
  const dir = project();
  const r = cli(dir, 'note', '--title', 'x');
  assert.strictEqual(r.code, 2);
});

test('hooks: Codex host detection and strict output shapes', () => {
  const dir = project();
  const out = hook(dir, 'session-start', { hook_event_name: 'SessionStart', source: 'startup', turn_id: 't' }, { PLUGIN_ROOT: PLUGIN, CLAUDE_PLUGIN_ROOT: '' });
  assert.deepStrictEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.ok(fs.existsSync(kn.journalFile(dir, 'codex', 'sess-0001-abcdef')));
});

test('hooks: silent outside a .knowledge project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-none-'));
  assert.strictEqual(hook(dir, 'session-start', { hook_event_name: 'SessionStart' }), null);
  assert.strictEqual(fs.existsSync(path.join(dir, '.knowledge')), false);
});

test('hooks.json commands use the shell-neutral node -e form', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'));
  for (const groups of Object.values(cfg.hooks)) {
    for (const g of groups) for (const h of g.hooks) {
      assert.match(h.command, /^node -e "require\(require\('path'\)\.join\(process\.env\.CLAUDE_PLUGIN_ROOT\|\|process\.env\.PLUGIN_ROOT,'hooks','run\.cjs'\)\)" [a-z-]+$/);
      assert.doesNotMatch(h.command, /\$/);
    }
  }
});
