'use strict';

const json = require('./jsondb');
const log = require('../utils/logger').child({ mod: 'db' });

async function waitForDatabase() {
  await json.init();
  log.info({ file: json.FILE }, 'JSON database ready');
}
async function ping() { await json.init(); return true; }
async function close() { await json.close(); }
async function tx(fn) { return json.tx(fn); }

// Compatibility exports for modules that still import the old database module.
function unsupported() {
  throw new Error('NotifyX JSON database does not expose SQL queries. Use repository modules.');
}
function getPool() { return { query: unsupported, connect: unsupported }; }
function query() { return unsupported(); }
async function one() { return unsupported(); }
async function many() { return unsupported(); }

module.exports = { getPool, query, one, many, tx, ping, waitForDatabase, close };
