import {
  formatColors,
  archetypeTagRank,
  sortArchetypeTags,
  sortDifficultyTags,
  renderDeckTags,
  renderDifficultyTags,
  renderDeckSelectionTags,
  capitalize,
  escapeHtml,
  normalizeName,
  buildDoubleFacedMap,
  scryfallImageUrlByPrinting,
} from './app/utils.js';
import {
  normalizeSortMode,
  normalizeSortDirection,
  normalizeCollapsedMask,
  normalizeApplySideboard,
  parseHashRoute,
  buildBattleboxHash,
  buildDeckHash,
} from './app/state.js';
import {
  TAB_BATTLEBOX,
  TAB_LIFE,
  TAB_DRAFT,
  TAB_MATRIX,
  TAB_COMBO,
  normalizeTab,
  tabFromSearch,
  parseDraftRoomSelectionFromSearch,
  replaceHashPreserveSearch,
  setTabInLocationSearch,
  setDraftRoomSelectionInLocationSearch,
} from './app/urlState.js';
import {
  fetchDraftRooms,
  getStableDeviceID,
} from './app/api.js';
import {
  buildCubeDeckBySlug,
  buildOpenRoomContext,
  buildPresetByConfig,
  parseDraftPresets,
} from './app/draftRoomContext.js';
import { computeDeckView } from './app/deckView.js';
import {
  createMarkdownRenderer,
  renderGuideContent,
} from './app/render.js';
import { renderDecklistGrid as renderSharedDecklistGrid } from './app/decklist.js';
import {
  buildGuideCountMap,
  parseGuideCountLine,
} from './app/guidePlan.js';
import { createCardPreview } from './app/preview.js';
import { createLifeCounter } from './app/life.js';
import { createSampleHandViewer } from './app/hand.js';
import { createDraftController } from './app/draft.js';
import { createLobbyController } from './app/lobby.js';
import { createMatrixController } from './app/matrix.js';

const app = document.getElementById('app');
let data = { index: null, battleboxes: {}, matrices: {}, buildId: '' };
const ui = {
  shell: null,
  header: null,
  body: null,
  footer: null,
  battleboxPane: null,
  lifePane: null,
  draftPane: null,
  matrixPane: null,
  comboPane: null,
  activeTab: TAB_BATTLEBOX,
};
const qrUi = {
  overlay: null,
  canvas: null,
};
const sourceEditorDrafts = new Map();
const runtimeCacheBust = Date.now().toString(36);
const matrixRouteContext = {
  battlebox: null,
  battleboxSlug: '',
  selectedDeckSlug: '',
  selectedMatchupSlug: '',
  enabled: false,
};
const comboRouteContext = {
  battleboxData: null,
  battleboxSlug: '',
  selectedDeckSlug: '',
  enabled: false,
};

function getCardTarget(event) {
  if (!event.target || !event.target.closest) return null;
  const draftSwapModeCard = event.target.closest('#draft-picks-cards .card');
  if (draftSwapModeCard) {
    const draftPane = event.target.closest('#tab-draft');
    if (draftPane && draftPane.dataset.sideboardSwapMode === '1') {
      return null;
    }
  }
  const hit = event.target.closest('.card-hit');
  if (hit) {
    const parentCard = hit.closest('.card');
    if (parentCard) return parentCard;
  }
  return event.target.closest('.card');
}

const preview = createCardPreview(app, getCardTarget);
const sampleHand = createSampleHandViewer();
const DEFAULT_DECK_UI = Object.freeze({
  decklist_view: 'default',
  sample: Object.freeze({
    mode: 'hand',
    size: 7,
    allow_draw: true,
  }),
  deck_info_badge: 'colors',
  deck_selection_badge: 'colors',
  show_basics_pane: false,
});
const BASIC_LANDS = Object.freeze([
  { key: 'plains', name: 'Plains' },
  { key: 'island', name: 'Island' },
  { key: 'swamp', name: 'Swamp' },
  { key: 'mountain', name: 'Mountain' },
  { key: 'forest', name: 'Forest' },
]);
let lobbyController = null;

async function hydrateDraftRoomFromSearch() {
  if (draftController.hasActiveRoom()) return true;
  const selection = parseDraftRoomSelectionFromSearch();
  if (!selection) return false;

  const [cube, deviceID] = await Promise.all([
    loadBattlebox('cube'),
    getStableDeviceID(),
  ]);
  const rooms = await fetchDraftRooms(deviceID);
  const room = (Array.isArray(rooms) ? rooms : []).find(
    (entry) => String(entry?.room_id || '').trim() === selection.roomId,
  );
  if (!room) return false;

  const cubeDeckBySlug = buildCubeDeckBySlug(cube);
  const presetEntries = parseDraftPresets(cube?.presets);
  const presetByConfig = buildPresetByConfig(presetEntries);
  const context = buildOpenRoomContext(room, selection.seat, cubeDeckBySlug, presetByConfig);
  if (!context) return false;

  draftController.openRoom(
    context.roomId,
    context.seat,
    context.roomDeckSlug,
    context.roomDeckPrintings,
    context.roomDeckName,
    context.roomDeckDoubleFaced,
    context.roomDeckCardMeta,
    context.roomPackTotal,
    context.roomPickTotal,
  );
  return true;
}

const draftController = createDraftController({
  ui,
  onLobbyRequested: () => {
    setDraftRoomSelectionInLocationSearch('', 0);
    setActiveTab(TAB_DRAFT);
  },
  onCubeRequested: (deckSlug) => {
    setActiveTab(TAB_BATTLEBOX);
    const normalizedDeckSlug = normalizeName(deckSlug || '');
    const nextHash = normalizedDeckSlug ? `#/cube/${normalizedDeckSlug}` : '#/cube';
    if (location.hash !== nextHash) {
      location.hash = nextHash;
    }
  },
  onRoomSelectionChanged: (roomId, seat) => {
    setDraftRoomSelectionInLocationSearch(roomId, seat);
  },
  onPreviewDismissRequested: () => {
    preview.hidePreview();
  },
  onSampleHandRequested: (payload) => {
    const key = String(payload?.key || '').trim();
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    const sample = payload?.sample || { initialDrawCount: 7, allowDraw: true };
    if (!key) return;
    preview.hidePreview();
    sampleHand.setDeckContext(key, cards, sample);
    sampleHand.open();
  },
});
lobbyController = createLobbyController({
  ui,
  loadBattlebox,
  draftController,
});
const matrixController = createMatrixController({
  ui,
  loadWinrateMatrix,
});

function normalizeDecklistViewMode(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'cube') return 'cube';
  if (key === 'nosideboard') return 'nosideboard';
  return 'default';
}

function normalizeSampleMode(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'pack') return 'pack';
  if (key === 'none') return 'none';
  return 'hand';
}

function normalizeBadgeMode(value) {
  return String(value || '').trim().toLowerCase() === 'card_count' ? 'card_count' : 'colors';
}

function resolveDeckUI(deck) {
  const rawUI = deck && deck.ui && typeof deck.ui === 'object' ? deck.ui : {};
  const rawSample = rawUI.sample && typeof rawUI.sample === 'object' ? rawUI.sample : null;
  const sampleMode = normalizeSampleMode(rawSample?.mode);
  const parsedSampleSize = Number.parseInt(String(rawSample?.size), 10);
  const defaultSampleSize = sampleMode === 'pack' ? 8 : DEFAULT_DECK_UI.sample.size;
  const sampleSize = Number.isFinite(parsedSampleSize) && parsedSampleSize > 0
    ? parsedSampleSize
    : defaultSampleSize;

  const rawAllowDraw = typeof rawSample?.allow_draw === 'boolean'
    ? rawSample.allow_draw
    : DEFAULT_DECK_UI.sample.allow_draw;
  const sampleAllowDraw = sampleMode === 'hand' ? rawAllowDraw : false;

  return {
    decklist_view: normalizeDecklistViewMode(rawUI.decklist_view),
    sample: {
      mode: sampleMode,
      size: sampleSize,
      allow_draw: sampleAllowDraw,
    },
    deck_info_badge: normalizeBadgeMode(rawUI.deck_info_badge),
    deck_selection_badge: normalizeBadgeMode(rawUI.deck_selection_badge),
    show_basics_pane: rawUI.show_basics_pane === true,
  };
}

