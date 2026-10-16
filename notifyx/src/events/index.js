'use strict';

const fs = require('fs');
const path = require('path');

/** Loads and binds every *.js event handler in this folder (except this file). */
function bindEvents(client) {
  for (const file of fs.readdirSync(__dirname)) {
    if (file === 'index.js' || !file.endsWith('.js')) continue;
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const event = require(path.join(__dirname, file));
    if (!event?.name || !event?.execute) continue;
    if (event.once) client.once(event.name, event.execute);
    else client.on(event.name, event.execute);
  }
}

module.exports = { bindEvents };
