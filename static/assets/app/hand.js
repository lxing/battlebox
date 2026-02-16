import { scryfallImageUrlByPrinting } from './utils.js';

function getCardImageUrl(printing, face = 'front') {
  return scryfallImageUrlByPrinting(printing, face);
}

function normalizeQty(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function expandDeck(cards) {
  const copies = [];
  (cards || []).forEach((card) => {
    const qty = normalizeQty(card.qty);
    for (let i = 0; i < qty; i += 1) {
      copies.push({
        name: card.name || 'Unknown',
        printing: card.printing || '',
        doubleFaced: card.double_faced === true,
        showBack: false,
      });
    }
  });
  return copies;
}

function buildDeckSignature(cards) {
  return (cards || [])
    .map((card) => `${card.name || ''}|${normalizeQty(card.qty)}|${card.printing || ''}`)
    .sort()
    .join('||');
}

function normalizeInitialDrawCount(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) || parsed <= 0 ? 7 : parsed;
}

function normalizeAllowDraw(value) {
  return value !== false;
}

function shuffle(array) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function drawCards(state, count) {
  const nextCount = Math.max(0, Number.parseInt(String(count), 10) || 0);
  for (let i = 0; i < nextCount && state.drawIndex < state.deck.length; i += 1) {
    state.hand.push(state.deck[state.drawIndex]);
    state.drawIndex += 1;
  }
}

function resetDeckState(state) {
  // Clone source copies so toggling face state does not mutate source templates.
  state.deck = shuffle(state.source.map((card) => ({
    ...card,
    showBack: false,
  })));
  state.drawIndex = 0;
  state.hand = [];
  drawCards(state, state.initialDrawCount);
  state.initialized = true;
}

function createDeckState(cards, signature, initialDrawCount) {
  return {
    signature,
    source: expandDeck(cards),
    deck: [],
    hand: [],
    drawIndex: 0,
    initialDrawCount,
    initialized: false,
  };
}

