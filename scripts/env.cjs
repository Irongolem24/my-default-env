#!/usr/bin/env node
'use strict';
// Environment registry tool: what is installed vs. what registry.json says should be.
//   node scripts/env.cjs status                  installed state of every item
//   node scripts/env.cjs plan [--host X]         install commands for adopted/trial items that are missing
//   node scripts/env.cjs apply [--host X] --yes  run those commands
//   node scripts/env.cjs review                  items whose review date has passed

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'registry.json'), 'utf8'));
const args = process.argv.slice(2);
const cmd = args[0] || 'status';
const hostArg = args.includes('--host') ? args[args.indexOf('--host') + 1] : null;
const home = os.homedir();

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

const claudePlugins = (() => {
  try { return Object.keys(JSON.parse(read(path.join(home, '.claude', 'plugins', 'installed_plugins.json'))).plugins || {}); } catch { return []; }
})();
// Only plugin section headers are read from config.toml; nothing else in it is parsed or printed.
const codexPlugins = read(path.join(home, '.codex', 'config.toml')).split(/\r?\n/)
  .map((l) => /^\[plugins\."([^"]+)"\]/.exec(l)).filter(Boolean).map((m) => m[1]);

function hasBin(name) {
  try { execSync(process.platform === 'win32' ? `where ${name}` : `command -v ${name}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

function installed(item) {
  const c = item.check || {};
  const out = {};
  if (c.claude) out.claude = claudePlugins.includes(c.claude);
  if (c.codex) out.codex = codexPlugins.includes(c.codex);
  if (c.bin) out.bin = hasBin(c.bin);
  return out;
}

function missingCommands(item) {
  const st = installed(item);
  const cmds = [];
  for (const [host, list] of Object.entries(item.install || {})) {
    if (hostArg && host !== hostArg) continue;
    const ok = host in st ? st[host] : st.bin;
    if (!ok) cmds.push(...list.map((c) => ({ host, c })));
  }
  return cmds;
}

const active = registry.items.filter((i) => ['adopted', 'trial'].includes(i.status));

if (cmd === 'status') {
  for (const i of registry.items) {
    const st = Object.entries(installed(i)).map(([k, v]) => `${k}:${v ? 'yes' : 'no'}`).join(' ') || '-';
    console.log(`${i.status.padEnd(10)} ${i.id.padEnd(18)} ${i.hosts.join('+').padEnd(13)} ${st}`);
  }
} else if (cmd === 'plan' || cmd === 'apply') {
  const todo = active.flatMap((i) => missingCommands(i).map((x) => ({ id: i.id, ...x })));
  if (!todo.length) { console.log('nothing to install'); process.exit(0); }
  for (const t of todo) console.log(`[${t.host}] ${t.id}: ${t.c}`);
  if (cmd === 'apply') {
    if (!args.includes('--yes')) { console.log('\n(dry run: add --yes to execute)'); process.exit(0); }
    for (const t of todo) {
      if (/^see /.test(t.c)) { console.log(`skip (manual): ${t.c}`); continue; }
      console.log(`$ ${t.c}`);
      execSync(t.c, { stdio: 'inherit' });
    }
    if (todo.some((t) => t.host === 'codex')) console.log('\nCodex: open a new interactive codex session and approve plugin hooks with /hooks.');
  }
} else if (cmd === 'review') {
  const today = new Date().toISOString().slice(0, 10);
  const due = registry.items.filter((i) => i.review && i.review <= today && i.status !== 'rejected');
  if (!due.length) console.log('no reviews due');
  for (const i of due) console.log(`${i.review} ${i.status} ${i.id}: ${i.why}`);
} else {
  console.error('usage: env.cjs status | plan [--host claude|codex] | apply [--host X] --yes | review');
  process.exit(2);
}
