import { scryfallImageUrlByPrinting } from './utils.js';
import { escapeHtml } from './util.js';

export function cardFaceImageUrl(printing, showBack = false) {
  return scryfallImageUrlByPrinting(printing, showBack ? 'back' : 'front');
}

export function dfcFlipControlMarkup(attrs, title, element = 'span') {
  const attrText = String(attrs || '').trim();
  const controlTitle = escapeHtml(title || 'Flip card face');
  if (element === 'button') {
    return `<button type="button" class="card-dfc-flip-control" ${attrText} title="${controlTitle}" aria-label="${controlTitle}">🔄</button>`;
  }
  return `<span class="card-dfc-flip-control" ${attrText} title="${controlTitle}" aria-hidden="true">🔄</span>`;
}
