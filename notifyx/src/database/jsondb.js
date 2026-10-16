'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../../data');
const FILE = path.join(DATA_DIR, 'database.json');

const TABLES = [
  'guilds',
  'platform_accounts',
  'subscriptions',
  'notification_rules',
  'templates',
  'content_items',
  'notification_history',
  'bot_state',
];

const defaults = () => ({
  meta: { version: 1, nextIds: {} },
  guilds: [],
  platform_accounts: [],
  subscriptions: [],
  notification_rules: [],
  templates: [],
  content_items: [],
  notification_history: [],
  bot_state: [],
});

let state = null;
let writeChain = Promise.resolve();

function now() { return new Date().toISOString(); }

function ensureState() {
  if (state) return state;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { state = null; }
  }
  if (!state || typeof state !== 'object') state = defaults();
  for (const t of TABLES) if (!Array.isArray(state[t])) state[t] = [];
  if (!state.meta) state.meta = { version: 1, nextIds: {} };
  if (!state.meta.nextIds) state.meta.nextIds = {};
  return state;
}

function save() {
  ensureState();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function persist() {
  save();
  return Promise.resolve();
}

function nextId(table) {
  ensureState();
  const rows = state[table];
  const max = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  const n = Math.max(Number(state.meta.nextIds[table]) || 1, max + 1);
  state.meta.nextIds[table] = n + 1;
  return n;
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function insert(table, row, id = true) {
  ensureState();
  const out = { ...row };
  if (id && out.id == null) out.id = nextId(table);
  state[table].push(out);
  return clone(out);
}

function find(table, fn) {
  return ensureState()[table].find(fn) || null;
}

function filter(table, fn) {
  return ensureState()[table].filter(fn).map(clone);
}

function replace(table, id, patch) {
  const row = ensureState()[table].find(r => r.id === id);
  if (!row) return null;
  Object.assign(row, patch);
  return clone(row);
}

function remove(table, fn) {
  const rows = ensureState()[table];
  const removed = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (fn(rows[i])) removed.unshift(clone(rows[i])), rows.splice(i, 1);
  }
  return removed;
}

async function tx(fn) {
  // Serialize transaction callbacks. Repository functions may call persist(); the final
  // save here makes the whole transaction durable without requiring a SQL connection.
  let result;
  const previous = writeChain;
  writeChain = previous.then(async () => {
    ensureState();
    result = await fn(null);
    save();
  });
  await writeChain;
  return result;
}

async function init() {
  ensureState();
  await persist();
}

async function close() { await persist(); }

module.exports = {
  FILE, DATA_DIR, TABLES, now, clone, ensureState, save, persist, nextId,
  insert, find, filter, replace, remove, tx, init, close,
};
