import {
  createInitialInitiativeState,
  resetInitiativeState,
  createInitiativeOverlay,
} from './initiative.js';

const LIFE_STORAGE_KEY = 'battlebox.life.v1'; // Do not bump version unless explicitly requested.
const HOLD_DELAY_MS = 500;
const HOLD_REPEAT_MS = 500;
const HOLD_DELTA_MULTIPLIER = 10;
const RESET_HIGHLIGHT_MS = 10000;
const RESET_CONFIRM_WINDOW_MS = 2500;
const TOKEN_MIN = 0;
const TOKEN_MAX = 20;
const MANA_MIN = 0;
const MANA_MAX = 99;
const TOKEN_TYPES = [
  { id: 'blood', icon: '🩸', label: 'Blood' },
  { id: 'treasure', icon: '💰', label: 'Treasure' },
  { id: 'food', icon: '🍔', label: 'Food' },
  { id: 'clue', icon: '🔎', label: 'Clue' },
  { id: 'map', icon: '🗺️', label: 'Map' },
];
const TOKEN_IDS = TOKEN_TYPES.map((token) => token.id);
const MANA_TYPES = [
  { id: 'storm', label: 'Storm', symbolFile: 'storm' },
  { id: 'w', label: 'White', symbolFile: 'w' },
  { id: 'u', label: 'Blue', symbolFile: 'u' },
  { id: 'b', label: 'Black', symbolFile: 'b' },
  { id: 'r', label: 'Red', symbolFile: 'r' },
  { id: 'g', label: 'Green', symbolFile: 'g' },
  { id: 'c', label: 'Colorless', symbolFile: 'c' },
];
const MANA_IDS = MANA_TYPES.map((mana) => mana.id);

function resolveTokenCounterGrid(visibleCount) {
  if (visibleCount <= 2) {
    return { rows: 2, cols: 2, itemRowSpan: 2 };
  }
  if (visibleCount <= 4) {
    return { rows: 2, cols: 2, itemRowSpan: 1 };
  }
  return { rows: 2, cols: 3, itemRowSpan: 1 };
}

function parseLifeTotal(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseMonarchOwner(value) {
  return value === 'p1' || value === 'p2' ? value : null;
}

function createTokenMap(initialValue) {
  return TOKEN_IDS.reduce((acc, tokenId) => {
    acc[tokenId] = initialValue;
    return acc;
  }, {});
}

function createManaMap(initialValue) {
  return MANA_IDS.reduce((acc, manaId) => {
    acc[manaId] = initialValue;
    return acc;
  }, {});
}

function clampTokenCount(value) {
  return Math.max(TOKEN_MIN, Math.min(TOKEN_MAX, value));
}

function clampManaCount(value) {
  return Math.max(MANA_MIN, Math.min(MANA_MAX, value));
}

function parseTokenCount(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) return null;
  return clampTokenCount(parsed);
}

function parseTokenVisible(value) {
  return value === true;
}

function parseManaCount(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) return 0;
  return clampManaCount(parsed);
}

function parseTokenCounts(value) {
  const counts = createTokenMap(null);
  TOKEN_IDS.forEach((tokenId) => {
    counts[tokenId] = parseTokenCount(value?.[tokenId]);
  });
  return counts;
}

function parseTokenVisibility(value) {
  const visible = createTokenMap(false);
  TOKEN_IDS.forEach((tokenId) => {
    visible[tokenId] = parseTokenVisible(value?.[tokenId]);
  });
  return visible;
}

function parseManaCounts(value) {
  const counts = createManaMap(0);
  MANA_IDS.forEach((manaId) => {
    counts[manaId] = parseManaCount(value?.[manaId]);
  });
  return counts;
}

function parseTokenOrder(value) {
  if (!Array.isArray(value)) return [];
  const order = [];
  value.forEach((tokenId) => {
    if (!TOKEN_IDS.includes(tokenId)) return;
    if (order.includes(tokenId)) return;
    order.push(tokenId);
  });
  return order;
}

function serializeTokenCounts(value) {
  const counts = createTokenMap(null);
  TOKEN_IDS.forEach((tokenId) => {
    counts[tokenId] = value?.[tokenId] ?? null;
  });
  return counts;
}

function serializeTokenVisibility(value) {
  const visible = createTokenMap(false);
  TOKEN_IDS.forEach((tokenId) => {
    visible[tokenId] = value?.[tokenId] === true;
  });
  return visible;
}

