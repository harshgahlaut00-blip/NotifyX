'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Adds up to `ratio` extra time (e.g. 0.1 = up to +10%). */
const jitter = (ms, ratio = 0.1) => Math.round(ms * (1 + Math.random() * ratio));

/** Exponential backoff with "equal jitter". */
function backoffMs(attempt, base = 1000, max = 60_000) {
  const exp = Math.min(max, base * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

/** YouTube API quota resets at midnight Pacific Time. Returns that moment (+1 min safety margin). */
function nextPacificMidnight(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const secondsIntoDay = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return new Date(now.getTime() + (86_400 - secondsIntoDay) * 1000 + 60_000);
}

module.exports = { sleep, jitter, backoffMs, nextPacificMidnight };
