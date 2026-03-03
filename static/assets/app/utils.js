const ARCHETYPE_TAG_RANK = {
  aggro: 0,
  midrange: 1,
  control: 2,
  combo: 3,
  tempo: 4,
  tribal: 5,
  shared: 6,
  '2p': 7,
  '4p': 8,
};

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

export function archetypeTagRank(tag) {
  const key = normalizeName(tag);
  if (Object.prototype.hasOwnProperty.call(ARCHETYPE_TAG_RANK, key)) {
    return ARCHETYPE_TAG_RANK[key];
  }
  return 100;
}

export function formatColors(colors) {
  return colors.split('').map(c =>
    `<span class="mana-symbol mana-${c}"></span>`
  ).join('');
}

export function sortArchetypeTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return [];
  return [...tags].sort((a, b) => {
    const ak = normalizeName(a);
    const bk = normalizeName(b);
    const ar = archetypeTagRank(ak);
    const br = archetypeTagRank(bk);
    if (ar !== br) return ar - br;
    return ak.localeCompare(bk);
  });
}

export function archetypeTagLabel(key) {
  if (key === '2p') return '2-4 players';
  if (key === '4p') return '4-8 players';
  return key;
}

export function renderDeckTags(tags) {
  const sorted = sortArchetypeTags(tags);
  if (sorted.length === 0) return '';
  return sorted.map(tag => {
    const key = normalizeName(tag).replace(/[^a-z0-9-]/g, '');
    if (!key) return '';
    return `<span class="deck-tag deck-tag-${key}">${archetypeTagLabel(key)}</span>`;
  }).join('');
}

export function sortDifficultyTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return [];
  const rank = {
    beginner: 0,
    intermediate: 1,
    expert: 2,
  };
  return [...tags].sort((a, b) => {
    const ak = normalizeName(a);
    const bk = normalizeName(b);
    const ar = Object.prototype.hasOwnProperty.call(rank, ak) ? rank[ak] : 100;
    const br = Object.prototype.hasOwnProperty.call(rank, bk) ? rank[bk] : 100;
    if (ar !== br) return ar - br;
    return ak.localeCompare(bk);
  });
}

export function difficultyTagLabel(key) {
  if (key === 'beginner') return '🧠';
  if (key === 'intermediate') return '🧠🧠';
  if (key === 'expert') return '🧠🧠🧠';
  return key;
}

export function renderDifficultyTags(tags) {
  const sorted = sortDifficultyTags(tags);
  if (sorted.length === 0) return '';
  return sorted.map(tag => {
    const key = normalizeName(tag).replace(/[^a-z0-9-]/g, '');
    if (!key) return '';
    return `<span class="deck-tag deck-tag-difficulty deck-tag-${key}">${difficultyTagLabel(key)}</span>`;
  }).join('');
}

export function renderDeckSelectionTags(tags, difficultyTags) {
  const archetype = sortArchetypeTags(tags).map(tag => {
    const key = normalizeName(tag).replace(/[^a-z0-9-]/g, '');
    if (!key) return '';
    return `<span class="deck-tag deck-tag-${key}">${archetypeTagLabel(key)}</span>`;
  });
  const difficulty = sortDifficultyTags(difficultyTags).map(tag => {
    const key = normalizeName(tag).replace(/[^a-z0-9-]/g, '');
    if (!key) return '';
    return `<span class="deck-tag deck-tag-difficulty deck-tag-${key}">${difficultyTagLabel(key)}</span>`;
  });
  return [...archetype, ...difficulty].filter(Boolean).join('');
}

export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function normalizeName(name) {
  return String(name || '').toLowerCase().trim();
}

export function buildDoubleFacedMap(deck) {
  const out = {};
  const addCards = (cards) => {
    if (!Array.isArray(cards)) return;
    cards.forEach((card) => {
      if (!card || card.double_faced !== true) return;
      const key = normalizeName(card.name);
      if (!key) return;
      out[key] = true;
    });
  };
  addCards(deck?.cards);
  addCards(deck?.sideboard);
  return out;
}

export function isDoubleFacedCard(name, doubleFacedMap) {
  const key = normalizeName(name);
  if (!key) return false;
  return Boolean(doubleFacedMap && doubleFacedMap[key] === true);
}

export function scryfallImageUrlByName(cardName) {
  const name = String(cardName || '').trim();
  if (!name) return '';
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
}

export function scryfallImageUrlByPrinting(printing, face = 'front') {
  const raw = String(printing || '').trim();
  if (!raw) return '';
  const slashIdx = raw.indexOf('/');
  if (slashIdx <= 0 || slashIdx >= raw.length - 1) return '';
  const setCode = raw.slice(0, slashIdx).trim();
  const collector = raw.slice(slashIdx + 1).trim();
  if (!setCode || !collector) return '';
  const normalizedFace = String(face || 'front').toLowerCase() === 'back' ? 'back' : 'front';
  const faceParam = normalizedFace === 'back' ? '&face=back' : '';
  return `https://api.scryfall.com/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(collector)}?format=image&version=normal${faceParam}`;
}