function serializeManaCounts(value) {
  const counts = createManaMap(0);
  MANA_IDS.forEach((manaId) => {
    counts[manaId] = parseManaCount(value?.[manaId]);
  });
  return counts;
}

function buildTokenToggleGridHtml(player) {
  const buttons = TOKEN_TYPES.map((token) => (
    `<button type="button" class="static-button life-token-toggle life-token-toggle-${token.id}" data-life-token-toggle data-player="${player}" data-token="${token.id}" data-life-control aria-label="Toggle player ${player === 'p1' ? '1' : '2'} ${token.label.toLowerCase()} counter">${token.icon}</button>`
  )).join('');
  return `
    <div class="life-token-menu life-token-menu-${player}" data-life-token-menu="${player}" data-life-control>
      <button type="button" class="static-button life-token-menu-button life-token-menu-anchor" data-life-token-menu-trigger="${player}" data-life-control aria-label="Toggle player ${player === 'p1' ? '1' : '2'} token controls" aria-expanded="false"><span class="life-token-menu-glyph" aria-hidden="true">🧩</span></button>
      <div class="life-token-menu-panel life-token-menu-panel-${player}" data-life-token-menu-panel="${player}" data-life-control hidden>
        ${buttons}
      </div>
    </div>
  `;
}

function buildTokenTickersHtml(player) {
  const tickers = TOKEN_TYPES.map((token) => (
    `<div class="life-token-ticker" data-life-token-ticker data-player="${player}" data-token="${token.id}" data-life-control aria-label="Player ${player === 'p1' ? '1' : '2'} ${token.label.toLowerCase()} counter" hidden>
      <span class="life-hit-hint life-hit-hint-left" aria-hidden="true">-</span>
      <span class="life-token-center">
        <span class="life-token-icon" aria-hidden="true">${token.icon}</span>
        <span class="life-token-total" data-life-token-total data-player="${player}" data-token="${token.id}">1</span>
      </span>
      <span class="life-hit-hint life-hit-hint-right" aria-hidden="true">+</span>
    </div>`
  )).join('');
  return `<div class="life-token-counters life-token-counters-${player}" data-life-token-counters="${player}" data-life-control>${tickers}</div>`;
}

function buildManaPoolHtml(player) {
  const buttons = MANA_TYPES.map((mana) => {
    const glyph = `<span class="life-mana-symbol life-mana-symbol-${mana.id}" aria-hidden="true"><img class="life-mana-symbol-img" src="/assets/mana/${mana.symbolFile}.svg" alt=""></span>`;
    return `
      <button type="button" class="static-button life-mana-button life-mana-${mana.id}" data-life-mana-button data-player="${player}" data-mana="${mana.id}" data-life-control aria-label="Adjust player ${player === 'p1' ? '1' : '2'} ${mana.label.toLowerCase()} counter">
        ${glyph}
        <span class="life-mana-total" data-life-mana-total data-player="${player}" data-mana="${mana.id}">0</span>
      </button>
    `;
  }).join('');
  return `
    <div class="life-mana-menu life-mana-menu-${player}" data-life-mana-menu="${player}" data-life-control>
      <button type="button" class="static-button life-mana-menu-button" data-life-mana-menu-trigger="${player}" data-life-control aria-label="Toggle player ${player === 'p1' ? '1' : '2'} mana and storm counters" aria-expanded="false">✦</button>
      <div class="life-mana-panel life-mana-panel-${player}" data-life-mana-panel="${player}" data-life-control hidden>
        <div class="life-mana-grid">
          ${buttons}
          <button type="button" class="static-button life-mana-reset" data-life-mana-reset="${player}" data-life-control aria-label="Reset player ${player === 'p1' ? '1' : '2'} mana and storm counters">↺</button>
        </div>
      </div>
    </div>
  `;
}

