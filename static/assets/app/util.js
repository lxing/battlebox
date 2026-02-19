export function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizePositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function normalizeNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return normalizePositiveInt(fallback) || 0;
}

export function formatProgressLabel(label, zeroBasedValue, total) {
  const safeTotal = normalizePositiveInt(total);
  if (safeTotal <= 0) return `${label} -/-`;
  const raw = Number.parseInt(String(zeroBasedValue), 10);
  const current = Number.isFinite(raw) ? raw + 1 : 1;
  const clamped = Math.max(1, Math.min(current, safeTotal));
  return `${label} ${clamped}/${safeTotal}`;
}

export function formatPickProgressLabel(zeroBasedPick, total, expectedPicks) {
  const safeTotal = normalizePositiveInt(total);
  if (safeTotal <= 0) return 'Pick -/-';

  const rawPick = Number.parseInt(String(zeroBasedPick), 10);
  const pickStart = Number.isFinite(rawPick) ? rawPick + 1 : 1;
  const clampedStart = Math.max(1, Math.min(pickStart, safeTotal));
  const span = normalizePositiveInt(expectedPicks) || 1;
  const clampedEnd = Math.max(clampedStart, Math.min(clampedStart + span - 1, safeTotal));

  if (clampedEnd > clampedStart) {
    return `Pick ${clampedStart}-${clampedEnd}/${safeTotal}`;
  }
  return `Pick ${clampedStart}/${safeTotal}`;
}
