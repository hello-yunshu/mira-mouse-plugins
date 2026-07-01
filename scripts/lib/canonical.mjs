// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared canonical JSON helpers used by pack-sign.mjs and verify-test.mjs.

export function sortJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortJson(value[k])])
    );
  }
  if (Array.isArray(value)) return value.map(sortJson);
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}
