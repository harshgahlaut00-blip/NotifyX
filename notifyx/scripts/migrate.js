#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { validateConfig } = require('../src/config');
const log = require('../src/utils/logger');
const db = require('../src/database/pool');
const { migrate } = require('../src/database/migrate');

(async () => {
  const { errors } = validateConfig();
  if (errors.length) {
    for (const e of errors) log.fatal(e);
    process.exit(1);
  }
  await db.waitForDatabase(5, 2000);
  const applied = await migrate();
  log.info({ applied }, 'database migrations up to date');
  await db.close();
})().catch((err) => {
  console.error('[fatal] migration failed:', err);
  process.exit(1);
});
