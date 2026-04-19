import { normalizeName } from './utils.js';

function parseGuidePlanCounts(counts) {
  if (!counts || typeof counts !== 'object') return [];
  return Object.entries(counts).map(([name, rawQty]) => {
    const qty = Number.parseInt(String(rawQty), 10);
    const key = normalizeName(name);
    if (!key || !Number.isFinite(qty) || qty < 1) return null;
    return { qty, key };
  }).filter(Boolean);
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

  const ins = parseGuidePlanCounts(guide?.plan?.in);
  const outs = parseGuidePlanCounts(guide?.plan?.out);

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