function readLifeState(startingLife) {
  const fallback = {
    p1: startingLife,
    p2: startingLife,
    monarch: null,
    initiative: createInitialInitiativeState(),
    tokens: {
      p1: createTokenMap(null),
      p2: createTokenMap(null),
    },
    tokenVisible: {
      p1: createTokenMap(false),
      p2: createTokenMap(false),
    },
    tokenOrder: {
      p1: [],
      p2: [],
    },
    mana: {
      p1: createManaMap(0),
      p2: createManaMap(0),
    },
  };
  try {
    const raw = window.localStorage.getItem(LIFE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      p1: parseLifeTotal(parsed?.p1, startingLife),
      p2: parseLifeTotal(parsed?.p2, startingLife),
      monarch: parseMonarchOwner(parsed?.monarch),
      initiative: createInitialInitiativeState(parsed?.initiative),
      tokens: {
        p1: parseTokenCounts(parsed?.tokens?.p1),
        p2: parseTokenCounts(parsed?.tokens?.p2),
      },
      tokenVisible: {
        p1: parseTokenVisibility(parsed?.tokenVisible?.p1),
        p2: parseTokenVisibility(parsed?.tokenVisible?.p2),
      },
      tokenOrder: {
        p1: parseTokenOrder(parsed?.tokenOrder?.p1),
        p2: parseTokenOrder(parsed?.tokenOrder?.p2),
      },
      mana: {
        p1: parseManaCounts(parsed?.mana?.p1),
        p2: parseManaCounts(parsed?.mana?.p2),
      },
    };
  } catch (_) {
    return fallback;
  }
}

function writeLifeState(state) {
  try {
    window.localStorage.setItem(
      LIFE_STORAGE_KEY,
      JSON.stringify({
        p1: state.p1,
        p2: state.p2,
        monarch: parseMonarchOwner(state.monarch),
        initiative: createInitialInitiativeState(state.initiative),
        tokens: {
          p1: serializeTokenCounts(state.tokens?.p1),
          p2: serializeTokenCounts(state.tokens?.p2),
        },
        tokenVisible: {
          p1: serializeTokenVisibility(state.tokenVisible?.p1),
          p2: serializeTokenVisibility(state.tokenVisible?.p2),
        },
        tokenOrder: {
          p1: parseTokenOrder(state.tokenOrder?.p1),
          p2: parseTokenOrder(state.tokenOrder?.p2),
        },
        mana: {
          p1: serializeManaCounts(state.mana?.p1),
          p2: serializeManaCounts(state.mana?.p2),
        },
      })
    );
  } catch (_) {
    // Ignore storage failures (e.g., private mode restrictions).
  }
}

function getLifeInteraction(panel, event) {
  if (!(panel instanceof HTMLElement)) return null;
  if (!event.isPrimary) return null;
  if (event.pointerType === 'mouse' && event.button !== 0) return null;

  const rect = panel.getBoundingClientRect();
  if (!rect.width) return null;

  const player = panel.dataset.player === 'p2' ? 'p2' : 'p1';
  const physicalX = event.clientX - rect.left;
  // The top panel is rotated 180deg, so horizontal hit zones are mirrored.
  const logicalX = player === 'p2' ? (rect.width - physicalX) : physicalX;
  const isAdd = logicalX >= (rect.width / 2);
  const step = isAdd ? 1 : -1;

  return { player, step };
}

function getManaInteraction(button, event) {
  if (!(button instanceof HTMLElement)) return null;
  if (!event.isPrimary) return null;
  if (event.pointerType === 'mouse' && event.button !== 0) return null;

  const rect = button.getBoundingClientRect();
  if (!rect.height) return null;

  const player = button.dataset.player === 'p2' ? 'p2' : 'p1';
  const manaId = button.dataset.mana;
  if (!MANA_IDS.includes(manaId)) return null;

  const physicalY = event.clientY - rect.top;
  // The top panel is rotated 180deg, so vertical hit zones are mirrored.
  const logicalY = player === 'p2' ? (rect.height - physicalY) : physicalY;
  const isAdd = logicalY < (rect.height / 2);
  const step = isAdd ? 1 : -1;

  return { player, manaId, step };
}

function bindControlAction(button, onActivate) {
  if (!(button instanceof HTMLElement) || typeof onActivate !== 'function') return;

  button.addEventListener('click', onActivate);
}

