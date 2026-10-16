'use strict';

const { Events } = require('discord.js');
const log = require('../utils/logger').child({ mod: 'discord' });

module.exports = { name: Events.Error, execute: (err) => log.error({ err }, 'Discord client error') };
