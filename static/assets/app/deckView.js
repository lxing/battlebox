import { normalizeName } from './utils.js';

const guideCountRE = /^(\d+)\s*x?\s+(.+)$/i;

function extractGuideCardName(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (raw.startsWith('[[') && raw.endsWith(']]')) {
    const inner = raw.slice(2, -2).trim();
    if (!inner) return '';
    const parts = inner.split('|');
    return (parts[parts.length - 1] || '').trim();
  }
  return raw;
}

function parseGuidePlanLines(lines) {
  if (!Array.isArray(lines)) return [];
  const parsed = [];
  lines.forEach((line) => {
    const text = String(line || '').trim();
    if (!text) return;
    const match = guideCountRE.exec(text);
    if (!match) return;
    const qty = Number.parseInt(match[1], 10);
    if (!qty || qty < 1) return;
    const name = extractGuideCardName(match[2]);
    const key = normalizeName(name);
    if (!key) return;
    parsed.push({ qty, key });
  });
  return parsed;
}

function findCardIndex(cards, key) {
  for (let i = 0; i < cards.length; i++) {
    if (normalizeName(cards[i].name) === key) return i;
  }
  return -1;
}

function cloneCardWithQty(card, qty) {
  return { ...card, qty };
}

export function computeDeckView(deck, guide, applySideboard) {
  const mainCards = Array.isArray(deck.cards) ? deck.cards.map(c => ({ ...c })) : [];
  const sideCards = Array.isArray(deck.sideboard) ? deck.sideboard.map(c => ({ ...c })) : [];
  const mainboardAdded = {};
  const sideboardFromMain = {};

  if (!applySideboard || !guide) {
    return {
      mainCards,
      sideCards,
      mainboardAdded,
      sideboardFromMain,
    };
  }

  const ins = parseGuidePlanLines(guide.in);
  const outs = parseGuidePlanLines(guide.out);

  ins.forEach((entry) => {
    const sideIdx = findCardIndex(sideCards, entry.key);
    if (sideIdx < 0) return;
    const sideCard = sideCards[sideIdx];
    const moved = Math.min(entry.qty, sideCard.qty);
    if (moved <= 0) return;

    sideCard.qty -= moved;
    if (sideCard.qty <= 0) sideCards.splice(sideIdx, 1);

    const mainIdx = findCardIndex(mainCards, entry.key);
    if (mainIdx >= 0) {
      mainCards[mainIdx].qty += moved;
    } else {
      mainCards.push(cloneCardWithQty(sideCard, moved));
    }
    mainboardAdded[entry.key] = (mainboardAdded[entry.key] || 0) + moved;
  });

  outs.forEach((entry) => {
    const mainIdx = findCardIndex(mainCards, entry.key);
    if (mainIdx < 0) return;
    const mainCard = mainCards[mainIdx];
    const moved = Math.min(entry.qty, mainCard.qty);
    if (moved <= 0) return;

    mainCard.qty -= moved;
    if (mainCard.qty <= 0) mainCards.splice(mainIdx, 1);

    const sideIdx = findCardIndex(sideCards, entry.key);
    if (sideIdx >= 0) {
      sideCards[sideIdx].qty += moved;
    } else {
      sideCards.push(cloneCardWithQty(mainCard, moved));
    }
    sideboardFromMain[entry.key] = (sideboardFromMain[entry.key] || 0) + moved;
  });

  return {
    mainCards: mainCards.filter(c => c.qty > 0),
    sideCards: sideCards.filter(c => c.qty > 0),
    mainboardAdded,
    sideboardFromMain,
  };
}
