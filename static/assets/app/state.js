import { normalizeName } from './utils.js';

export function normalizeSortMode(mode) {
  if (mode === 'types' || mode === 'difficulty') return mode;
  return 'name';
}

export function normalizeSortDirection(direction) {
  return direction === 'desc' ? 'desc' : 'asc';
}

export function normalizeCollapsedMask(mask) {
  const parsed = Number.parseInt(mask, 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return parsed & 7;
}

export function normalizeApplySideboard(value) {
  return value === '1' || value === true;
}

export function parseHashRoute(rawHash) {
  const hash = typeof rawHash === 'string' ? rawHash : (location.hash.slice(1) || '/');
  const [pathPart, queryPart = ''] = hash.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart);
  const matchup = (params.get('matchup') || '').trim();
  const matchupSlug = matchup ? normalizeName(matchup) : '';
  return {
    parts,
    sortMode: normalizeSortMode(params.get('sort')),
    sortDirection: normalizeSortDirection(params.get('dir')),
    matchupSlug,
    collapsedMask: normalizeCollapsedMask(params.get('c')),
    applySideboard: normalizeApplySideboard(params.get('sb')),
  };
}

export function buildBattleboxHash(bbSlug, sortMode, sortDirection) {
  const params = new URLSearchParams();
  params.set('sort', normalizeSortMode(sortMode));
  params.set('dir', normalizeSortDirection(sortDirection));
  return `#/${bbSlug}?${params.toString()}`;
}

export function buildDeckHash(bbSlug, deckSlug, sortMode, sortDirection, matchupSlug, collapsedMask, applySideboard) {
  const params = new URLSearchParams();
  params.set('sort', normalizeSortMode(sortMode));
  params.set('dir', normalizeSortDirection(sortDirection));
  if (matchupSlug) params.set('matchup', matchupSlug);
  params.set('c', String(normalizeCollapsedMask(collapsedMask)));
  if (normalizeApplySideboard(applySideboard)) params.set('sb', '1');
  return `#/${bbSlug}/${deckSlug}?${params.toString()}`;
}
