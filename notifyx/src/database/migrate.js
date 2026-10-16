'use strict';

const json = require('./jsondb');
const log = require('../utils/logger').child({ mod: 'migrate' });

async function migrate() {
  await json.init();
  log.info({ file: json.FILE }, 'JSON database initialized');
}
module.exports = { migrate };
