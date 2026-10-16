'use strict';

const truncate = (value, max) => {
  const s = String(value ?? '');
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

/**
 * Replaces {placeholders}. Known placeholders with empty values become ''.
 * Unknown placeholders are left untouched so typos are visible in previews.
 */
function renderTemplate(template, vars) {
  return String(template ?? '').replace(/\{([a-z_]+)\}/gi, (match, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? '') : match;
  });
}

/** '#FF3B5C' | 'ff3b5c' → 0xFF3B5C, otherwise null. */
function parseColor(input) {
  if (input === null || input === undefined) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(input).trim());
  return m ? Number.parseInt(m[1], 16) : null;
}

function isHttpUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function slugifyChannelName(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_ -]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  return slug || 'youtube';
}

function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const unix = (date) => Math.floor(new Date(date).getTime() / 1000);
const discordTime = (date, style = 'f') => (date ? `<t:${unix(date)}:${style}>` : '');

function cleanDescription(desc, max = 300) {
  const cleaned = String(desc ?? '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return truncate(cleaned, max);
}

/** Modal input semantics: '' → null (use default), '-' → '' (explicitly empty), otherwise the text. */
function parseTemplateInput(value) {
  const v = String(value ?? '').trim();
  if (v === '') return null;
  if (v === '-') return '';
  return v;
}

module.exports = {
  truncate,
  renderTemplate,
  parseColor,
  isHttpUrl,
  slugifyChannelName,
  formatDuration,
  unix,
  discordTime,
  cleanDescription,
  parseTemplateInput,
};