export function createSampleHandViewer() {
  const stateByKey = new Map();
  let overlay = null;
  let gridWrap = null;
  let grid = null;
  let drawButton = null;
  let resetButton = null;
  let contextKey = '';
  let contextCards = [];
  let contextInitialDrawCount = 7;
  let contextAllowDraw = true;
  let activeKey = '';

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'sample-hand-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="sample-hand-backdrop"></div>
      <div class="sample-hand-sheet" role="dialog" aria-modal="true" aria-label="Sample hand viewer">
        <div class="sample-hand-grid-wrap" data-sample-hand-grid-wrap>
          <div class="sample-hand-grid" data-sample-hand-grid></div>
        </div>
        <div class="sample-hand-footer">
          <div class="sample-hand-controls">
            <button type="button" class="action-button button-standard sample-hand-control" data-sample-hand-action="reset">Reset</button>
            <button type="button" class="action-button button-standard sample-hand-control" data-sample-hand-action="draw">Draw</button>
            <button type="button" class="action-button button-standard sample-hand-control" data-sample-hand-action="close">Close</button>
          </div>
        </div>
      </div>
    `;

    const backdrop = overlay.querySelector('.sample-hand-backdrop');
    gridWrap = overlay.querySelector('[data-sample-hand-grid-wrap]');
    grid = overlay.querySelector('[data-sample-hand-grid]');
    drawButton = overlay.querySelector('[data-sample-hand-action="draw"]');
    resetButton = overlay.querySelector('[data-sample-hand-action="reset"]');
    const closeButton = overlay.querySelector('[data-sample-hand-action="close"]');

    grid.addEventListener('click', (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const cardEl = target ? target.closest('[data-sample-card-index]') : null;
      if (!(cardEl instanceof HTMLElement)) return;
      if (cardEl.dataset.sampleCardDoubleFaced !== '1') return;
      const index = Number.parseInt(cardEl.dataset.sampleCardIndex || '', 10);
      if (Number.isNaN(index)) return;
      toggleCardFace(index);
    });

    backdrop.addEventListener('click', () => {
      hide();
    });
    closeButton.addEventListener('click', () => {
      hide();
    });
    drawButton.addEventListener('click', () => {
      if (!contextAllowDraw) return;
      const state = getActiveState(false);
      if (!state) return;
      const prevRows = Math.ceil(state.hand.length / 3);
      drawCards(state, 1);
      renderState(state);
      const nextRows = Math.ceil(state.hand.length / 3);
      if (nextRows > prevRows) {
        window.requestAnimationFrame(() => {
          scrollToRow(nextRows - 1);
        });
      }
    });
    resetButton.addEventListener('click', () => {
      const state = getActiveState(false);
      if (!state) return;
      resetDeckState(state);
      renderState(state);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !overlay || overlay.hidden) return;
      hide();
    });

    document.body.appendChild(overlay);
  }

  function getDeckState(key, cards, initialDrawCount, initialize) {
    if (!key) return null;
    const normalizedDraw = normalizeInitialDrawCount(initialDrawCount);
    const signature = `${buildDeckSignature(cards)}|draw:${normalizedDraw}`;
    let state = stateByKey.get(key);
    if (!state || state.signature !== signature) {
      state = createDeckState(cards, signature, normalizedDraw);
      stateByKey.set(key, state);
    }
    if (initialize && !state.initialized) {
      resetDeckState(state);
    }
    return state;
  }

  function getActiveState(initialize) {
    if (!activeKey) return null;
    return getDeckState(activeKey, contextCards, contextInitialDrawCount, initialize);
  }

  function renderState(state) {
    if (!grid || !drawButton || !resetButton) return;
    const cards = state?.hand || [];
    if (cards.length === 0) {
      grid.innerHTML = '<div class="sample-hand-empty">No cards</div>';
    } else {
      grid.innerHTML = cards.map((card, index) => {
        const showingBack = card.doubleFaced === true && card.showBack === true;
        const imageUrl = getCardImageUrl(card.printing, showingBack ? 'back' : 'front');
        const toggleAttrs = `data-sample-card-index="${index}" data-sample-card-double-faced="${card.doubleFaced ? '1' : '0'}"`;
        const toggleBadge = card.doubleFaced
          ? '<span class="sample-hand-card-flip-indicator" aria-hidden="true">🔄</span>'
          : '';
        if (imageUrl) {
          const faceLabel = card.doubleFaced
            ? (showingBack ? ' (back face)' : ' (front face)')
            : '';
          const faceTitle = card.doubleFaced
            ? (showingBack ? 'Tap to show front face' : 'Tap to show back face')
            : '';
          return `
            <div class="sample-hand-card" ${toggleAttrs} title="${faceTitle}">
              ${toggleBadge}
              <img src="${imageUrl}" alt="${card.name}${faceLabel}">
            </div>
          `;
        }
        return `<div class="sample-hand-card sample-hand-card-fallback" ${toggleAttrs}>${toggleBadge}${card.name}</div>`;
      }).join('');
    }

    const total = state.deck.length;
    drawButton.hidden = !contextAllowDraw;
    drawButton.disabled = !contextAllowDraw || state.drawIndex >= total;
    resetButton.disabled = total === 0;
    syncGridViewport(cards.length);
  }

  function syncGridViewport(cardCount) {
    if (!gridWrap || !grid) return;
    if (cardCount <= 9) {
      gridWrap.style.maxHeight = 'none';
      gridWrap.scrollTop = 0;
      return;
    }
    const firstCard = grid.querySelector('.sample-hand-card');
    if (!(firstCard instanceof HTMLElement)) return;
    const cardHeight = firstCard.getBoundingClientRect().height;
    if (!cardHeight) {
      window.requestAnimationFrame(() => {
        syncGridViewport(cardCount);
      });
      return;
    }
    const gridStyles = window.getComputedStyle(grid);
    const rowGap = Number.parseFloat(gridStyles.rowGap || gridStyles.gap || '0') || 0;
    const maxHeight = (cardHeight * 3) + (rowGap * 2);
    gridWrap.style.maxHeight = `${maxHeight}px`;
    gridWrap.style.overflowY = 'auto';
  }

  function scrollToRow(rowIndex) {
    if (!gridWrap || !grid) return;
    if (rowIndex < 0) return;
    const cards = grid.querySelectorAll('.sample-hand-card');
    const cardIndex = rowIndex * 3;
    if (cardIndex >= cards.length) return;
    const target = cards[cardIndex];
    if (!(target instanceof HTMLElement)) return;

    const targetTop = target.offsetTop;
    const targetBottom = targetTop + target.offsetHeight;
    const viewTop = gridWrap.scrollTop;
    const viewBottom = viewTop + gridWrap.clientHeight;

    if (targetTop >= viewTop && targetBottom <= viewBottom) return;
    const nextTop = Math.max(0, targetBottom - gridWrap.clientHeight);
    gridWrap.scrollTo({ top: nextTop, behavior: 'auto' });
  }

  function toggleCardFace(cardIndex) {
    const state = getActiveState(false);
    if (!state) return;
    if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= state.hand.length) return;
    const card = state.hand[cardIndex];
    if (!card || card.doubleFaced !== true) return;
    card.showBack = !card.showBack;
    renderState(state);
  }

  function setDeckContext(key, cards, sampleConfig) {
    contextKey = String(key || '');
    contextCards = Array.isArray(cards) ? cards : [];
    if (sampleConfig && typeof sampleConfig === 'object' && !Array.isArray(sampleConfig)) {
      contextInitialDrawCount = normalizeInitialDrawCount(sampleConfig.initialDrawCount);
      contextAllowDraw = normalizeAllowDraw(sampleConfig.allowDraw);
    } else {
      contextInitialDrawCount = normalizeInitialDrawCount(sampleConfig);
      contextAllowDraw = true;
    }
    if (!overlay || overlay.hidden) return;
    if (!contextKey) return;
    activeKey = contextKey;
    const state = getDeckState(activeKey, contextCards, contextInitialDrawCount, true);
    if (!state) return;
    renderState(state);
  }

  function open() {
    if (!contextKey) return;
    ensureOverlay();
    activeKey = contextKey;
    const state = getDeckState(activeKey, contextCards, contextInitialDrawCount, true);
    if (!state) return;
    renderState(state);
    overlay.hidden = false;
  }

  function hide() {
    if (!overlay) return;
    overlay.hidden = true;
  }

  return {
    setDeckContext,
    open,
    hide,
  };
}