export function createLifeCounter(container, startingLife = 20) {
  const state = readLifeState(startingLife);
  let activeHold = null;
  let resetHighlightTimer = null;
  let resetConfirmTimer = null;
  let resetArmed = false;

  container.innerHTML = `
    <div class="life-counter" aria-label="Life counter">
      <section class="life-player life-player-top" data-player="p2" aria-label="Player 2 life total">
        ${buildManaPoolHtml('p2')}
        ${buildTokenToggleGridHtml('p2')}
        ${buildTokenTickersHtml('p2')}
        <span class="life-player-icon life-player-icon-p2" aria-hidden="true">🐭</span>
        <span class="life-monarch life-monarch-p2" data-life-monarch="p2" aria-hidden="true" hidden>👑</span>
        <span class="life-initiative life-initiative-p2" data-life-initiative="p2" aria-hidden="true" hidden>♿️</span>
        <span class="life-hit-hint life-hit-hint-left" aria-hidden="true">-</span>
        <span class="life-total" data-life-total="p2">${state.p2}</span>
        <span class="life-hit-hint life-hit-hint-right" aria-hidden="true">+</span>
      </section>
      <section class="life-controls" aria-label="Life controls">
        <button type="button" class="static-button life-control-button" id="life-left-button" aria-label="Toggle monarch">👑</button>
        <button type="button" class="static-button life-control-button" id="life-reset-button" aria-label="Reset life totals">🔄</button>
        <button type="button" class="static-button life-control-button" id="life-right-button" aria-label="Open initiative tracker">♿️</button>
      </section>
      <section class="life-player life-player-bottom" data-player="p1" aria-label="Player 1 life total">
        ${buildManaPoolHtml('p1')}
        ${buildTokenToggleGridHtml('p1')}
        ${buildTokenTickersHtml('p1')}
        <span class="life-player-icon life-player-icon-p1" aria-hidden="true">🐿️</span>
        <span class="life-monarch life-monarch-p1" data-life-monarch="p1" aria-hidden="true" hidden>👑</span>
        <span class="life-initiative life-initiative-p1" data-life-initiative="p1" aria-hidden="true" hidden>♿️</span>
        <span class="life-hit-hint life-hit-hint-left" aria-hidden="true">-</span>
        <span class="life-total" data-life-total="p1">${state.p1}</span>
        <span class="life-hit-hint life-hit-hint-right" aria-hidden="true">+</span>
      </section>
    </div>
  `;

  const totals = {
    p1: container.querySelector('[data-life-total="p1"]'),
    p2: container.querySelector('[data-life-total="p2"]'),
  };
  const players = {
    p1: container.querySelector('.life-player[data-player="p1"]'),
    p2: container.querySelector('.life-player[data-player="p2"]'),
  };
  const resetButton = container.querySelector('#life-reset-button');
  const leftButton = container.querySelector('#life-left-button');
  const rightButton = container.querySelector('#life-right-button');
  const monarchMarkers = {
    p1: container.querySelector('[data-life-monarch="p1"]'),
    p2: container.querySelector('[data-life-monarch="p2"]'),
  };
  const initiativeMarkers = {
    p1: container.querySelector('[data-life-initiative="p1"]'),
    p2: container.querySelector('[data-life-initiative="p2"]'),
  };
  const tokenToggleButtons = {
    p1: createTokenMap(null),
    p2: createTokenMap(null),
  };
  const tokenMenuButtons = {
    p1: null,
    p2: null,
  };
  const tokenMenuPanels = {
    p1: null,
    p2: null,
  };
  const tokenMenuContainers = {
    p1: null,
    p2: null,
  };
  const tokenMenuOpen = {
    p1: false,
    p2: false,
  };
  const tokenCounterContainers = {
    p1: null,
    p2: null,
  };
  const tokenTickers = {
    p1: createTokenMap(null),
    p2: createTokenMap(null),
  };
  const tokenTotals = {
    p1: createTokenMap(null),
    p2: createTokenMap(null),
  };
  const manaMenuButtons = {
    p1: null,
    p2: null,
  };
  const manaMenuPanels = {
    p1: null,
    p2: null,
  };
  const manaMenuContainers = {
    p1: null,
    p2: null,
  };
  const manaMenuOpen = {
    p1: false,
    p2: false,
  };
  const manaButtons = {
    p1: createManaMap(null),
    p2: createManaMap(null),
  };
  const manaTotals = {
    p1: createManaMap(null),
    p2: createManaMap(null),
  };
  const manaResetButtons = {
    p1: null,
    p2: null,
  };
  container.querySelectorAll('[data-life-token-toggle]').forEach((button) => {
    const player = button.dataset.player === 'p2' ? 'p2' : 'p1';
    const tokenId = button.dataset.token;
    if (!TOKEN_IDS.includes(tokenId)) return;
    tokenToggleButtons[player][tokenId] = button;
  });
  container.querySelectorAll('[data-life-token-menu]').forEach((menu) => {
    const player = menu.dataset.lifeTokenMenu === 'p2' ? 'p2' : 'p1';
    tokenMenuContainers[player] = menu;
  });
  container.querySelectorAll('[data-life-token-menu-trigger]').forEach((button) => {
    const player = button.dataset.lifeTokenMenuTrigger === 'p2' ? 'p2' : 'p1';
    tokenMenuButtons[player] = button;
  });
  container.querySelectorAll('[data-life-token-menu-panel]').forEach((panel) => {
    const player = panel.dataset.lifeTokenMenuPanel === 'p2' ? 'p2' : 'p1';
    tokenMenuPanels[player] = panel;
  });
  container.querySelectorAll('[data-life-token-counters]').forEach((counterGrid) => {
    const player = counterGrid.dataset.lifeTokenCounters === 'p2' ? 'p2' : 'p1';
    tokenCounterContainers[player] = counterGrid;
  });
  container.querySelectorAll('[data-life-token-ticker]').forEach((ticker) => {
    const player = ticker.dataset.player === 'p2' ? 'p2' : 'p1';
    const tokenId = ticker.dataset.token;
    if (!TOKEN_IDS.includes(tokenId)) return;
    tokenTickers[player][tokenId] = ticker;
  });
  container.querySelectorAll('[data-life-token-total]').forEach((total) => {
    const player = total.dataset.player === 'p2' ? 'p2' : 'p1';
    const tokenId = total.dataset.token;
    if (!TOKEN_IDS.includes(tokenId)) return;
    tokenTotals[player][tokenId] = total;
  });
  container.querySelectorAll('[data-life-mana-menu]').forEach((menu) => {
    const player = menu.dataset.lifeManaMenu === 'p2' ? 'p2' : 'p1';
    manaMenuContainers[player] = menu;
  });
  container.querySelectorAll('[data-life-mana-menu-trigger]').forEach((button) => {
    const player = button.dataset.lifeManaMenuTrigger === 'p2' ? 'p2' : 'p1';
    manaMenuButtons[player] = button;
  });
  container.querySelectorAll('[data-life-mana-panel]').forEach((panel) => {
    const player = panel.dataset.lifeManaPanel === 'p2' ? 'p2' : 'p1';
    manaMenuPanels[player] = panel;
  });
  container.querySelectorAll('[data-life-mana-button]').forEach((button) => {
    const player = button.dataset.player === 'p2' ? 'p2' : 'p1';
    const manaId = button.dataset.mana;
    if (!MANA_IDS.includes(manaId)) return;
    manaButtons[player][manaId] = button;
  });
  container.querySelectorAll('[data-life-mana-total]').forEach((total) => {
    const player = total.dataset.player === 'p2' ? 'p2' : 'p1';
    const manaId = total.dataset.mana;
    if (!MANA_IDS.includes(manaId)) return;
    manaTotals[player][manaId] = total;
  });
  container.querySelectorAll('[data-life-mana-reset]').forEach((button) => {
    const player = button.dataset.lifeManaReset === 'p2' ? 'p2' : 'p1';
    manaResetButtons[player] = button;
  });

  const render = () => {
    totals.p1.textContent = String(state.p1);
    totals.p2.textContent = String(state.p2);
  };

  const renderMonarch = () => {
    Object.entries(monarchMarkers).forEach(([player, marker]) => {
      if (!marker) return;
      marker.hidden = state.monarch !== player;
    });
    Object.entries(players).forEach(([player, panel]) => {
      if (!panel) return;
      panel.classList.toggle('life-player-has-monarch', state.monarch === player);
    });
  };
  const renderInitiative = () => {
    const owner = state.initiative?.owner === 'p1' || state.initiative?.owner === 'p2'
      ? state.initiative.owner
      : null;
    Object.entries(initiativeMarkers).forEach(([player, marker]) => {
      if (!marker) return;
      marker.hidden = owner !== player;
    });
  };
  const renderTokens = () => {
    ['p1', 'p2'].forEach((player) => {
      const counterGrid = tokenCounterContainers[player];
      const orderedVisible = state.tokenOrder[player].filter((tokenId) => state.tokenVisible[player][tokenId] === true);
      TOKEN_IDS.forEach((tokenId) => {
        const button = tokenToggleButtons[player][tokenId];
        const ticker = tokenTickers[player][tokenId];
        const total = tokenTotals[player][tokenId];
        const visible = state.tokenVisible[player][tokenId] === true;
        const positioned = orderedVisible.includes(tokenId);
        if (button) {
          button.classList.toggle('active', visible);
        }
        if (ticker) {
          ticker.hidden = !visible || !positioned;
          ticker.style.gridColumn = '';
          ticker.style.gridRow = '';
          ticker.classList.remove('life-token-ticker-tall');
        }
        if (total) {
          const value = state.tokens[player][tokenId] === null ? 1 : clampTokenCount(state.tokens[player][tokenId]);
          total.textContent = String(value);
        }
      });

      const visibleCount = orderedVisible.length;
      const { rows, cols, itemRowSpan } = resolveTokenCounterGrid(visibleCount);
      if (counterGrid) {
        counterGrid.hidden = visibleCount <= 0;
        counterGrid.style.setProperty('--token-counter-rows', String(rows));
        counterGrid.style.setProperty('--token-counter-cols', String(cols));
      }
      orderedVisible.forEach((tokenId, index) => {
        const ticker = tokenTickers[player][tokenId];
        if (!ticker) return;
        const row = Math.floor(index / cols) + 1;
        const col = (index % cols) + 1;
        const fillBottomFirst = rows > 1 && itemRowSpan === 1;
        const visualRow = fillBottomFirst ? (rows - row + 1) : row;
        ticker.style.gridRow = itemRowSpan > 1 ? `${visualRow} / span ${itemRowSpan}` : String(visualRow);
        ticker.style.gridColumn = String(col);
        ticker.classList.toggle('life-token-ticker-tall', itemRowSpan > 1);
      });
    });
  };
  const renderTokenMenus = () => {
    ['p1', 'p2'].forEach((player) => {
      const button = tokenMenuButtons[player];
      const panel = tokenMenuPanels[player];
      const menu = tokenMenuContainers[player];
      const open = tokenMenuOpen[player] === true;
      if (menu) {
        menu.classList.toggle('open', open);
      }
      if (panel) {
        panel.hidden = !open;
      }
      if (button) {
        button.classList.toggle('active', open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    });
  };
  const renderMana = () => {
    ['p1', 'p2'].forEach((player) => {
      MANA_IDS.forEach((manaId) => {
        const total = manaTotals[player][manaId];
        const value = parseManaCount(state.mana?.[player]?.[manaId]);
        if (total) {
          total.textContent = String(value);
        }
      });
    });
  };
  const renderManaMenus = () => {
    ['p1', 'p2'].forEach((player) => {
      const button = manaMenuButtons[player];
      const panel = manaMenuPanels[player];
      const menu = manaMenuContainers[player];
      const open = manaMenuOpen[player] === true;
      if (menu) {
        menu.classList.toggle('open', open);
      }
      if (panel) {
        panel.hidden = !open;
      }
      if (button) {
        button.classList.toggle('active', open);
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    });
  };
  const initiativeOverlay = createInitiativeOverlay(container, state, () => {
    writeLifeState(state);
    renderInitiative();
  });

  const applyDelta = (player, delta) => {
    state[player] += delta;
    render();
    writeLifeState(state);
  };
  const applyTokenDelta = (player, tokenId, delta) => {
    const current = state.tokens[player][tokenId] === null ? 1 : state.tokens[player][tokenId];
    const next = clampTokenCount(current + delta);
    state.tokens[player][tokenId] = next;
    renderTokens();
    writeLifeState(state);
  };
  const applyManaDelta = (player, manaId, delta) => {
    state.mana[player][manaId] = clampManaCount(parseManaCount(state.mana[player][manaId]) + delta);
    renderMana();
    writeLifeState(state);
  };
  const resetMana = (player) => {
    state.mana[player] = createManaMap(0);
    manaMenuOpen[player] = false;
    renderMana();
    renderManaMenus();
    writeLifeState(state);
  };
  const toggleTokenTicker = (player, tokenId) => {
    const visible = state.tokenVisible[player][tokenId] === true;
    if (visible) {
      state.tokenVisible[player][tokenId] = false;
      state.tokens[player][tokenId] = null;
      state.tokenOrder[player] = state.tokenOrder[player].filter((value) => value !== tokenId);
      tokenMenuOpen[player] = false;
      renderTokenMenus();
      renderTokens();
      writeLifeState(state);
      return;
    }
    if (state.tokens[player][tokenId] === null) {
      state.tokens[player][tokenId] = 1;
    }
    state.tokenVisible[player][tokenId] = true;
    state.tokenOrder[player] = state.tokenOrder[player].filter((value) => value !== tokenId);
    state.tokenOrder[player].push(tokenId);
    tokenMenuOpen[player] = false;
    renderTokenMenus();
    renderTokens();
    writeLifeState(state);
  };
  const toggleTokenMenu = (player) => {
    tokenMenuOpen[player] = !tokenMenuOpen[player];
    renderTokenMenus();
  };
  const toggleManaMenu = (player) => {
    manaMenuOpen[player] = !manaMenuOpen[player];
    renderManaMenus();
  };

  const resetGameState = () => {
    state.p1 = startingLife;
    state.p2 = startingLife;
    state.monarch = null;
    state.initiative = resetInitiativeState();
    state.tokens = {
      p1: createTokenMap(null),
      p2: createTokenMap(null),
    };
    state.tokenVisible = {
      p1: createTokenMap(false),
      p2: createTokenMap(false),
    };
    state.tokenOrder = {
      p1: [],
      p2: [],
    };
    state.mana = {
      p1: createManaMap(0),
      p2: createManaMap(0),
    };
    tokenMenuOpen.p1 = false;
    tokenMenuOpen.p2 = false;
    manaMenuOpen.p1 = false;
    manaMenuOpen.p2 = false;
    render();
    renderMonarch();
    renderInitiative();
    renderTokenMenus();
    renderTokens();
    renderMana();
    renderManaMenus();
    writeLifeState(state);
    initiativeOverlay.sync();
  };

  const clearActiveHold = () => {
    if (!activeHold) return;
    if (activeHold.delayTimer) window.clearTimeout(activeHold.delayTimer);
    if (activeHold.repeatTimer) window.clearInterval(activeHold.repeatTimer);
    activeHold = null;
  };
  const startHoldInteraction = (event, target, interaction, applyStep) => {
    event.preventDefault();
    clearActiveHold();

    if (target instanceof HTMLElement && target.setPointerCapture) {
      try {
        target.setPointerCapture(event.pointerId);
      } catch (_) {
        // Ignore capture failures and continue with basic press handling.
      }
    }

    const hold = {
      pointerId: event.pointerId,
      tapDelta: interaction.step,
      holdDelta: interaction.step * HOLD_DELTA_MULTIPLIER,
      isHolding: false,
      applyStep,
      delayTimer: null,
      repeatTimer: null,
    };
    activeHold = hold;

    hold.delayTimer = window.setTimeout(() => {
      if (activeHold !== hold) return;
      hold.isHolding = true;
      hold.applyStep(hold.holdDelta);
      hold.repeatTimer = window.setInterval(() => {
        if (activeHold !== hold) return;
        hold.applyStep(hold.holdDelta);
      }, HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  const clearResetHighlight = () => {
    if (resetHighlightTimer) {
      window.clearTimeout(resetHighlightTimer);
      resetHighlightTimer = null;
    }
    Object.values(players).forEach((panel) => {
      if (panel) {
        panel.classList.remove('life-player-random-highlight');
      }
    });
  };

  const disarmReset = () => {
    resetArmed = false;
    if (resetConfirmTimer) {
      window.clearTimeout(resetConfirmTimer);
      resetConfirmTimer = null;
    }
    if (resetButton) {
      resetButton.textContent = '🔄';
      resetButton.setAttribute('aria-label', 'Reset life totals');
    }
  };

  const armReset = () => {
    disarmReset();
    resetArmed = true;
    if (resetButton) {
      resetButton.textContent = 'Reset?';
      resetButton.setAttribute('aria-label', 'Confirm reset');
    }
    resetConfirmTimer = window.setTimeout(() => {
      disarmReset();
    }, RESET_CONFIRM_WINDOW_MS);
  };

  const highlightRandomPlayer = () => {
    clearResetHighlight();
    const chosenPlayer = Math.random() < 0.5 ? 'p1' : 'p2';
    const chosenPanel = players[chosenPlayer];
    if (!chosenPanel) return;
    chosenPanel.classList.add('life-player-random-highlight');
    resetHighlightTimer = window.setTimeout(() => {
      chosenPanel.classList.remove('life-player-random-highlight');
      resetHighlightTimer = null;
    }, RESET_HIGHLIGHT_MS);
  };

  const onPointerDown = (event) => {
    const panel = event.currentTarget;
    if (event.target instanceof Element && event.target.closest('[data-life-control]')) {
      return;
    }
    const interaction = getLifeInteraction(panel, event);
    if (!interaction) return;
    const player = interaction.player;
    startHoldInteraction(event, panel, interaction, (delta) => {
      applyDelta(player, delta);
    });
  };
  const onTokenPointerDown = (event) => {
    const ticker = event.currentTarget;
    const interaction = getLifeInteraction(ticker, event);
    if (!interaction) return;
    const player = interaction.player;
    const tokenId = ticker.dataset.token;
    if (!TOKEN_IDS.includes(tokenId)) return;
    startHoldInteraction(event, ticker, interaction, (delta) => {
      applyTokenDelta(player, tokenId, delta);
    });
  };
  const onManaPointerDown = (event) => {
    const button = event.currentTarget;
    const interaction = getManaInteraction(button, event);
    if (!interaction) return;
    const { player, manaId } = interaction;
    startHoldInteraction(event, button, interaction, (delta) => {
      applyManaDelta(player, manaId, delta);
    });
  };

  const onPointerUp = (event) => {
    if (!activeHold || activeHold.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { tapDelta, isHolding, applyStep } = activeHold;
    clearActiveHold();
    if (!isHolding) {
      applyStep(tapDelta);
    }
  };

  const onPointerCancel = (event) => {
    if (!activeHold || activeHold.pointerId !== event.pointerId) return;
    event.preventDefault();
    clearActiveHold();
  };

  container.querySelectorAll('.life-player').forEach((panel) => {
    panel.addEventListener('pointerdown', onPointerDown);
    panel.addEventListener('pointerup', onPointerUp);
    panel.addEventListener('pointercancel', onPointerCancel);
    panel.addEventListener('lostpointercapture', onPointerCancel);
    panel.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });
  ['p1', 'p2'].forEach((player) => {
    const menuButton = tokenMenuButtons[player];
    bindControlAction(menuButton, () => {
      toggleTokenMenu(player);
    });
    TOKEN_IDS.forEach((tokenId) => {
      const ticker = tokenTickers[player][tokenId];
      const button = tokenToggleButtons[player][tokenId];
      if (ticker) {
        ticker.addEventListener('pointerdown', onTokenPointerDown);
        ticker.addEventListener('pointerup', onPointerUp);
        ticker.addEventListener('pointercancel', onPointerCancel);
        ticker.addEventListener('lostpointercapture', onPointerCancel);
        ticker.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      }
      bindControlAction(button, () => {
        toggleTokenTicker(player, tokenId);
      });
    });
    const manaMenuButton = manaMenuButtons[player];
    bindControlAction(manaMenuButton, () => {
      toggleManaMenu(player);
    });
    MANA_IDS.forEach((manaId) => {
      const button = manaButtons[player][manaId];
      if (!button) return;
      button.addEventListener('pointerdown', onManaPointerDown);
      button.addEventListener('pointerup', onPointerUp);
      button.addEventListener('pointercancel', onPointerCancel);
      button.addEventListener('lostpointercapture', onPointerCancel);
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    bindControlAction(manaResetButtons[player], () => {
      resetMana(player);
    });
  });

  bindControlAction(resetButton, () => {
    clearActiveHold();
    if (!resetArmed) {
      armReset();
      return;
    }
    disarmReset();
    resetGameState();
    highlightRandomPlayer();
  });

  bindControlAction(leftButton, () => {
    state.monarch = state.monarch === 'p1' ? 'p2' : 'p1';
    renderMonarch();
    writeLifeState(state);
  });

  bindControlAction(rightButton, () => {
    initiativeOverlay.toggle();
  });

  render();
  renderMonarch();
  renderInitiative();
  renderTokenMenus();
  renderTokens();
  renderMana();
  renderManaMenus();
  initiativeOverlay.sync();
}
