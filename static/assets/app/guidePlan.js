import { normalizeName } from './utils.js';

const GUIDE_COUNT_RE = /^(\d+)\s*x?\s+(.+)$/i;

function extractGuideCardName(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (raw.startsWith('[[') && raw.endsWith(']]')) {
    const inner = raw.slice(2, -2).trim();
    if (!inner) return '';
    const parts = inner.split('|');
    return String(parts[parts.length - 1] || '').trim();
  }
  return raw;
}

export function parseGuideCountLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  const match = GUIDE_COUNT_RE.exec(text);
  if (!match) return null;
  const qty = Number.parseInt(match[1], 10);
  if (!Number.isFinite(qty) || qty < 1) return null;
  const name = extractGuideCardName(match[2]);
  const key = normalizeName(name);
  if (!key) return null;
  return { qty, name, key };
}

export function buildGuideCountMap(lines) {
  const out = {};
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const parsed = parseGuideCountLine(line);
    if (!parsed) return;
    out[parsed.key] = (out[parsed.key] || 0) + parsed.qty;
  });
  return out;
}

export function totalGuideItemQty(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((sum, line) => {
    const parsed = parseGuideCountLine(line);
    return sum + (parsed ? parsed.qty : 0);
  }, 0);
}