function getDeckCardCount(deck) {
  const fromDeck = Number.parseInt(String(deck?.card_count), 10);
  if (Number.isFinite(fromDeck) && fromDeck > 0) return fromDeck;
  const cards = Array.isArray(deck?.cards) ? deck.cards : [];
  return cards.reduce((sum, card) => sum + (Number.parseInt(String(card?.qty), 10) || 0), 0);
}

function renderDeckBadge(deck, mode) {
  if (normalizeBadgeMode(mode) === 'card_count') {
    return `${getDeckCardCount(deck)} cards`;
  }
  return formatColors(deck?.colors || '');
}

function renderBasicsPane(deckPrintings) {
  const basicsHtml = BASIC_LANDS.map((basic) => {
    const printing = String(deckPrintings?.[basic.key] || '').trim();
    const hasPrinting = printing !== '';
    if (!hasPrinting) {
      return `<span class="deck-basics-card deck-basics-card-missing">${basic.name}</span>`;
    }
    const imageUrl = scryfallImageUrlByPrinting(printing, 'front');
    return `
      <span class="deck-basics-card deck-basics-card-image card card-ref" data-name="${basic.name}" data-printing="${printing}">
        <img src="${imageUrl}" alt="${basic.name}" loading="lazy" decoding="async">
      </span>
    `;
  }).join('');

  return `
    <div class="deck-basics-pane">
      <div class="panel-title deck-basics-header">Basic Lands</div>
      <div class="deck-basics-row">${basicsHtml}</div>
    </div>
  `;
}

function guideToRawMarkdown(guide) {
  if (!guide) return '';
  if (typeof guide === 'string') return guide.trim();

  const ins = Array.isArray(guide.in) ? guide.in : [];
  const outs = Array.isArray(guide.out) ? guide.out : [];
  const prose = (guide.text || '').trim();
  const lines = [];

  ins.forEach((line) => {
    const value = String(line || '').trim();
    if (value) lines.push(`+ ${value}`);
  });
  outs.forEach((line) => {
    const value = String(line || '').trim();
    if (value) lines.push(`- ${value}`);
  });
  if (prose) {
    if (lines.length) lines.push('');
    lines.push(prose);
  }
  return lines.join('\n');
}

function buildDeckZoneMeta(cards) {
  const qtyByKey = {};
  const nameByKey = {};
  const orderIndex = {};
  let nextIndex = 0;
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    const name = String(card?.name || '').trim();
    const key = normalizeName(name);
    if (!key) return;
    if (!Object.prototype.hasOwnProperty.call(qtyByKey, key)) {
      orderIndex[key] = nextIndex;
      nextIndex += 1;
      nameByKey[key] = name;
      qtyByKey[key] = 0;
    }
    qtyByKey[key] += Number(card?.qty) || 0;
  });
  return { qtyByKey, nameByKey, orderIndex };
}

function buildGuideZoneLines(countMap, zoneMeta) {
  const keys = Object.keys(countMap || {}).filter((key) => (countMap[key] || 0) > 0);
  keys.sort((a, b) => {
    const aIdx = zoneMeta.orderIndex[a];
    const bIdx = zoneMeta.orderIndex[b];
    if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
    if (aIdx >= 0) return -1;
    if (bIdx >= 0) return 1;
    return a.localeCompare(b);
  });
  return keys.map((key) => {
    const qty = countMap[key];
    const name = zoneMeta.nameByKey[key] || key;
    return `${qty} [[${name}]]`;
  });
}

function buildEditedGuide(baseGuide, editState, deckGuideMeta) {
  const safeBase = baseGuide || {};
  return {
    ...safeBase,
    in: buildGuideZoneLines(editState?.inCounts, deckGuideMeta.sideboard),
    out: buildGuideZoneLines(editState?.outCounts, deckGuideMeta.mainboard),
  };
}

function buildSourceGuideUrl(bbSlug, deckSlug, opponentSlug) {
  const params = new URLSearchParams({
    bb: bbSlug,
    deck: deckSlug,
    opponent: opponentSlug,
  });
  return `/api/source-guide?${params.toString()}`;
}

function buildSourcePrimerUrl(bbSlug, deckSlug) {
  const params = new URLSearchParams({
    bb: bbSlug,
    deck: deckSlug,
  });
  return `/api/source-primer?${params.toString()}`;
}

async function saveSourceGuide(bbSlug, deckSlug, opponentSlug, raw) {
  const res = await fetch(buildSourceGuideUrl(bbSlug, deckSlug, opponentSlug), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `Failed to save guide source (${res.status})`);
  }
  return res.json();
}

async function fetchSourcePrimer(bbSlug, deckSlug) {
  const res = await fetch(buildSourcePrimerUrl(bbSlug, deckSlug), {
    method: 'GET',
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `Failed to load primer source (${res.status})`);
  }
  return res.json();
}

async function saveSourcePrimer(bbSlug, deckSlug, raw) {
  const res = await fetch(buildSourcePrimerUrl(bbSlug, deckSlug), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `Failed to save primer source (${res.status})`);
  }
  return res.json();
}

function buildPrimerDraftKey(bbSlug, deckSlug) {
  return `${bbSlug}/${deckSlug}::primer`;
}

async function openSourceTextEditor({ draftKey, title, fallbackRaw, loadRaw, saveRaw }) {
  let sourceRaw = sourceEditorDrafts.has(draftKey) ? sourceEditorDrafts.get(draftKey) : fallbackRaw;
  let loadWarning = '';

  if (!sourceEditorDrafts.has(draftKey)) {
    try {
      sourceRaw = await loadRaw();
    } catch (err) {
      loadWarning = err && err.message ? err.message : 'Source load failed; using in-memory projection.';
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'guide-editor-overlay';
  overlay.innerHTML = `
    <div class="guide-editor-modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="guide-editor-head">${title}</div>
      <textarea class="guide-editor-textarea" spellcheck="false"></textarea>
      <div class="guide-editor-actions">
        <button type="button" class="action-button button-standard guide-editor-cancel">Cancel</button>
        <button type="button" class="action-button button-standard guide-editor-save">Save</button>
      </div>
      <div class="guide-editor-status" aria-live="polite"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const textarea = overlay.querySelector('.guide-editor-textarea');
  const saveBtn = overlay.querySelector('.guide-editor-save');
  const cancelBtn = overlay.querySelector('.guide-editor-cancel');
  const statusEl = overlay.querySelector('.guide-editor-status');
  textarea.value = sourceRaw;
  textarea.addEventListener('input', () => {
    sourceEditorDrafts.set(draftKey, textarea.value);
  });
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  if (loadWarning) {
    statusEl.textContent = loadWarning;
  }

  const close = (persistDraft = true) => {
    if (persistDraft) {
      sourceEditorDrafts.set(draftKey, textarea.value);
    }
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
  };

  const onKeydown = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKeydown);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  cancelBtn.addEventListener('click', close);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    statusEl.textContent = 'Saving...';
    try {
      await saveRaw(textarea.value);
      statusEl.textContent = 'Saved. Refreshing...';
      await clearBrowserCaches();
      window.location.reload();
    } catch (err) {
      statusEl.textContent = err && err.message ? err.message : 'Save failed.';
      saveBtn.disabled = false;
    }
  });
}

async function clearBrowserCaches() {
  if (!('caches' in window) || !window.caches || !window.caches.keys) {
    return;
  }
  try {
    const keys = await window.caches.keys();
    await Promise.all(keys.map((key) => window.caches.delete(key)));
  } catch (_) {
    // Best effort only; page reload still refreshes runtime state.
  }
}

function hideQrPopup() {
  if (!qrUi.overlay) return;
  qrUi.overlay.hidden = true;
}

function showQrPopup() {
  if (!qrUi.overlay || !qrUi.canvas) return;
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.delete('tab');
  qrUi.canvas.innerHTML = '';
  if (window.QRCode) {
    // eslint-disable-next-line no-new
    new window.QRCode(qrUi.canvas, {
      text: currentUrl.toString(),
      width: 224,
      height: 224,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  } else {
    qrUi.canvas.innerHTML = '<div class="qr-popup-fallback">QR unavailable</div>';
  }
  qrUi.overlay.hidden = false;
}

function ensureQrOverlay() {
  if (qrUi.overlay) return;

  const overlay = document.createElement('div');
  overlay.className = 'qr-popup-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="qr-popup-canvas" id="qr-popup-canvas" role="dialog" aria-modal="true" aria-label="Page QR code"></div>
  `;

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) hideQrPopup();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideQrPopup();
  });

  document.body.appendChild(overlay);

  qrUi.overlay = overlay;
  qrUi.canvas = overlay.querySelector('#qr-popup-canvas');
}

