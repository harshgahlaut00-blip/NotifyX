'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { config } = require('../config');

function build() {
  const options = {
    level: config.log.level,
    base: { app: 'notifyx' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['token', '*.token', 'apiKey', '*.apiKey', 'password', '*.password', 'secret', '*.secret'],
      censor: '[redacted]',
    },
  };

  if (config.log.file) {
    fs.mkdirSync(path.dirname(path.resolve(config.log.file)), { recursive: true });
    return pino(
      options,
      pino.multistream([
        { stream: process.stdout },
        { stream: pino.destination({ dest: path.resolve(config.log.file), sync: false }) },
      ]),
    );
  }

  if (config.log.pretty) {
    try {
      require.resolve('pino-pretty');
      return pino({
        ...options,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,app' },
        },
      });
    } catch {
      // pino-pretty not installed → fall through to JSON logs
    }
  }
  return pino(options);
}

module.exports = build();
