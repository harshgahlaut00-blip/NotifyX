'use strict';

/**
 * Builds a parameterised UPDATE from a patch object. Column names come from the
 * `allowed` whitelist only, values are always bound parameters.
 */
function buildUpdate(table, allowed, patch, idColumn, idValue, { touch = true } = {}) {
  const keys = Object.keys(patch || {}).filter((k) => allowed.includes(k) && patch[k] !== undefined);
  if (!keys.length) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  if (touch) sets.push('updated_at = now()');
  return {
    sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE ${idColumn} = $${keys.length + 1} RETURNING *`,
    params: [...keys.map((k) => patch[k]), idValue],
  };
}

module.exports = { buildUpdate };