function bindBreadcrumbQrButton(container) {
  const scope = container || ui.header || app;
  const button = scope.querySelector('.qr-breadcrumb-button');
  if (!button) return;
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await clearBrowserCaches();
    showQrPopup();
  });
}

function applyActiveTab(tab) {
  if (!ui.battleboxPane || !ui.lifePane || !ui.draftPane || !ui.matrixPane || !ui.comboPane || !ui.footer) return;
  const nextTab = normalizeTab(tab);
  ui.activeTab = nextTab;
  ui.battleboxPane.hidden = nextTab !== TAB_BATTLEBOX;
  ui.lifePane.hidden = nextTab !== TAB_LIFE;
  ui.draftPane.hidden = nextTab !== TAB_DRAFT;
  ui.matrixPane.hidden = nextTab !== TAB_MATRIX;
  ui.comboPane.hidden = nextTab !== TAB_COMBO;
  if (nextTab !== TAB_BATTLEBOX) {
    preview.hidePreview();
    sampleHand.hide();
  }
  ui.footer.querySelectorAll('.tabbar-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === nextTab);
  });
}

function refreshAuxTabContent(tab) {
  const nextTab = normalizeTab(tab);
  if (nextTab === TAB_DRAFT) {
    void (async () => {
      await hydrateDraftRoomFromSearch();
      await lobbyController.render();
    })();
  } else if (nextTab === TAB_MATRIX) {
    void (async () => {
      if (!matrixRouteContext.enabled) {
        await matrixController.render(null, matrixRouteContext.battleboxSlug, '', '');
        return;
      }
      await matrixController.render(
        matrixRouteContext.battlebox,
        matrixRouteContext.battleboxSlug,
        matrixRouteContext.selectedDeckSlug,
        matrixRouteContext.selectedMatchupSlug,
      );
      matrixController.maybeAutoScrollHighlightedCell();
    })();
  } else if (nextTab === TAB_COMBO) {
    renderComboPane();
  }
}

function setActiveTab(tab) {
  const requestedTab = normalizeTab(tab);
  let nextTab = requestedTab;
  if (ui.footer) {
    const button = ui.footer.querySelector(`.tabbar-button[data-tab="${requestedTab}"]`);
    if (button && button.disabled) {
      nextTab = TAB_BATTLEBOX;
    }
  }
  applyActiveTab(nextTab);
  setTabInLocationSearch(nextTab);
  refreshAuxTabContent(nextTab);
}

function setTabEnabled(tab, enabled) {
  if (!ui.footer) return;
  const button = ui.footer.querySelector(`.tabbar-button[data-tab="${tab}"]`);
  if (!button) return;
  button.disabled = !enabled;
  button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  if (!enabled && ui.activeTab === tab) {
    setActiveTab(TAB_BATTLEBOX);
  }
}

function ensureShell() {
  if (ui.shell) return;
  const shell = document.createElement('div');
  shell.className = 'view-shell';
  const header = document.createElement('div');
  header.className = 'view-header';
  const body = document.createElement('div');
  body.className = 'view-body';
  body.id = 'view-body';
  const battleboxPane = document.createElement('div');
  battleboxPane.className = 'tab-pane tab-pane-battlebox';
  battleboxPane.id = 'tab-battlebox';
  const lifePane = document.createElement('div');
  lifePane.className = 'tab-pane tab-pane-life';
  lifePane.id = 'tab-life';
  createLifeCounter(lifePane);
  const draftPane = document.createElement('div');
  draftPane.className = 'tab-pane tab-pane-draft';
  draftPane.id = 'tab-draft';
  const matrixPane = document.createElement('div');
  matrixPane.className = 'tab-pane tab-pane-matrix';
  matrixPane.id = 'tab-matrix';
  const comboPane = document.createElement('div');
  comboPane.className = 'tab-pane tab-pane-combo';
  comboPane.id = 'tab-combo';
  const footer = document.createElement('div');
  footer.className = 'view-footer';
  footer.innerHTML = `
    <div class="tabbar">
      <button type="button" class="action-button tabbar-button" data-tab="life" aria-label="Life tab">❤️‍🩹</button>
      <button type="button" class="action-button tabbar-button" data-tab="draft" aria-label="Draft tab">🏟️</button>
      <button type="button" class="action-button tabbar-button" data-tab="battlebox" aria-label="Deck tab">📚</button>
      <button type="button" class="action-button tabbar-button" data-tab="combo" aria-label="Combo tab">🧪</button>
      <button type="button" class="action-button tabbar-button" data-tab="matrix" aria-label="Winrate matrix tab">📊</button>
    </div>
  `;

  footer.addEventListener('click', (event) => {
    const button = event.target.closest('.tabbar-button');
    if (!button) return;
    const requestedTab = normalizeTab(button.dataset.tab);
    if (requestedTab === ui.activeTab) return;
    setActiveTab(requestedTab);
  });

  body.appendChild(battleboxPane);
  body.appendChild(lifePane);
  body.appendChild(draftPane);
  body.appendChild(matrixPane);
  body.appendChild(comboPane);
  shell.appendChild(header);
  shell.appendChild(body);
  shell.appendChild(footer);
  app.replaceChildren(shell);

  ui.shell = shell;
  ui.header = header;
  ui.body = body;
  ui.footer = footer;
  ui.battleboxPane = battleboxPane;
  ui.lifePane = lifePane;
  ui.draftPane = draftPane;
  ui.matrixPane = matrixPane;
  ui.comboPane = comboPane;
}

function renderBattleboxPane(headerHtml, bodyHtml) {
  ensureShell();
  ui.header.innerHTML = headerHtml;
  ui.battleboxPane.innerHTML = bodyHtml;
  bindBreadcrumbQrButton(ui.header);
}

