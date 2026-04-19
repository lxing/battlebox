import { normalizeName } from './utils.js';

export function buildGuideCountMap(counts) {
  const out = {};
  if (!counts || typeof counts !== 'object') return out;
  Object.entries(counts).forEach(([name, rawQty]) => {
    const trimmedName = String(name || '').trim();
    const key = normalizeName(trimmedName);
    const qty = Number.parseInt(String(rawQty), 10);
    if (!key || !Number.isFinite(qty) || qty < 1) return;
    out[key] = qty;
  });
  return out;
}

export function totalGuideItemQty(counts) {
  if (!counts || typeof counts !== 'object') return 0;
  return Object.values(counts).reduce((sum, rawQty) => {
    const qty = Number.parseInt(String(rawQty), 10);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);
}
