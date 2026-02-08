export function formatColors(colors) {
  return colors.split('').map(c =>
    `<span class="mana-symbol mana-${c}"></span>`
  ).join('');
}

export function sortArchetypeTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return [];
  const rank = {
    aggro: 0,
    tempo: 1,
    midrange: 2,
    control: 3,
    combo: 4,
    tribal: 5,
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

export function renderDeckTags(tags) {
  const sorted = sortArchetypeTags(tags);
  if (sorted.length === 0) return '';
  return sorted.map(tag => {
    const key = normalizeName(tag).replace(/[^a-z0-9-]/g, '');
    if (!key) return '';
    return `<span class="deck-tag deck-tag-${key}">${key}</span>`;
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
    return `<span class="deck-tag deck-tag-${key}">${key}</span>`;
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