function withCacheBust(path) {
  const version = data.buildId || runtimeCacheBust;
  if (!version) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}v=${encodeURIComponent(version)}`;
}

function toGzipPath(path) {
  const q = path.indexOf('?');
  if (q === -1) return `${path}.gz`;
  return `${path.slice(0, q)}.gz${path.slice(q)}`;
}

async function fetchJsonData(path, fetchOptions) {
  const res = await fetch(path, fetchOptions);
  if (!res.ok) return null;
  return res.json();
}

async function fetchJsonDataGzipOnly(path, fetchOptions) {
  if (!window.DecompressionStream) return null;
  try {
    const gzRes = await fetch(toGzipPath(path), fetchOptions);
    if (!gzRes.ok || !gzRes.body) return null;
    const ds = new DecompressionStream('gzip');
    const decoded = gzRes.body.pipeThrough(ds);
    const text = await new Response(decoded).text();
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function loadBattlebox(bbSlug) {
  if (data.battleboxes[bbSlug]) return data.battleboxes[bbSlug];
  const bb = await fetchJsonData(withCacheBust(`/data/${bbSlug}.json`));
  if (!bb) return null;
  data.battleboxes[bbSlug] = bb;
  return bb;
}

async function loadWinrateMatrix(bbSlug) {
  if (!bbSlug) return null;
  if (Object.prototype.hasOwnProperty.call(data.matrices, bbSlug)) {
    return data.matrices[bbSlug];
  }
  const matrix = await fetchJsonDataGzipOnly(withCacheBust(`/data/${bbSlug}/winrate.json`));
  data.matrices[bbSlug] = matrix || null;
  return data.matrices[bbSlug];
}

function normalizeComboDeckFilter(filterSlug, battleboxData) {
  const normalized = normalizeName(filterSlug || '');
  if (!normalized) return '';
  const decks = Array.isArray(battleboxData?.decks) ? battleboxData.decks : [];
  return decks.some((deck) => normalizeName(deck?.slug) === normalized) ? normalized : '';
}

function buildComboDeckNameMap(battleboxData) {
  const bySlug = new Map();
  const decks = Array.isArray(battleboxData?.decks) ? battleboxData.decks : [];
  decks.forEach((deck) => {
    const slug = normalizeName(deck?.slug || '');
    if (!slug) return;
    bySlug.set(slug, String(deck?.name || slug));
  });
  return bySlug;
}

function buildComboDeckCardNameSetForSlug(battleboxData, selectedSlug) {
  const slug = normalizeName(selectedSlug || '');
  if (!slug) return null;
  const decks = Array.isArray(battleboxData?.decks) ? battleboxData.decks : [];
  const deck = decks.find((entry) => normalizeName(entry?.slug || '') === slug);
  if (!deck) return null;
  const names = new Set();
  const mainCards = Array.isArray(deck?.cards) ? deck.cards : [];
  const sideboardCards = Array.isArray(deck?.sideboard) ? deck.sideboard : [];
  mainCards.forEach((card) => {
    const key = normalizeName(card?.name || '');
    if (key) names.add(key);
  });
  sideboardCards.forEach((card) => {
    const key = normalizeName(card?.name || '');
    if (key) names.add(key);
  });
  return names;
}

function escapeAttr(value) {
  return escapeHtml(value)
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderComboPieceGroups(comboCards, selectedDeckCardNames) {
  const groups = Array.isArray(comboCards) ? comboCards : [];
  return groups.map((group, groupIdx) => {
    const rawOptions = Array.isArray(group) ? group : [];
    const options = selectedDeckCardNames
      ? rawOptions.filter((option) => selectedDeckCardNames.has(normalizeName(option?.name || '')))
      : rawOptions;
    const optionsHtml = options.map((option) => {
      const name = String(option?.name || '').trim();
      const printing = String(option?.printing || '').trim();
      const imageUrl = printing ? scryfallImageUrlByPrinting(printing, 'front') : '';
      if (!imageUrl) {
        return `<span class="combo-piece-card combo-piece-card-missing">${escapeHtml(name)}</span>`;
      }
      return `
        <button
          type="button"
          class="combo-piece-card combo-piece-card-image deck-basics-card card card-ref"
          data-name="${escapeAttr(name)}"
          data-printing="${escapeAttr(printing)}"
          aria-label="${escapeAttr(name)}"
        >
          <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(name)}" loading="lazy" decoding="async">
        </button>
      `;
    }).join('');
    const plus = groupIdx > 0 ? '<span class="combo-group-plus">+</span>' : '';
    return `${plus}<span class="combo-piece-group">${optionsHtml}</span>`;
  }).join('');
}

function renderComboPane() {
  if (!ui.comboPane) return;

  const battleboxData = comboRouteContext.battleboxData;
  if (!comboRouteContext.enabled || !battleboxData) {
    ui.comboPane.innerHTML = '<div class="aux-empty">No combos for this battlebox.</div>';
    return;
  }

  const combos = Array.isArray(battleboxData.combos) ? battleboxData.combos.slice() : [];
  const deckNameBySlug = buildComboDeckNameMap(battleboxData);
  const selectedFilter = normalizeComboDeckFilter(comboRouteContext.selectedDeckSlug, battleboxData);
  const selectedDeckCardNames = buildComboDeckCardNameSetForSlug(battleboxData, selectedFilter);

  combos.sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
  const filtered = combos.filter((combo) => {
    if (!selectedFilter) return true;
    const comboDecks = Array.isArray(combo?.decks) ? combo.decks : [];
    return comboDecks.some((slug) => normalizeName(slug) === selectedFilter);
  });

  const cardsHtml = filtered.length ? filtered.map((combo) => {
    const comboID = String(combo?.id || '').trim();
    const comboText = String(combo?.text || '').trim();
    const comboTypes = (Array.isArray(combo?.types) ? combo.types : [])
      .map((value) => normalizeName(value))
      .filter((value, idx, values) => (value === 'engine' || value === 'finisher' || value === 'value') && values.indexOf(value) === idx);
    const comboDecks = (Array.isArray(combo?.decks) ? combo.decks : [])
      .map((slug) => normalizeName(slug))
      .filter((slug) => slug && deckNameBySlug.has(slug))
      .sort((a, b) => deckNameBySlug.get(a).localeCompare(deckNameBySlug.get(b)));
    const badgesHtml = comboDecks.length
      ? comboDecks.map((slug) => `<span class="combo-deck-badge">${escapeHtml(deckNameBySlug.get(slug))}</span>`).join('')
      : '<span class="combo-deck-badge combo-deck-badge-empty">No matching decks</span>';

    const pieceGroupsHtml = renderComboPieceGroups(combo?.cards, selectedDeckCardNames);
    const typeTagsHtml = comboTypes.length
      ? `<span class="combo-type-tags">${comboTypes.map((type) => `<span class="combo-type-tag">${escapeHtml(type)}</span>`).join('')}</span>`
      : '';
    const openAttr = selectedFilter ? ' open' : '';
    return `
      <details class="combo-card"${openAttr}>
        <summary class="combo-card-summary">
          <span class="combo-card-title">${escapeHtml(comboID)}</span>
          ${typeTagsHtml}
        </summary>
        <div class="combo-card-body">
          ${selectedFilter ? '' : `<div class="combo-deck-badges">${badgesHtml}</div>`}
          ${comboText ? `<div class="combo-explainer">${escapeHtml(comboText)}</div>` : ''}
          <div class="combo-piece-line-scroll">
            <div class="combo-piece-line">${pieceGroupsHtml}</div>
          </div>
        </div>
      </details>
    `;
  }).join('') : '<div class="aux-empty">No combos match this deck filter.</div>';

  ui.comboPane.innerHTML = `
    <div class="combo-panel">
      <div class="combo-header-row">
        <div class="panel-title combo-library-header">Combo Library</div>
      </div>
      <div class="combo-list">${cardsHtml}</div>
    </div>
  `;
}

async function route() {
  preview.hidePreview();
  sampleHand.hide();
  const {
    parts,
    sortMode,
    sortDirection,
    matchupSlug,
    collapsedMask,
    applySideboard,
  } = parseHashRoute(location.hash.slice(1) || '/');
  const currentBattleboxSlug = parts.length > 0 ? normalizeName(parts[0]) : '';
  const currentDeckSlug = parts.length === 2 ? normalizeName(parts[1]) : '';
  const currentBattlebox = parts.length > 0
    ? data.index.battleboxes.find((b) => b.slug === currentBattleboxSlug)
    : null;
  const isCubeContext = currentBattleboxSlug === 'cube';
  const matrixTabEnabled = Boolean(currentBattlebox && currentBattlebox.matrix_tab_enabled !== false);
  const currentBattleboxData = (parts.length > 0 && !isCubeContext)
    ? await loadBattlebox(currentBattleboxSlug)
    : null;
  const comboTabEnabled = Boolean(
    !isCubeContext
    && currentBattleboxData
    && Array.isArray(currentBattleboxData.combos)
    && currentBattleboxData.combos.length > 0
  );

  if (parts.length === 0) {
    renderHome();
  } else if (parts.length === 1) {
    renderBattlebox(parts[0], sortMode, sortDirection);
  } else if (parts.length === 2) {
    await renderDeck(
      parts[0],
      parts[1],
      matchupSlug || undefined,
      sortMode,
      sortDirection,
      collapsedMask,
      applySideboard
    );
  } else {
    renderNotFound();
  }

  if (isCubeContext) {
    lobbyController.setPreferredDeckSlug(currentDeckSlug);
    matrixRouteContext.battlebox = null;
    matrixRouteContext.battleboxSlug = currentBattleboxSlug;
    matrixRouteContext.selectedDeckSlug = '';
    matrixRouteContext.selectedMatchupSlug = '';
    matrixRouteContext.enabled = false;
    comboRouteContext.battleboxData = null;
    comboRouteContext.battleboxSlug = currentBattleboxSlug;
    comboRouteContext.selectedDeckSlug = '';
    comboRouteContext.enabled = false;
    setTabEnabled(TAB_MATRIX, false);
    setTabEnabled(TAB_COMBO, false);
  } else {
    lobbyController.setPreferredDeckSlug('');
    matrixRouteContext.battlebox = currentBattlebox;
    matrixRouteContext.battleboxSlug = currentBattleboxSlug;
    matrixRouteContext.selectedDeckSlug = currentDeckSlug;
    matrixRouteContext.selectedMatchupSlug = matchupSlug;
    matrixRouteContext.enabled = matrixTabEnabled;
    const normalizedDeckSlug = normalizeName(currentDeckSlug || '');
    comboRouteContext.battleboxData = currentBattleboxData;
    comboRouteContext.battleboxSlug = currentBattleboxSlug;
    comboRouteContext.selectedDeckSlug = normalizedDeckSlug;
    comboRouteContext.enabled = comboTabEnabled;
    setTabEnabled(TAB_MATRIX, matrixTabEnabled);
    setTabEnabled(TAB_COMBO, comboTabEnabled);
  }

  if (ui.battleboxPane) {
    ui.battleboxPane.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }
}

async function safeRoute() {
  try {
    await route();
  } catch (err) {
    const message = err && err.message ? err.message : String(err || 'unknown error');
    console.error('route failed:', err);
    renderBattleboxPane('', `
      <div class="loading">Something went wrong while rendering this page.</div>
      <pre class="guide-source">${message}</pre>
    `);
  }
}

function renderHome() {
  const headerHtml = `
    <h1 class="breadcrumbs">
      <span class="breadcrumbs-trail">Battlebox</span>
      <button type="button" class="qr-breadcrumb-button" title="Show QR code" aria-label="Show QR code for this page">
        <img class="qr-breadcrumb-icon" src="/assets/qrcode.svg" alt="">
      </button>
    </h1>
  `;
  const bodyHtml = `
    <ul class="deck-list">
      ${data.index.battleboxes.map((bb) => {
        const countLabel = String(bb.deck_count_label || '').trim() || 'decks';
        return `
        <li>
          <a href="#/${bb.slug}" class="battlebox-link">
            <div class="battlebox-title">
              <span>${bb.name || capitalize(bb.slug)}</span>
              <span class="colors">${bb.decks.length} ${countLabel}</span>
            </div>
            ${bb.description ? `<div class="battlebox-desc">${bb.description}</div>` : ''}
          </a>
        </li>
      `;
      }).join('')}
    </ul>
  `;
  renderBattleboxPane(headerHtml, bodyHtml);
}

function renderBattlebox(bbSlug, initialSortMode, initialSortDirection) {
  const bb = data.index.battleboxes.find(b => b.slug === bbSlug);
  if (!bb) return renderNotFound();
  const initialSort = normalizeSortMode(initialSortMode);
  const initialDirection = normalizeSortDirection(initialSortDirection);
  const typeSortIcon = String(bb.type_sort_icon || '').trim() || '🧬';

  const headerHtml = `
    <h1 class="breadcrumbs">
      <span class="breadcrumbs-trail">
        <a href="#/">Battlebox</a>
        <span class="crumb-sep">/</span>
        <span>${capitalize(bb.slug)}</span>
      </span>
      <button type="button" class="qr-breadcrumb-button" title="Show QR code" aria-label="Show QR code for this page">
        <img class="qr-breadcrumb-icon" src="/assets/qrcode.svg" alt="">
      </button>
    </h1>
  `;
  const bodyHtml = `
    <div class="randomizer-controls">
      <div class="randomizer-roll-controls">
        <button type="button" class="randomizer-roll action-button" data-count="1" title="Roll 1 deck" aria-label="Roll 1 deck">🎲</button>
        <button type="button" class="randomizer-roll action-button" data-count="2" title="Roll 2 decks" aria-label="Roll 2 decks">🎲🎲</button>
      </div>
      <div class="randomizer-sort-controls" role="group" aria-label="Sort decks">
        <button type="button" class="randomizer-sort action-button" data-sort="name" title="Sort by name" aria-label="Sort by name">🔤</button>
        <button type="button" class="randomizer-sort action-button" data-sort="types" title="Sort by types" aria-label="Sort by types">${typeSortIcon}</button>
        <button type="button" class="randomizer-sort action-button" data-sort="difficulty" title="Sort by difficulty" aria-label="Sort by difficulty">🧠</button>
      </div>
    </div>
    <ul class="deck-list">
      ${bb.decks.map(d => {
        const deckUI = resolveDeckUI(d);
        return `
          <li class="deck-item" data-slug="${d.slug}"><a class="deck-link" href="${buildDeckHash(bb.slug, d.slug, initialSort, initialDirection, undefined, 4)}">
            <span class="deck-link-name">${d.icon ? `<span class="deck-link-icon">${d.icon}</span>` : ''}${d.name}</span>
            <div class="deck-link-tags">${renderDeckSelectionTags(d.tags, d.difficulty_tags)}</div>
            <span class="colors">${renderDeckBadge(d, deckUI.deck_selection_badge)}</span>
          </a></li>
        `;
      }).join('')}
    </ul>
  `;
  renderBattleboxPane(headerHtml, bodyHtml);

  const deckList = ui.battleboxPane.querySelector('.deck-list');
  const difficultyOrder = {
    beginner: 0,
    intermediate: 1,
    expert: 2,
  };
  const resolveDifficultyRank = (tags) => {
    const sorted = sortDifficultyTags(tags).map(normalizeName);
    for (const tag of sorted) {
      if (Object.prototype.hasOwnProperty.call(difficultyOrder, tag)) {
        return difficultyOrder[tag];
      }
    }
    return Number.MAX_SAFE_INTEGER;
  };
  const deckBySlug = new Map(
    [...deckList.querySelectorAll('.deck-item')].map(item => [item.dataset.slug, item.querySelector('.deck-link')])
  );
  const deckMetaBySlug = new Map(
    bb.decks.map(deck => [deck.slug, {
      nameKey: normalizeName(deck.name || deck.slug),
      typeRankKey: sortArchetypeTags(deck.tags).map(archetypeTagRank),
      difficultyRank: resolveDifficultyRank(deck.difficulty_tags),
    }])
  );
  const rollButtons = [...ui.battleboxPane.querySelectorAll('.randomizer-roll')];
  const sortButtons = [...ui.battleboxPane.querySelectorAll('.randomizer-sort')];
  const typesSortButton = sortButtons.find((btn) => btn.dataset.sort === 'types');
  const randomRollEnabled = bb.random_roll_enabled !== false;
  const doubleRandomRollDisabled = bb.disable_double_random_roll === true;
  const typeSortDisabled = bb.disable_type_sort === true;
  let sortMode = null;
  let sortDirection = initialDirection;

  if (!randomRollEnabled) {
    rollButtons.forEach(btn => {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    });
  } else if (doubleRandomRollDisabled) {
    rollButtons.forEach(btn => {
      if (Number(btn.dataset.count) !== 2) return;
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    });
  }
  if (typeSortDisabled && typesSortButton) {
    typesSortButton.disabled = true;
    typesSortButton.setAttribute('aria-disabled', 'true');
  }

  const updateBattleboxHash = () => {
    const nextHash = buildBattleboxHash(bb.slug, sortMode, sortDirection);
    if (location.hash !== nextHash) {
      replaceHashPreserveSearch(nextHash);
    }
  };

  const updateDeckLinks = () => {
    deckBySlug.forEach((link, slug) => {
      if (!link) return;
      link.href = buildDeckHash(bb.slug, slug, sortMode, sortDirection, undefined, 4);
    });
  };

  const compareTypeRankKey = (a, b) => {
    const maxLen = Math.max(a.length, b.length);
    for (let idx = 0; idx < maxLen; idx++) {
      const av = Number.isFinite(a[idx]) ? a[idx] : Number.MAX_SAFE_INTEGER;
      const bv = Number.isFinite(b[idx]) ? b[idx] : Number.MAX_SAFE_INTEGER;
      if (av !== bv) return av - bv;
    }
    return 0;
  };

  const compareDeckItems = (a, b, mode, direction) => {
    const metaA = deckMetaBySlug.get(a.dataset.slug) || {
      nameKey: normalizeName(a.dataset.slug || ''),
      typeRankKey: [],
      difficultyRank: Number.MAX_SAFE_INTEGER,
    };
    const metaB = deckMetaBySlug.get(b.dataset.slug) || {
      nameKey: normalizeName(b.dataset.slug || ''),
      typeRankKey: [],
      difficultyRank: Number.MAX_SAFE_INTEGER,
    };
    const nameCmp = metaA.nameKey.localeCompare(metaB.nameKey);
    const descending = direction === 'desc';
    if (mode === 'types') {
      const typeCmp = compareTypeRankKey(metaA.typeRankKey, metaB.typeRankKey);
      if (typeCmp !== 0) return descending ? -typeCmp : typeCmp;
      return nameCmp;
    }
    if (mode === 'difficulty') {
      const diffCmp = metaA.difficultyRank - metaB.difficultyRank;
      if (diffCmp !== 0) return descending ? -diffCmp : diffCmp;
      return nameCmp;
    }
    return descending ? -nameCmp : nameCmp;
  };

  const applySort = (mode, isInitial = false) => {
    let nextMode = normalizeSortMode(mode);
    if (nextMode === 'types' && typeSortDisabled) {
      nextMode = 'name';
    }
    if (!isInitial && nextMode === sortMode) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortMode = nextMode;
      if (!isInitial) {
        sortDirection = 'asc';
      }
    }
    const items = [...deckList.querySelectorAll('.deck-item')];
    items.sort((a, b) => compareDeckItems(a, b, sortMode, sortDirection));
    items.forEach(item => deckList.appendChild(item));
    sortButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sort === sortMode);
    });
    updateDeckLinks();
    updateBattleboxHash();
  };

  const clearHighlights = () => {
    ui.battleboxPane.querySelectorAll('.deck-link.deck-highlight').forEach(link => link.classList.remove('deck-highlight'));
  };

  const applyRandomMatchupLinks = (pickedSlugs) => {
    updateDeckLinks();
    if (pickedSlugs.length !== 2) return;
    const [deckA, deckB] = pickedSlugs;
    const linkA = deckBySlug.get(deckA);
    const linkB = deckBySlug.get(deckB);
    if (linkA) {
      linkA.href = buildDeckHash(bb.slug, deckA, sortMode, sortDirection, deckB, 4);
    }
    if (linkB) {
      linkB.href = buildDeckHash(bb.slug, deckB, sortMode, sortDirection, deckA, 4);
    }
  };

  const setActiveRollButton = (count) => {
    rollButtons.forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.count) === count);
    });
  };

  const roll = (count) => {
    const deckItems = [...deckList.querySelectorAll('.deck-item')];
    if (deckItems.length === 0) return;
    clearHighlights();
    const target = Math.min(count, deckItems.length);
    const picked = new Set();
    while (picked.size < target) {
      const idx = Math.floor(Math.random() * deckItems.length);
      const slug = deckItems[idx].dataset.slug;
      picked.add(slug);
    }
    applyRandomMatchupLinks([...picked]);
    picked.forEach(slug => {
      const link = deckBySlug.get(slug);
      if (link) link.classList.add('deck-highlight');
    });

    let scrollLink = null;
    for (let idx = deckItems.length - 1; idx >= 0; idx--) {
      const item = deckItems[idx];
      if (picked.has(item.dataset.slug)) {
        scrollLink = item.querySelector('.deck-link');
        break;
      }
    }
    if (scrollLink) {
      scrollLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  if (randomRollEnabled) {
    rollButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const count = Number(btn.dataset.count);
        setActiveRollButton(count);
        roll(count);
      });
    });
  }
  sortButtons.forEach(btn => {
    btn.addEventListener('click', () => applySort(btn.dataset.sort));
  });
  applySort(initialSort, true);
}

async function renderDeck(bbSlug, deckSlug, selectedGuide, sortMode, sortDirection, collapsedMask, applySideboard) {
  const bb = await loadBattlebox(bbSlug);
  if (!bb) return renderNotFound();
  const deck = bb.decks.find(d => d.slug === deckSlug);
  if (!deck) return renderNotFound();
  const currentSortMode = normalizeSortMode(sortMode);
  const currentSortDirection = normalizeSortDirection(sortDirection);
  let currentCollapsedMask = normalizeCollapsedMask(collapsedMask);

  const deckPrintings = deck.printings || {};
  const deckDoubleFaced = buildDoubleFacedMap(deck);
  const deckGuideMeta = {
    mainboard: buildDeckZoneMeta(deck.cards),
    sideboard: buildDeckZoneMeta(deck.sideboard),
  };
  const deckUI = resolveDeckUI(deck);
  const mdSelf = createMarkdownRenderer([deckPrintings], [deckDoubleFaced]);
  const primerHtml = deck.primer ? mdSelf.render(deck.primer) : '<em>No primer yet</em>';
  const hasPrimerWarnings = Array.isArray(deck.primer_warnings) && deck.primer_warnings.length > 0;
  const bannedNames = Array.isArray(bb.banned) ? bb.banned : [];
  const bannedSet = new Set(bannedNames.map(normalizeName));
  const guideKeys = Object.keys(deck.guides || {});
  const initialGuide = guideKeys.length
    ? (selectedGuide && guideKeys.includes(selectedGuide) ? selectedGuide : guideKeys[0])
    : '';
  const hasExplicitMatchupInUrl = Boolean(selectedGuide && guideKeys.includes(selectedGuide));
  let currentMatchupSlug = initialGuide;
  let hasExplicitMatchupSelection = hasExplicitMatchupInUrl;
  let currentApplySideboard = guideKeys.length ? normalizeApplySideboard(applySideboard) : false;
  let guideEditState = null;
  const getCurrentGuideBase = (slug = currentMatchupSlug) => {
    if (!slug) return null;
    return deck.guides?.[slug] || { in: [], out: [], text: '', raw: '' };
  };
  const isGuideEditActive = () => Boolean(guideEditState && guideEditState.matchupSlug === currentMatchupSlug);
  const getRenderedGuideData = (slug = currentMatchupSlug) => {
    const baseGuide = getCurrentGuideBase(slug);
    if (!baseGuide) return null;
    if (!guideEditState || guideEditState.matchupSlug !== slug) return baseGuide;
    return buildEditedGuide(baseGuide, guideEditState, deckGuideMeta);
  };
  const discardGuideEditState = () => {
    guideEditState = null;
  };
  let deckView = computeDeckView(
    deck,
    getRenderedGuideData(currentMatchupSlug),
    currentApplySideboard
  );
  const guideOptions = guideKeys.map(k => {
    const opponent = bb.decks.find(d => d.slug === k);
    const name = opponent ? opponent.name : k;
    const guideWarnings = Array.isArray(deck.guides?.[k]?.warnings) ? deck.guides[k].warnings : [];
    const warningMark = guideWarnings.length ? ' \u26a0\ufe0f' : '';
    return `<option value="${k}">${name}${warningMark}</option>`;
  }).join('');

  const decklistView = deckUI.decklist_view;
  const renderDecklistGrid = (nextDeckView) => renderSharedDecklistGrid({
    viewMode: decklistView,
    deckView: nextDeckView,
    bannedSet,
  });
  const decklistOpenAttr = (currentCollapsedMask & 1) === 0 ? ' open' : '';
  const primerOpenAttr = (currentCollapsedMask & 2) === 0 ? ' open' : '';
  const matchupOpenAttr = currentCollapsedMask === 0 || (currentCollapsedMask & 4) === 0 ? ' open' : '';
  const matchupGuidesHtml = guideKeys.length ? `
    <details id="matchup-details" class="collapsible matchup-guides"${matchupOpenAttr}>
      <summary class="panel-title">Matchup Guides</summary>
      <div class="collapsible-body guide-panel">
        <div class="guide-controls">
          <div class="guide-select guide-select-main-row">
            <select id="guide-select" aria-label="Matchup guide">
              ${guideOptions}
            </select>
            <a class="guide-opponent-link action-button button-standard" id="guide-opponent-link" href="#">Go to</a>
            <button type="button" class="action-button button-standard apply-sideboard-button toggle-highlight-button${currentApplySideboard ? ' active' : ''}" id="apply-sideboard-button">
              Sideboard
            </button>
          </div>
          <div class="guide-select guide-select-edit-row">
            <button type="button" class="action-button button-standard guide-edit-button toggle-highlight-button" id="guide-edit-button">
              Edit
            </button>
          </div>
        </div>
        <div class="guide-box" id="guide-box"></div>
      </div>
    </details>
  ` : '';

  const headerHtml = `
    <h1 class="breadcrumbs">
      <span class="breadcrumbs-trail">
        <a href="#/">Battlebox</a>
        <span class="crumb-sep">/</span>
        <a href="${buildBattleboxHash(bb.slug, currentSortMode, currentSortDirection)}">${capitalize(bb.slug)}</a>
        <span class="crumb-sep">/</span>
        <span>${deck.name}</span>
      </span>
      <button type="button" class="qr-breadcrumb-button" title="Show QR code" aria-label="Show QR code for this page">
        <img class="qr-breadcrumb-icon" src="/assets/qrcode.svg" alt="">
      </button>
    </h1>
  `;
  const sampleButtonLabel = deckUI.sample.mode === 'pack' ? 'Sample Pack' : 'Sample Hand';
  const showSampleButton = deckUI.sample.mode !== 'none';
  const showDeckToolbar = showSampleButton;
  const showBasicsPane = deckUI.show_basics_pane === true;
  const basicsPaneHtml = showBasicsPane ? renderBasicsPane(deckPrintings) : '';
  const bodyHtml = `
    <div class="deck-info-pane">
      <div class="deck-colors">${renderDeckBadge(deck, deckUI.deck_info_badge)}</div>
      <div class="deck-tags">${renderDeckTags(deck.tags)}${renderDifficultyTags(deck.difficulty_tags)}</div>
    </div>

    ${matchupGuidesHtml}

    <details id="decklist-details" class="collapsible"${decklistOpenAttr}>
      <summary class="panel-title">Decklist</summary>
      <div class="collapsible-body">
        <div id="decklist-body">
          ${renderDecklistGrid(deckView)}
        </div>
        ${showDeckToolbar ? `
          <div class="decklist-toolbar">
            ${showSampleButton ? `<button type="button" class="action-button button-standard sample-hand-open-button" id="sample-hand-open-button">${sampleButtonLabel}</button>` : ''}
          </div>
        ` : ''}
      </div>
    </details>

    ${basicsPaneHtml}

    <details id="primer-details" class="collapsible"${primerOpenAttr}>
      <summary class="panel-title">Primer${hasPrimerWarnings ? ' \u26a0\ufe0f' : ''}</summary>
      <div class="collapsible-body">
        <div class="primer-controls">
          <button type="button" class="action-button button-standard primer-edit-button" id="primer-edit-button">
            Edit
          </button>
        </div>
        <div class="primer">${primerHtml}</div>
      </div>
    </details>
  `;
  renderBattleboxPane(headerHtml, bodyHtml);

  const decklistDetails = ui.battleboxPane.querySelector('#decklist-details');
  const primerDetails = ui.battleboxPane.querySelector('#primer-details');
  const matchupDetails = ui.battleboxPane.querySelector('#matchup-details');
  const decklistBody = ui.battleboxPane.querySelector('#decklist-body');
  const sampleHandButton = ui.battleboxPane.querySelector('#sample-hand-open-button');
  const primerEditButton = ui.battleboxPane.querySelector('#primer-edit-button');

  const computeCollapsedMask = () => {
    let mask = 0;
    if (decklistDetails && !decklistDetails.open) mask |= 1;
    if (primerDetails && !primerDetails.open) mask |= 2;
    if (matchupDetails && !matchupDetails.open) mask |= 4;
    return mask;
  };
  const bindCollapseSync = (detailsList, onToggle) => {
    const syncCollapsedAndUrl = () => {
      currentCollapsedMask = computeCollapsedMask();
      if (typeof onToggle === 'function') onToggle();
      updateDeckHashFromState();
    };
    detailsList.forEach((details) => {
      if (!details) return;
      details.addEventListener('toggle', syncCollapsedAndUrl);
    });
  };

  const updateDeckHashFromState = () => {
    const matchupForUrl = hasExplicitMatchupSelection ? (currentMatchupSlug || undefined) : undefined;
    const nextHash = buildDeckHash(
      bb.slug,
      deck.slug,
      currentSortMode,
      currentSortDirection,
      matchupForUrl,
      currentCollapsedMask,
      currentApplySideboard
    );
    if (location.hash !== nextHash) {
      replaceHashPreserveSearch(nextHash);
    }
    matrixRouteContext.battlebox = bb;
    matrixRouteContext.battleboxSlug = bb.slug;
    matrixRouteContext.selectedDeckSlug = deck.slug;
    matrixRouteContext.selectedMatchupSlug = matchupForUrl || '';
    matrixRouteContext.enabled = bb.matrix_tab_enabled !== false;
    if (ui.activeTab === TAB_MATRIX && matrixRouteContext.enabled) {
      void matrixController.render(
        matrixRouteContext.battlebox,
        matrixRouteContext.battleboxSlug,
        matrixRouteContext.selectedDeckSlug,
        matrixRouteContext.selectedMatchupSlug,
      );
    }
  };

  const buildSampleHandKey = () => {
    const matchupKey = currentApplySideboard ? (currentMatchupSlug || '') : '';
    return `${bb.slug}/${deck.slug}|sb=${currentApplySideboard ? '1' : '0'}|m=${matchupKey}|sample=${deckUI.sample.mode}:${deckUI.sample.size}:${deckUI.sample.allow_draw ? '1' : '0'}`;
  };

  const syncSampleHandContext = () => {
    if (deckUI.sample.mode === 'none') return;
    sampleHand.setDeckContext(buildSampleHandKey(), deckView.mainCards, {
      initialDrawCount: deckUI.sample.size,
      allowDraw: deckUI.sample.allow_draw,
    });
  };

  const renderDecklistBody = () => {
    if (!decklistBody) return;
    const guideData = getRenderedGuideData(currentMatchupSlug);
    deckView = computeDeckView(deck, guideData, currentApplySideboard);
    decklistBody.innerHTML = renderDecklistGrid(deckView);
    decklistBody.classList.toggle('decklist-edit-mode', isGuideEditActive());
    syncSampleHandContext();
  };

  if (guideKeys.length) {
    const select = ui.battleboxPane.querySelector('#guide-select');
    const guideBox = ui.battleboxPane.querySelector('#guide-box');
    const opponentLink = ui.battleboxPane.querySelector('#guide-opponent-link');
    const applyButton = ui.battleboxPane.querySelector('#apply-sideboard-button');
    const editButton = ui.battleboxPane.querySelector('#guide-edit-button');
    const updateOpponentLink = (key) => {
      if (!opponentLink) return;
      const opponent = bb.decks.find(d => d.slug === key);
      const opponentHasGuide = opponent
        && opponent.guides
        && Object.prototype.hasOwnProperty.call(opponent.guides, deck.slug);
      opponentLink.href = opponentHasGuide
        ? buildDeckHash(bb.slug, key, currentSortMode, currentSortDirection, deck.slug, 0, false)
        : buildDeckHash(bb.slug, key, currentSortMode, currentSortDirection, undefined, 0, false);
      opponentLink.textContent = 'Go to';
    };
    const syncApplyButton = () => {
      if (!applyButton) return;
      applyButton.classList.toggle('active', currentApplySideboard);
      applyButton.textContent = 'Sideboard';
    };
    const syncGuideEditUi = () => {
      const active = isGuideEditActive();
      if (editButton) {
        editButton.classList.toggle('active', active);
        editButton.setAttribute('aria-pressed', active ? 'true' : 'false');
        editButton.textContent = active ? 'Done' : 'Edit';
      }
      if (decklistBody) {
        decklistBody.classList.toggle('decklist-edit-mode', active);
      }
    };
    const renderGuide = (key) => {
      const guideData = getRenderedGuideData(key) || '';
      const opponent = bb.decks.find(d => d.slug === key);
      const opponentPrintings = opponent ? opponent.printings || {} : {};
      const opponentDoubleFaced = opponent ? buildDoubleFacedMap(opponent) : {};
      const mdProse = createMarkdownRenderer(
        [opponentPrintings, deckPrintings],
        [opponentDoubleFaced, deckDoubleFaced]
      );
      guideBox.innerHTML = renderGuideContent(mdSelf, mdProse, guideData, {
        editablePlan: isGuideEditActive() && key === currentMatchupSlug,
      });
      updateOpponentLink(key);
      syncGuideEditUi();
    };
    const adjustGuideCount = (zone, key, delta) => {
      if (!isGuideEditActive() || !key) return;
      const normalizedZone = zone === 'in' ? 'in' : 'out';
      const zoneMeta = normalizedZone === 'in' ? deckGuideMeta.sideboard : deckGuideMeta.mainboard;
      if (!Object.prototype.hasOwnProperty.call(zoneMeta.qtyByKey, key)) return;
      const targetCounts = normalizedZone === 'in' ? guideEditState.inCounts : guideEditState.outCounts;
      const currentQty = Number(targetCounts[key] || 0);
      const maxQty = Number(zoneMeta.qtyByKey[key] || 0);
      const nextQty = Math.max(0, Math.min(maxQty, currentQty + delta));
      if (nextQty === currentQty) return;
      if (nextQty > 0) {
        targetCounts[key] = nextQty;
      } else {
        delete targetCounts[key];
      }
      renderGuide(currentMatchupSlug);
      renderDecklistBody();
    };
    const commitGuideEdit = async () => {
      if (!isGuideEditActive() || !currentMatchupSlug) return;
      if (editButton) editButton.disabled = true;
      const baseGuide = getCurrentGuideBase(currentMatchupSlug);
      const nextGuide = buildEditedGuide(baseGuide, guideEditState, deckGuideMeta);
      const raw = guideToRawMarkdown(nextGuide);
      try {
        const payload = await saveSourceGuide(bb.slug, deck.slug, currentMatchupSlug, raw);
        if (!payload || !payload.guide) {
          throw new Error('Invalid save response');
        }
        deck.guides[currentMatchupSlug] = {
          ...payload.guide,
          warnings: Array.isArray(baseGuide?.warnings) ? [...baseGuide.warnings] : [],
        };
        discardGuideEditState();
        if (editButton) {
          editButton.classList.remove('active');
          editButton.setAttribute('aria-pressed', 'false');
          editButton.textContent = 'Edit';
        }
        renderGuide(currentMatchupSlug);
        renderDecklistBody();
      } catch (err) {
        console.error(err);
        if (editButton) editButton.disabled = false;
        return;
      }
      if (editButton) editButton.disabled = false;
      syncGuideEditUi();
    };
    select.value = initialGuide;
    renderGuide(initialGuide);
    syncApplyButton();
    select.addEventListener('change', () => {
      discardGuideEditState();
      const key = select.value;
      currentMatchupSlug = key;
      hasExplicitMatchupSelection = true;
      renderGuide(key);
      renderDecklistBody();
      updateDeckHashFromState();
    });
    if (applyButton) {
      applyButton.addEventListener('click', () => {
        currentApplySideboard = !currentApplySideboard;
        syncApplyButton();
        renderDecklistBody();
        updateOpponentLink(select.value);
        updateDeckHashFromState();
      });
    }
    if (editButton) {
      editButton.addEventListener('click', () => {
        preview.hidePreview();
        if (isGuideEditActive()) {
          void commitGuideEdit();
          return;
        }
        const baseGuide = getCurrentGuideBase(select.value);
        guideEditState = {
          matchupSlug: select.value,
          inCounts: buildGuideCountMap(baseGuide?.in),
          outCounts: buildGuideCountMap(baseGuide?.out),
        };
        renderGuide(select.value);
        renderDecklistBody();
      });
    }
    if (decklistBody) {
      decklistBody.addEventListener('click', (event) => {
        if (!isGuideEditActive()) return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const cardEl = target.closest('.card.card-ref');
        if (!cardEl || !decklistBody.contains(cardEl)) return;
        const column = cardEl.closest('.decklist-col[data-deck-zone]');
        const deckZone = column?.getAttribute('data-deck-zone') || '';
        const key = normalizeName(cardEl.getAttribute('data-name') || '');
        if (!key) return;
        if (deckZone === 'sideboard') {
          event.preventDefault();
          event.stopPropagation();
          adjustGuideCount('in', key, 1);
        } else if (deckZone === 'mainboard') {
          event.preventDefault();
          event.stopPropagation();
          adjustGuideCount('out', key, 1);
        }
      });
    }
    if (guideBox) {
      guideBox.addEventListener('click', (event) => {
        if (!isGuideEditActive()) return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const itemEl = target.closest('.guide-plan-item.is-editable');
        if (!itemEl || !guideBox.contains(itemEl)) return;
        const zone = itemEl.getAttribute('data-guide-zone') || '';
        const index = Number.parseInt(itemEl.getAttribute('data-guide-index') || '-1', 10);
        if ((zone !== 'in' && zone !== 'out') || index < 0) return;
        const guideData = getRenderedGuideData(currentMatchupSlug);
        const lines = zone === 'in' ? guideData?.in : guideData?.out;
        const line = Array.isArray(lines) ? lines[index] : '';
        const parsed = parseGuideCountLine(line);
        if (!parsed) return;
        event.preventDefault();
        event.stopPropagation();
        adjustGuideCount(zone, parsed.key, -1);
      });
    }

    bindCollapseSync([decklistDetails, primerDetails, matchupDetails], () => {
      updateOpponentLink(select.value);
    });
  } else {
    bindCollapseSync([decklistDetails, primerDetails]);
  }

  if (primerEditButton) {
    primerEditButton.addEventListener('click', () => {
      preview.hidePreview();
      void openSourceTextEditor({
        draftKey: buildPrimerDraftKey(bb.slug, deck.slug),
        title: `Edit primer: ${deck.name}`,
        fallbackRaw: deck.primer || '',
        loadRaw: async () => {
          primerEditButton.disabled = true;
          try {
            const payload = await fetchSourcePrimer(bb.slug, deck.slug);
            if (!payload || typeof payload.raw !== 'string') {
              throw new Error('Invalid primer response');
            }
            return payload.raw;
          } finally {
            primerEditButton.disabled = false;
          }
        },
        saveRaw: async (raw) => {
          const payload = await saveSourcePrimer(bb.slug, deck.slug, raw);
          if (!payload || typeof payload.raw !== 'string') {
            throw new Error('Invalid save response');
          }
        },
      });
    });
  }

  if (sampleHandButton) {
    sampleHandButton.addEventListener('click', () => {
      preview.hidePreview();
      sampleHand.open();
    });
  }

  renderDecklistBody();
  currentCollapsedMask = computeCollapsedMask();
  updateDeckHashFromState();
}

function renderNotFound() {
  const bodyHtml = `
    <a href="#/" class="back">← Home</a>
    <h1>Not Found</h1>
  `;
  renderBattleboxPane('', bodyHtml);
}

async function init() {
  app.innerHTML = '<div class="loading">Loading...</div>';
  ensureQrOverlay();

  data.index = await fetchJsonData(withCacheBust('/data/index.json'), { cache: 'no-store' });
  if (!data.index) {
    app.innerHTML = '<div class="loading">Failed to load data.</div>';
    return;
  }
  data.buildId = data.index.build_id || '';
  preview.setupCardHover();
  window.addEventListener('hashchange', async () => {
    await safeRoute();
    setActiveTab(tabFromSearch());
  });
  window.addEventListener('popstate', async () => {
    await safeRoute();
    setActiveTab(tabFromSearch());
  });
  await safeRoute();
  setActiveTab(tabFromSearch());
}

init();
