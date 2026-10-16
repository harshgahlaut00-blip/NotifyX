'use strict';

const path = require('path');
const { spawn } = require('child_process');

const appDir = path.join(__dirname, 'notifyx');
const entry = path.join(appDir, 'index.js');

console.log('[NotifyX] Starting...');
console.log('[NotifyX] App:', entry);

const child = spawn(process.execPath, [entry], {
  cwd: appDir,
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error('[NotifyX] Failed to start:', err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[NotifyX] Stopped by signal: ${signal}`);
    process.exit(1);
  }
  console.log(`[NotifyX] NotifyX exited with code ${code ?? 0}`);
  process.exit(code ?? 0);
});
