import { cardFaceImageUrl, dfcFlipControlMarkup } from './cardFaces.js';
import { renderDecklistGrid as renderSharedDecklistGrid } from './decklist.js';
import { isDoubleFacedCard, normalizeName, scryfallImageUrlByName } from './utils.js';

const DRAFT_PICK_ZONE_MAINBOARD = 'mainboard';
const DRAFT_PICK_ZONE_SIDEBOARD = 'sideboard';
const DRAFT_BASIC_MIN_COUNT = 0;
const DRAFT_BASIC_MAX_COUNT = 20;
const DRAFT_BASIC_LANDS = Object.freeze([
  { key: 'plains', name: 'Plains' },
  { key: 'island', name: 'Island' },
  { key: 'swamp', name: 'Swamp' },
  { key: 'mountain', name: 'Mountain' },
  { key: 'forest', name: 'Forest' },
]);
const DRAFT_BASIC_NAME_BY_KEY = Object.freeze(
  DRAFT_BASIC_LANDS.reduce((acc, basic) => {
    acc[basic.key] = basic.name;
    return acc;
  }, {}),
);

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getDraftCardImageUrl(cardName, printings, showBack = false) {
  const key = normalizeName(cardName);
  if (key && printings && typeof printings === 'object') {
    const printing = printings[key];
    const printingUrl = cardFaceImageUrl(printing, showBack);
    if (printingUrl) return printingUrl;
  }
  return scryfallImageUrlByName(cardName);
}

function updateDraftPackCardFace(button, cardName, printings, showingBack) {
  if (!button) return;
  const frame = button.querySelector('.draft-pack-card-frame');
  if (!frame) return;

  const name = String(cardName || '').trim();
  const faceLabel = showingBack ? ' (back face)' : ' (front face)';
  const imageUrl = getDraftCardImageUrl(name, printings, showingBack);

  button.setAttribute('title', name);
  button.setAttribute('aria-label', `${name}${faceLabel}`);

  const flipControl = frame.querySelector('[data-draft-card-flip="1"]');
  if (flipControl) {
    const nextTitle = showingBack ? 'Show front face' : 'Show back face';
    flipControl.setAttribute('title', nextTitle);
    flipControl.setAttribute('aria-label', nextTitle);
  }

  const img = frame.querySelector('img');
  const fallback = frame.querySelector('.draft-pack-card-fallback');
  if (imageUrl) {
    if (img) {
      img.setAttribute('src', imageUrl);
      img.setAttribute('alt', `${name}${faceLabel}`);
      return;
    }
    const nextImg = document.createElement('img');
    nextImg.setAttribute('src', imageUrl);
    nextImg.setAttribute('alt', `${name}${faceLabel}`);
    nextImg.setAttribute('loading', 'lazy');
    if (fallback) {
      fallback.replaceWith(nextImg);
    } else {
      frame.appendChild(nextImg);
    }
    return;
  }

  if (fallback) {
    fallback.textContent = `${name}${faceLabel}`;
    return;
  }
  if (img) {
    const nextFallback = document.createElement('span');
    nextFallback.className = 'draft-pack-card-fallback';
    nextFallback.textContent = `${name}${faceLabel}`;
    img.replaceWith(nextFallback);
  }
}

function normalizeSeat(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizePositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatProgressLabel(label, zeroBasedValue, total) {
  const safeTotal = normalizePositiveInt(total);
  if (safeTotal <= 0) return `${label} -/-`;
  const raw = Number.parseInt(String(zeroBasedValue), 10);
  const current = Number.isFinite(raw) ? raw + 1 : 1;
  const clamped = Math.max(1, Math.min(current, safeTotal));
  return `${label} ${clamped}/${safeTotal}`;
}

function formatPickProgressLabel(zeroBasedPick, total, expectedPicks) {
  const safeTotal = normalizePositiveInt(total);
  if (safeTotal <= 0) return 'Pick -/-';

  const rawPick = Number.parseInt(String(zeroBasedPick), 10);
  const pickStart = Number.isFinite(rawPick) ? rawPick + 1 : 1;
  const clampedStart = Math.max(1, Math.min(pickStart, safeTotal));
  const rawExpected = Number.parseInt(String(expectedPicks), 10);
  const span = Number.isFinite(rawExpected) && rawExpected > 0 ? rawExpected : 1;
  const clampedEnd = Math.max(clampedStart, Math.min(clampedStart + span - 1, safeTotal));

  if (clampedEnd > clampedStart) {
    return `Pick ${clampedStart}-${clampedEnd}/${safeTotal}`;
  }
  return `Pick ${clampedStart}/${safeTotal}`;
}

function formatSeatLabel(zeroBasedSeat, seatTotal) {
  const rawSeat = Number.parseInt(String(zeroBasedSeat), 10);
  const currentSeat = Number.isFinite(rawSeat) && rawSeat >= 0 ? rawSeat + 1 : 1;
  const total = normalizePositiveInt(seatTotal);
  if (total <= 0) return `Seat ${currentSeat}/-`;
  const clampedSeat = Math.max(1, Math.min(currentSeat, total));
  return `Seat ${clampedSeat}/${total}`;
}

function normalizeDraftSlug(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function clampDraftBasicCount(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DRAFT_BASIC_MIN_COUNT;
  if (parsed < DRAFT_BASIC_MIN_COUNT) return DRAFT_BASIC_MIN_COUNT;
  if (parsed > DRAFT_BASIC_MAX_COUNT) return DRAFT_BASIC_MAX_COUNT;
  return parsed;
}

function createDraftBasicCounts(raw) {
  const counts = {};
  DRAFT_BASIC_LANDS.forEach((basic) => {
    counts[basic.key] = clampDraftBasicCount(raw && raw[basic.key]);
  });
  return counts;
}

function deriveDraftBasicCountsFromPicks(picks) {
  const counts = createDraftBasicCounts({});
  const mainboard = Array.isArray(picks?.mainboard) ? picks.mainboard : [];
  mainboard.forEach((cardName) => {
    const key = normalizeName(cardName);
    if (Object.prototype.hasOwnProperty.call(counts, key)) {
      counts[key] = clampDraftBasicCount(counts[key] + 1);
    }
  });
  return counts;
}

function isDraftBasicLand(cardName) {
  const key = normalizeName(cardName);
  return Object.prototype.hasOwnProperty.call(DRAFT_BASIC_NAME_BY_KEY, key);
}

function basicFallbackLabel(key) {
  const name = DRAFT_BASIC_NAME_BY_KEY[key];
  return name || key;
}

function renderDraftBasicsPickerCards(printings) {
  return DRAFT_BASIC_LANDS.map((basic) => {
    const imageUrl = getDraftCardImageUrl(basic.name, printings, false);
    const imageMarkup = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(basic.name)}" loading="lazy">`
      : `<span class="draft-basics-card-fallback">${escapeHtml(basicFallbackLabel(basic.key))}</span>`;
    return `
      <button type="button" class="draft-basics-card-button" data-basic-key="${basic.key}" aria-label="${escapeHtml(basic.name)}">
        <span class="draft-basics-card-image">
          ${imageMarkup}
          <span class="draft-basics-half draft-basics-half-top" aria-hidden="true">+</span>
          <span class="draft-basics-half draft-basics-half-bottom" aria-hidden="true">-</span>
          <span class="draft-basics-count-badge" data-basic-count-key="${basic.key}">0</span>
        </span>
        <span class="draft-basics-card-name">${escapeHtml(basic.name)}</span>
      </button>
    `;
  }).join('');
}

function buildDraftPickCards(cardNames, cardMetaByName, printings, doubleFaced) {
  const aggregated = new Map();
  const addCard = (name) => {
    const rawName = String(name || '').trim();
    const key = normalizeName(rawName);
    if (!key) return;
    const existing = aggregated.get(key);
    if (existing) {
      existing.qty += 1;
      return;
    }
    const meta = cardMetaByName && typeof cardMetaByName === 'object' ? cardMetaByName[key] : null;
    const rawManaValue = Number(meta?.mana_value);
    const isBasic = isDraftBasicLand(rawName);
    const printing = String(meta?.printing || printings?.[key] || '');
    aggregated.set(key, {
      qty: 1,
      name: String(meta?.name || rawName),
      type: String(meta?.type || (isBasic ? 'land' : '')),
      mana_cost: String(meta?.mana_cost || ''),
      mana_value: Number.isFinite(rawManaValue) ? rawManaValue : 0,
      printing,
      double_faced: meta?.double_faced === true || doubleFaced?.[key] === true,
    });
  };

  (Array.isArray(cardNames) ? cardNames : []).forEach(addCard);
  return [...aggregated.values()];
}

function renderDraftPicksDecklist(picks, cardMetaByName, printings, doubleFaced) {
  const normalizedPicks = picks && typeof picks === 'object'
    ? picks
    : { mainboard: [], sideboard: [] };
  const mainCards = buildDraftPickCards(
    normalizedPicks.mainboard,
    cardMetaByName,
    printings,
    doubleFaced,
  );
  const sideCards = buildDraftPickCards(
    normalizedPicks.sideboard,
    cardMetaByName,
    printings,
    doubleFaced,
  );
  return renderSharedDecklistGrid({
    viewMode: 'default',
    deckView: {
      mainCards,
      sideCards,
      mainboardAdded: {},
      sideboardFromMain: {},
    },
    bannedSet: null,
    mainboardHighlightMap: {},
    sideboardHighlightMap: {},
  });
}

export function createDraftController({
  ui,
  onLobbyRequested,
  onCubeRequested,
  onRoomSelectionChanged,
  onPreviewDismissRequested,
  onSampleHandRequested,
}) {
  const draftUi = {
    socket: null,
    roomId: '',
    roomDeckSlug: '',
    roomDeckName: '',
    roomDeckPrintings: {},
    roomDeckDoubleFaced: {},
    roomDeckCardMeta: {},
    roomPackTotal: 0,
    roomPickTotal: 0,
    seat: 0,
    state: null,
    connected: false,
    pendingPick: false,
    reconnectAttempt: 0,
    reconnectTimer: null,
    shouldReconnect: false,
    selectedPackID: '',
    selectedPackZones: new Map(),
    packCardBackFaces: new Map(),
    lastPicksHtml: '',
    toggleSideboardMode: false,
    pendingDeckMutation: false,
    pendingBasicsSet: false,
    basicsModalOpen: false,
    basicsDraftCounts: createDraftBasicCounts({}),
  };

  function clearReconnectTimer() {
    if (draftUi.reconnectTimer) {
      clearTimeout(draftUi.reconnectTimer);
      draftUi.reconnectTimer = null;
    }
  }

  function reconnectDelayMs(attempt) {
    return Math.min(500 * (2 ** attempt), 10000);
  }

  function hasActiveRoom() {
    return Boolean(draftUi.roomId);
  }

  function clearRoomSelection() {
    draftUi.roomId = '';
    draftUi.roomDeckSlug = '';
    draftUi.roomDeckName = '';
    draftUi.roomDeckPrintings = {};
    draftUi.roomDeckDoubleFaced = {};
    draftUi.roomDeckCardMeta = {};
    draftUi.roomPackTotal = 0;
    draftUi.roomPickTotal = 0;
    draftUi.seat = 0;
    draftUi.state = null;
    draftUi.pendingPick = false;
    draftUi.pendingDeckMutation = false;
    draftUi.selectedPackID = '';
    draftUi.selectedPackZones.clear();
    draftUi.packCardBackFaces.clear();
    draftUi.lastPicksHtml = '';
    draftUi.toggleSideboardMode = false;
    draftUi.pendingBasicsSet = false;
    draftUi.basicsModalOpen = false;
    draftUi.basicsDraftCounts = createDraftBasicCounts({});
    if (ui.draftPane) {
      ui.draftPane.dataset.sideboardSwapMode = '0';
      const basicsOverlay = ui.draftPane.querySelector('#draft-basics-overlay');
      if (basicsOverlay) basicsOverlay.hidden = true;
    }
  }

  function updateConnectionIndicator() {
    if (!ui.draftPane || !hasActiveRoom()) return;
    const connectionDot = ui.draftPane.querySelector('#draft-connection-dot');
    if (!connectionDot) return;
    connectionDot.classList.toggle('is-online', draftUi.connected);
    connectionDot.classList.toggle('is-offline', !draftUi.connected);
    connectionDot.setAttribute('title', draftUi.connected ? 'Connected' : 'Disconnected');
    connectionDot.setAttribute('aria-label', draftUi.connected ? 'Connected' : 'Disconnected');
  }

  function scheduleReconnect() {
    if (!draftUi.shouldReconnect || !draftUi.roomId) return;
    clearReconnectTimer();
    const delay = reconnectDelayMs(draftUi.reconnectAttempt);
    draftUi.reconnectAttempt += 1;
    updateConnectionIndicator();
    draftUi.reconnectTimer = setTimeout(() => {
      draftUi.reconnectTimer = null;
      if (!draftUi.shouldReconnect || !draftUi.roomId) return;
      void connectSocket(draftUi.roomId, draftUi.seat, true);
    }, delay);
  }

  function teardownSocket() {
    draftUi.shouldReconnect = false;
    clearReconnectTimer();
    if (draftUi.socket) {
      try {
        draftUi.socket.close();
      } catch (_) {
        // best effort
      }
    }
    draftUi.socket = null;
    draftUi.connected = false;
    draftUi.pendingPick = false;
    draftUi.pendingDeckMutation = false;
    draftUi.pendingBasicsSet = false;
    draftUi.selectedPackID = '';
    draftUi.selectedPackZones.clear();
  }

  function teardown() {
    teardownSocket();
    clearRoomSelection();
  }

  function leaveRoom() {
    teardown();
    if (typeof onLobbyRequested === 'function') {
      onLobbyRequested();
    }
  }

  function openRoom(
    roomId,
    seat,
    roomDeckSlug = '',
    roomDeckPrintings = {},
    roomDeckName = '',
    roomDeckDoubleFaced = {},
    roomDeckCardMeta = {},
    roomPackTotal = 0,
    roomPickTotal = 0,
  ) {
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) return;
    draftUi.roomId = normalizedRoomId;
    draftUi.roomDeckSlug = normalizeDraftSlug(roomDeckSlug);
    draftUi.roomDeckName = String(roomDeckName || '').trim();
    draftUi.roomDeckPrintings = roomDeckPrintings && typeof roomDeckPrintings === 'object' ? roomDeckPrintings : {};
    draftUi.roomDeckDoubleFaced = roomDeckDoubleFaced && typeof roomDeckDoubleFaced === 'object' ? roomDeckDoubleFaced : {};
    draftUi.roomDeckCardMeta = roomDeckCardMeta && typeof roomDeckCardMeta === 'object' ? roomDeckCardMeta : {};
    draftUi.roomPackTotal = normalizePositiveInt(roomPackTotal);
    draftUi.roomPickTotal = normalizePositiveInt(roomPickTotal);
    draftUi.seat = normalizeSeat(seat);
    draftUi.state = null;
    draftUi.reconnectAttempt = 0;
    draftUi.selectedPackID = '';
    draftUi.selectedPackZones.clear();
    draftUi.packCardBackFaces.clear();
    draftUi.lastPicksHtml = '';
    draftUi.pendingDeckMutation = false;
    draftUi.pendingBasicsSet = false;
    draftUi.basicsModalOpen = false;
    draftUi.basicsDraftCounts = createDraftBasicCounts({});
    draftUi.toggleSideboardMode = false;
    if (typeof onRoomSelectionChanged === 'function') {
      onRoomSelectionChanged(draftUi.roomId, draftUi.seat);
    }
  }

  function packCardFaceKey(packID, cardIndex) {
    return `${String(packID || '')}:${Number(cardIndex)}`;
  }

  function roomDisplayName() {
    if (draftUi.roomDeckName) return draftUi.roomDeckName;
    if (draftUi.roomDeckSlug) return draftUi.roomDeckSlug;
    return draftUi.roomId;
  }

  function syncSideboardModeUi() {
    if (!ui.draftPane) return;
    ui.draftPane.dataset.sideboardSwapMode = draftUi.toggleSideboardMode ? '1' : '0';
    const toggleButton = ui.draftPane.querySelector('#draft-toggle-sideboard-mode');
    const modeOn = draftUi.toggleSideboardMode;
    if (!toggleButton) return;
    toggleButton.classList.toggle('active', modeOn);
    toggleButton.setAttribute('aria-pressed', modeOn ? 'true' : 'false');
    toggleButton.textContent = 'Sideboard ↔️';
    toggleButton.disabled = draftUi.pendingDeckMutation;
  }

  function pickZoneLabel(zone) {
    if (zone === DRAFT_PICK_ZONE_MAINBOARD) return 'Main';
    if (zone === DRAFT_PICK_ZONE_SIDEBOARD) return 'Side';
    return '';
  }

  function applyPackCardPickZoneUi(cardButton, zone) {
    const isMainboard = zone === DRAFT_PICK_ZONE_MAINBOARD;
    const isSideboard = zone === DRAFT_PICK_ZONE_SIDEBOARD;
    cardButton.classList.toggle('is-mainboard', isMainboard);
    cardButton.classList.toggle('is-sideboard', isSideboard);

    const frame = cardButton.querySelector('.draft-pack-card-frame');
    if (!frame) return;
    let zoneTag = frame.querySelector('.draft-pack-card-zone-tag');
    if (!isMainboard && !isSideboard) {
      if (zoneTag) zoneTag.remove();
      return;
    }
    if (!zoneTag) {
      zoneTag = document.createElement('span');
      zoneTag.className = 'draft-pack-card-zone-tag';
      frame.appendChild(zoneTag);
    }
    zoneTag.textContent = pickZoneLabel(zone);
    zoneTag.classList.toggle('is-mainboard', isMainboard);
    zoneTag.classList.toggle('is-sideboard', isSideboard);
  }

  function syncPackSelectionUi(cardButtons, pickButton, canPick, expectedPicks) {
    const required = Number.isFinite(expectedPicks) && expectedPicks > 0 ? expectedPicks : 1;
    const selectedCount = draftUi.selectedPackZones.size;
    cardButtons.forEach((btn) => {
      const idx = Number.parseInt(btn.dataset.index || '-1', 10);
      const zone = draftUi.selectedPackZones.get(idx);
      const hasSelection = zone === DRAFT_PICK_ZONE_MAINBOARD || zone === DRAFT_PICK_ZONE_SIDEBOARD;
      const lockUnselected = canPick && selectedCount >= required && !hasSelection;
      const disabled = !canPick;
      applyPackCardPickZoneUi(btn, zone);
      if (disabled) {
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.removeAttribute('aria-disabled');
      }
      if (lockUnselected) {
        btn.dataset.selectLocked = '1';
        btn.setAttribute('tabindex', '-1');
      } else {
        delete btn.dataset.selectLocked;
        btn.removeAttribute('tabindex');
      }
    });
    if (pickButton) {
      pickButton.disabled = !canPick || selectedCount !== required;
    }
  }

  function syncPackColumnWidth(packEl) {
    if (!packEl) return;
    const packScroll = packEl.querySelector('.draft-pack-scroll');
    const packGrid = packEl.querySelector('#draft-pack-grid');
    if (!packScroll || !packGrid) return;
    const gridStyle = window.getComputedStyle(packGrid);
    const gap = Number.parseFloat(gridStyle.columnGap || gridStyle.gap || '0') || 0;
    const viewportWidth = packScroll.clientWidth;
    if (viewportWidth <= 0) return;
    const columnWidth = Math.max(0, (viewportWidth - gap) / 2);
    packScroll.style.setProperty('--draft-pack-col-width', `${columnWidth}px`);
  }

  function updatePackScrollIndicators() {
    if (!ui.draftPane) return;
    const packScroll = ui.draftPane.querySelector('.draft-pack-scroll');
    const leftIndicator = ui.draftPane.querySelector('#draft-pack-scroll-left');
    const rightIndicator = ui.draftPane.querySelector('#draft-pack-scroll-right');
    if (!leftIndicator || !rightIndicator) return;
    if (!packScroll) {
      leftIndicator.hidden = true;
      rightIndicator.hidden = true;
      return;
    }
    const maxScrollLeft = Math.max(0, packScroll.scrollWidth - packScroll.clientWidth);
    if (maxScrollLeft <= 2) {
      leftIndicator.hidden = true;
      rightIndicator.hidden = true;
      return;
    }
    leftIndicator.hidden = packScroll.scrollLeft <= 2;
    rightIndicator.hidden = packScroll.scrollLeft >= maxScrollLeft - 2;
  }

  function getActivePackInteractionState() {
    const state = draftUi.state;
    const active = state?.active_pack;
    if (!state || !active || !Array.isArray(active.cards) || active.cards.length === 0) return null;
    const expectedPicks = Math.max(1, Number.parseInt(String(state.expected_picks || 1), 10) || 1);
    const canPick = Boolean(state.can_pick) && !draftUi.pendingPick;
    return {
      state,
      active,
      expectedPicks,
      canPick,
    };
  }

  function syncPackSelectionUiFromDom() {
    if (!ui.draftPane) return;
    const cardButtons = [...ui.draftPane.querySelectorAll('#draft-pack-grid .draft-pack-card')];
    const pickButton = ui.draftPane.querySelector('#draft-pick-submit');
    const ctx = getActivePackInteractionState();
    if (!ctx) {
      syncPackSelectionUi(cardButtons, pickButton, false, 1);
      return;
    }
    syncPackSelectionUi(cardButtons, pickButton, ctx.canPick, ctx.expectedPicks);
  }

  function createPackCardButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-button draft-pack-card';
    const frame = document.createElement('span');
    frame.className = 'draft-pack-card-frame';
    button.appendChild(frame);
    return button;
  }

  function updatePackCardButton(button, activePackID, cardName, index, canPick) {
    if (!button) return;
    const frame = button.querySelector('.draft-pack-card-frame');
    if (!frame) return;

    button.dataset.index = String(index);
    if (canPick) {
      button.removeAttribute('aria-disabled');
    } else {
      button.setAttribute('aria-disabled', 'true');
    }

    const doubleFaced = isDoubleFacedCard(cardName, draftUi.roomDeckDoubleFaced);
    const faceKey = packCardFaceKey(activePackID, index);
    const showingBack = doubleFaced && draftUi.packCardBackFaces.get(faceKey) === true;
    let flipControl = frame.querySelector('[data-draft-card-flip="1"]');

    if (doubleFaced) {
      const nextTitle = showingBack ? 'Show front face' : 'Show back face';
      if (!flipControl) {
        frame.insertAdjacentHTML(
          'afterbegin',
          dfcFlipControlMarkup(
            `data-draft-card-flip="1" data-draft-card-index="${index}"`,
            nextTitle,
          ),
        );
        flipControl = frame.querySelector('[data-draft-card-flip="1"]');
      }
      if (flipControl) {
        flipControl.setAttribute('data-draft-card-index', String(index));
        flipControl.setAttribute('title', nextTitle);
        flipControl.setAttribute('aria-label', nextTitle);
      }
    } else if (flipControl) {
      flipControl.remove();
    }

    updateDraftPackCardFace(button, cardName, draftUi.roomDeckPrintings, showingBack);
  }

  function renderPackCardsInPlace(activePackID, cards, canPick) {
    if (!ui.draftPane) return;
    const packGrid = ui.draftPane.querySelector('#draft-pack-grid');
    if (!packGrid) return;

    for (let i = 0; i < cards.length; i += 1) {
      let button = packGrid.children[i];
      if (!(button instanceof HTMLElement) || !button.classList.contains('draft-pack-card')) {
        button = createPackCardButton();
        packGrid.appendChild(button);
      }
      updatePackCardButton(button, activePackID, cards[i], i, canPick);
    }
    while (packGrid.children.length > cards.length) {
      packGrid.removeChild(packGrid.lastChild);
    }
  }

  function submitSelectedPicks() {
    const ctx = getActivePackInteractionState();
    if (!ctx || !ctx.canPick) return;
    const selections = [...draftUi.selectedPackZones.entries()]
      .filter(([idx, zone]) => (
        Number.isInteger(idx)
        && idx >= 0
        && idx < ctx.active.cards.length
        && (zone === DRAFT_PICK_ZONE_MAINBOARD || zone === DRAFT_PICK_ZONE_SIDEBOARD)
      ))
      .sort((a, b) => a[0] - b[0]);
    if (selections.length !== ctx.expectedPicks) return;
    const picks = selections.map(([idx, zone]) => ({
      card_name: ctx.active.cards[idx],
      zone,
    }));
    if (!picks.every((pick) => pick && pick.card_name && pick.zone)) return;
    if (!draftUi.socket || draftUi.socket.readyState !== WebSocket.OPEN) return;
    const nextSeq = Number.parseInt(String(ctx.state.next_seq || 1), 10) || 1;
    draftUi.pendingPick = true;
    draftUi.selectedPackZones.clear();
    syncPackSelectionUiFromDom();
    updateUIFromState();
    draftUi.socket.send(JSON.stringify({
      type: 'pick',
      seq: nextSeq,
      pack_id: ctx.active.pack_id,
      picks,
    }));
  }

  function toggleSideboardMode() {
    draftUi.toggleSideboardMode = !draftUi.toggleSideboardMode;
    if (draftUi.toggleSideboardMode && typeof onPreviewDismissRequested === 'function') {
      onPreviewDismissRequested();
    }
    syncSideboardModeUi();
  }

  function resolvePicksCardZone(cardEl) {
    if (!cardEl) return '';
    const grid = cardEl.closest('.decklist-grid');
    const column = cardEl.closest('.decklist-col');
    if (!grid || !column) return '';
    const columns = [...grid.querySelectorAll(':scope > .decklist-col')];
    const index = columns.indexOf(column);
    if (columns.length > 1 && index === 1) return DRAFT_PICK_ZONE_SIDEBOARD;
    return DRAFT_PICK_ZONE_MAINBOARD;
  }

  function submitMovePick(cardName, fromZone) {
    const state = draftUi.state;
    if (!state || draftUi.pendingDeckMutation) return;
    if (!cardName) return;
    if (fromZone !== DRAFT_PICK_ZONE_MAINBOARD && fromZone !== DRAFT_PICK_ZONE_SIDEBOARD) return;
    const toZone = fromZone === DRAFT_PICK_ZONE_MAINBOARD
      ? DRAFT_PICK_ZONE_SIDEBOARD
      : DRAFT_PICK_ZONE_MAINBOARD;
    if (!draftUi.socket || draftUi.socket.readyState !== WebSocket.OPEN) return;
    const nextSeq = Number.parseInt(String(state.next_seq || 1), 10) || 1;
    draftUi.pendingDeckMutation = true;
    syncSideboardModeUi();
    draftUi.socket.send(JSON.stringify({
      type: 'move_pick',
      seq: nextSeq,
      card_name: cardName,
      from_zone: fromZone,
      to_zone: toZone,
    }));
  }

  function openDraftSampleHand() {
    if (typeof onSampleHandRequested !== 'function') return;
    const state = draftUi.state;
    const picks = state?.picks && typeof state.picks === 'object'
      ? state.picks
      : { mainboard: [] };
    const mainCards = buildDraftPickCards(
      picks.mainboard,
      draftUi.roomDeckCardMeta,
      draftUi.roomDeckPrintings,
      draftUi.roomDeckDoubleFaced,
    );
    onSampleHandRequested({
      key: `${draftUi.roomId}|seat:${draftUi.seat}|draft-mainboard`,
      cards: mainCards,
      sample: {
        initialDrawCount: 7,
        allowDraw: true,
      },
    });
  }

  function setBasicsModalOpen(isOpen) {
    draftUi.basicsModalOpen = Boolean(isOpen);
    if (!ui.draftPane) return;
    const overlay = ui.draftPane.querySelector('#draft-basics-overlay');
    if (!overlay) return;
    overlay.hidden = !draftUi.basicsModalOpen;
  }

  function syncBasicsDialogUi() {
    if (!ui.draftPane) return;
    const overlay = ui.draftPane.querySelector('#draft-basics-overlay');
    if (!overlay) return;
    overlay.hidden = !draftUi.basicsModalOpen;
    const setButton = overlay.querySelector('#draft-basics-set');
    const closeButton = overlay.querySelector('#draft-basics-close');
    const status = overlay.querySelector('#draft-basics-status');

    DRAFT_BASIC_LANDS.forEach((basic) => {
      const count = clampDraftBasicCount(draftUi.basicsDraftCounts[basic.key]);
      const countEl = overlay.querySelector(`[data-basic-count-key="${basic.key}"]`);
      if (countEl) countEl.textContent = String(count);
      const cardButton = overlay.querySelector(`.draft-basics-card-button[data-basic-key="${basic.key}"]`);
      if (cardButton) {
        cardButton.setAttribute('aria-label', `${basic.name}: ${count}`);
        cardButton.disabled = draftUi.pendingBasicsSet;
      }
    });

    if (setButton) setButton.disabled = draftUi.pendingBasicsSet;
    if (closeButton) closeButton.disabled = draftUi.pendingBasicsSet;
    if (status) {
      status.hidden = !draftUi.pendingBasicsSet;
      status.textContent = draftUi.pendingBasicsSet ? 'Saving...' : '';
    }
  }

  function closeBasicsDialog(force = false) {
    if (draftUi.pendingBasicsSet && !force) return;
    setBasicsModalOpen(false);
    syncBasicsDialogUi();
  }

  function openBasicsDialog() {
    if (!ui.draftPane) return;
    if (!draftUi.state || draftUi.pendingDeckMutation) return;
    draftUi.basicsDraftCounts = deriveDraftBasicCountsFromPicks(draftUi.state.picks);
    setBasicsModalOpen(true);
    syncBasicsDialogUi();
  }

  function updateDraftBasicCount(key, delta) {
    if (!Object.prototype.hasOwnProperty.call(DRAFT_BASIC_NAME_BY_KEY, key)) return;
    if (draftUi.pendingBasicsSet) return;
    const current = clampDraftBasicCount(draftUi.basicsDraftCounts[key]);
    const next = clampDraftBasicCount(current + delta);
    if (next === current) return;
    draftUi.basicsDraftCounts[key] = next;
    syncBasicsDialogUi();
  }

  function submitSetBasics() {
    if (!draftUi.state || draftUi.pendingBasicsSet || draftUi.pendingDeckMutation) return;
    if (!draftUi.socket || draftUi.socket.readyState !== WebSocket.OPEN) return;

    const nextSeq = Number.parseInt(String(draftUi.state.next_seq || 1), 10) || 1;
    const basics = {};
    DRAFT_BASIC_LANDS.forEach((basic) => {
      basics[basic.key] = clampDraftBasicCount(draftUi.basicsDraftCounts[basic.key]);
    });

    draftUi.pendingDeckMutation = true;
    draftUi.pendingBasicsSet = true;
    syncSideboardModeUi();
    syncBasicsDialogUi();
    draftUi.socket.send(JSON.stringify({
      type: 'set_basics',
      seq: nextSeq,
      basics,
    }));
  }

  function handlePackCardToggle(index) {
    const ctx = getActivePackInteractionState();
    if (!ctx || !ctx.canPick) return;
    if (index < 0 || index >= ctx.active.cards.length) return;
    const currentZone = draftUi.selectedPackZones.get(index) || '';
    if (!currentZone) {
      if (draftUi.selectedPackZones.size >= ctx.expectedPicks) return;
      draftUi.selectedPackZones.set(index, DRAFT_PICK_ZONE_MAINBOARD);
    } else if (currentZone === DRAFT_PICK_ZONE_MAINBOARD) {
      draftUi.selectedPackZones.set(index, DRAFT_PICK_ZONE_SIDEBOARD);
    } else {
      draftUi.selectedPackZones.delete(index);
    }
    syncPackSelectionUiFromDom();
  }

  function handlePackCardFlip(index) {
    const ctx = getActivePackInteractionState();
    if (!ctx) return;
    if (index < 0 || index >= ctx.active.cards.length) return;
    const cardName = ctx.active.cards[index];
    if (!isDoubleFacedCard(cardName, draftUi.roomDeckDoubleFaced)) return;
    const key = packCardFaceKey(String(ctx.active.pack_id || ''), index);
    const next = !(draftUi.packCardBackFaces.get(key) === true);
    draftUi.packCardBackFaces.set(key, next);
    if (!ui.draftPane) return;
    const cardButton = ui.draftPane.querySelector(`#draft-pack-grid .draft-pack-card[data-index="${index}"]`);
    updateDraftPackCardFace(cardButton, cardName, draftUi.roomDeckPrintings, next);
  }

  function bindPackInteractions() {
    if (!ui.draftPane) return;
    const packRoot = ui.draftPane.querySelector('#draft-pack-cards');
    if (!packRoot || packRoot.dataset.bound === '1') return;
    packRoot.dataset.bound = '1';
    packRoot.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const flipControl = target.closest('[data-draft-card-flip="1"]');
      if (flipControl && packRoot.contains(flipControl)) {
        event.preventDefault();
        event.stopPropagation();
        const i = Number.parseInt(String(flipControl.getAttribute('data-draft-card-index') || '-1'), 10);
        handlePackCardFlip(i);
        return;
      }

      const cardButton = target.closest('.draft-pack-card');
      if (cardButton && packRoot.contains(cardButton)) {
        const i = Number.parseInt(String(cardButton.getAttribute('data-index') || '-1'), 10);
        handlePackCardToggle(i);
      }
    });

    const packScroll = packRoot.querySelector('.draft-pack-scroll');
    if (packScroll && packScroll.dataset.scrollBound !== '1') {
      packScroll.dataset.scrollBound = '1';
      packScroll.addEventListener('scroll', () => {
        updatePackScrollIndicators();
      }, { passive: true });
    }

    const pickButton = ui.draftPane.querySelector('#draft-pick-submit');
    if (pickButton && pickButton.dataset.bound !== '1') {
      pickButton.dataset.bound = '1';
      pickButton.addEventListener('click', () => {
        submitSelectedPicks();
      });
    }

    const sideboardModeButton = ui.draftPane.querySelector('#draft-toggle-sideboard-mode');
    if (sideboardModeButton && sideboardModeButton.dataset.bound !== '1') {
      sideboardModeButton.dataset.bound = '1';
      sideboardModeButton.addEventListener('click', () => {
        toggleSideboardMode();
      });
    }

    const sampleHandButton = ui.draftPane.querySelector('#draft-sample-hand');
    if (sampleHandButton && sampleHandButton.dataset.bound !== '1') {
      sampleHandButton.dataset.bound = '1';
      sampleHandButton.addEventListener('click', () => {
        openDraftSampleHand();
      });
    }

    const basicsButton = ui.draftPane.querySelector('#draft-basics');
    if (basicsButton && basicsButton.dataset.bound !== '1') {
      basicsButton.dataset.bound = '1';
      basicsButton.addEventListener('click', () => {
        openBasicsDialog();
      });
    }

    const basicsOverlay = ui.draftPane.querySelector('#draft-basics-overlay');
    if (basicsOverlay && basicsOverlay.dataset.bound !== '1') {
      basicsOverlay.dataset.bound = '1';
      const closeButton = basicsOverlay.querySelector('#draft-basics-close');
      const setButton = basicsOverlay.querySelector('#draft-basics-set');
      const backdrop = basicsOverlay.querySelector('.draft-basics-backdrop');

      if (closeButton) {
        closeButton.addEventListener('click', () => {
          closeBasicsDialog();
        });
      }
      if (setButton) {
        setButton.addEventListener('click', () => {
          submitSetBasics();
        });
      }
      if (backdrop) {
        backdrop.addEventListener('click', () => {
          closeBasicsDialog();
        });
      }

      basicsOverlay.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const cardButton = target.closest('.draft-basics-card-button');
        if (!cardButton || !basicsOverlay.contains(cardButton)) return;
        const imageEl = target.closest('.draft-basics-card-image');
        if (!imageEl || !cardButton.contains(imageEl)) return;
        event.preventDefault();
        event.stopPropagation();
        if (draftUi.pendingBasicsSet) return;
        const key = String(cardButton.getAttribute('data-basic-key') || '').trim();
        if (!Object.prototype.hasOwnProperty.call(DRAFT_BASIC_NAME_BY_KEY, key)) return;
        const rect = imageEl.getBoundingClientRect();
        if (rect.height <= 0) return;
        const clickY = event.clientY - rect.top;
        const delta = clickY < rect.height / 2 ? 1 : -1;
        updateDraftBasicCount(key, delta);
      });
    }

    const picksRoot = ui.draftPane.querySelector('#draft-picks-cards');
    if (picksRoot && picksRoot.dataset.bound !== '1') {
      picksRoot.dataset.bound = '1';
      picksRoot.addEventListener('click', (event) => {
        if (!draftUi.toggleSideboardMode || draftUi.pendingDeckMutation) return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const cardEl = target.closest('.card.card-ref');
        if (!cardEl || !picksRoot.contains(cardEl)) return;
        const cardName = String(cardEl.getAttribute('data-name') || '').trim();
        if (isDraftBasicLand(cardName)) return;
        const fromZone = resolvePicksCardZone(cardEl);
        if (!cardName || !fromZone) return;
        event.preventDefault();
        event.stopPropagation();
        submitMovePick(cardName, fromZone);
      });
    }
  }

  function updateUIFromState() {
    if (!ui.draftPane || !hasActiveRoom()) return;
    const seatInfoEl = ui.draftPane.querySelector('#draft-seat-label');
    const packInfoEl = ui.draftPane.querySelector('#draft-pack-label');
    const pickInfoEl = ui.draftPane.querySelector('#draft-pick-label');
    const waitingDividerEl = ui.draftPane.querySelector('#draft-waiting-divider');
    const waitingLabelEl = ui.draftPane.querySelector('#draft-waiting-label');
    const packRoot = ui.draftPane.querySelector('#draft-pack-cards');
    const packEmptyEl = ui.draftPane.querySelector('#draft-pack-empty');
    const packContentEl = ui.draftPane.querySelector('#draft-pack-content');
    const pickButton = ui.draftPane.querySelector('#draft-pick-submit');
    const picksEl = ui.draftPane.querySelector('#draft-picks-cards');
    const basicsButton = ui.draftPane.querySelector('#draft-basics');

    const setWaitingIndicator = (isVisible) => {
      if (waitingDividerEl) waitingDividerEl.hidden = !isVisible;
      if (waitingLabelEl) waitingLabelEl.hidden = !isVisible;
    };

    updateConnectionIndicator();
    syncSideboardModeUi();

    const state = draftUi.state;
    if (!state) {
      draftUi.selectedPackID = '';
      draftUi.selectedPackZones.clear();
      if (seatInfoEl) seatInfoEl.textContent = formatSeatLabel(draftUi.seat, 0);
      if (packInfoEl) packInfoEl.textContent = 'Pack -/-';
      if (pickInfoEl) pickInfoEl.textContent = 'Pick -/-';
      setWaitingIndicator(false);
      if (packEmptyEl) {
        packEmptyEl.hidden = false;
        packEmptyEl.textContent = 'Waiting for state...';
      }
      if (packContentEl) packContentEl.hidden = true;
      updatePackScrollIndicators();
      if (pickButton) {
        pickButton.textContent = 'Pick';
        pickButton.disabled = true;
      }
      if (picksEl) {
        picksEl.innerHTML = '';
        draftUi.lastPicksHtml = '';
      }
      if (basicsButton) basicsButton.disabled = true;
      closeBasicsDialog(true);
      syncSideboardModeUi();
      return;
    }

    if (seatInfoEl) {
      const seatID = Number.parseInt(String(state.seat_id), 10);
      const seatIndex = Number.isFinite(seatID) && seatID >= 0 ? seatID : draftUi.seat;
      seatInfoEl.textContent = formatSeatLabel(seatIndex, state.seat_count);
    }
    if (packInfoEl) {
      packInfoEl.textContent = formatProgressLabel('Pack', state.pack_no, draftUi.roomPackTotal);
    }
    if (pickInfoEl) {
      pickInfoEl.textContent = formatPickProgressLabel(
        state.pick_no,
        draftUi.roomPickTotal,
        state.expected_picks,
      );
    }
    const hasActivePack = Boolean(
      state.active_pack
      && Array.isArray(state.active_pack.cards)
      && state.active_pack.cards.length > 0,
    );
    const waitingOnTable = (
      state.state !== 'done'
      && hasActivePack
      && (draftUi.pendingPick || !state.can_pick)
    );
    setWaitingIndicator(waitingOnTable);

    if (picksEl) {
      const picksHtml = renderDraftPicksDecklist(
        state.picks,
        draftUi.roomDeckCardMeta,
        draftUi.roomDeckPrintings,
        draftUi.roomDeckDoubleFaced,
      );
      if (picksHtml !== draftUi.lastPicksHtml) {
        picksEl.innerHTML = picksHtml;
        draftUi.lastPicksHtml = picksHtml;
      }
    }
    if (basicsButton) {
      basicsButton.disabled = draftUi.pendingDeckMutation || !draftUi.connected;
    }
    syncBasicsDialogUi();

    if (!packRoot) return;
    const active = state.active_pack;
    if (!active || !Array.isArray(active.cards) || active.cards.length === 0) {
      draftUi.selectedPackID = '';
      draftUi.selectedPackZones.clear();
      if (packEmptyEl) {
        packEmptyEl.hidden = false;
        packEmptyEl.textContent = state.state === 'done'
          ? 'Draft complete.'
          : 'Waiting for next pack...';
      }
      if (packContentEl) packContentEl.hidden = true;
      updatePackScrollIndicators();
      if (pickButton) {
        pickButton.textContent = 'Pick';
        pickButton.disabled = true;
      }
      syncSideboardModeUi();
      return;
    }

    const activePackID = String(active.pack_id || '');
    if (draftUi.selectedPackID !== activePackID) {
      draftUi.selectedPackID = activePackID;
      draftUi.selectedPackZones.clear();
      draftUi.packCardBackFaces.clear();
    }
    [...draftUi.selectedPackZones.keys()].forEach((idx) => {
      if (idx < 0 || idx >= active.cards.length) {
        draftUi.selectedPackZones.delete(idx);
      }
    });

    const ctx = getActivePackInteractionState();
    const canPick = Boolean(ctx?.canPick);
    if (!canPick) {
      draftUi.selectedPackZones.clear();
    }

    renderPackCardsInPlace(activePackID, active.cards, canPick);
    if (pickButton) {
      pickButton.textContent = 'Pick';
    }
    if (packEmptyEl) packEmptyEl.hidden = true;
    if (packContentEl) packContentEl.hidden = false;

    syncPackColumnWidth(packRoot);
    updatePackScrollIndicators();
    window.requestAnimationFrame(() => {
      updatePackScrollIndicators();
    });
    syncPackSelectionUiFromDom();
    syncSideboardModeUi();
  }

  async function connectSocket(roomId, seat, isReconnect = false) {
    clearReconnectTimer();
    draftUi.shouldReconnect = true;

    if (
      draftUi.socket
      && draftUi.socket.readyState === WebSocket.OPEN
      && draftUi.roomId === roomId
      && draftUi.seat === seat
    ) {
      draftUi.socket.send(JSON.stringify({ type: 'state' }));
      return;
    }

    if (draftUi.socket) {
      try {
        draftUi.socket.close();
      } catch (_) {
        // best effort
      }
      draftUi.socket = null;
    }

    draftUi.roomId = roomId;
    draftUi.seat = seat;
    if (!isReconnect) {
      draftUi.state = null;
      draftUi.reconnectAttempt = 0;
      draftUi.selectedPackID = '';
      draftUi.selectedPackZones.clear();
      draftUi.pendingDeckMutation = false;
      draftUi.pendingBasicsSet = false;
      closeBasicsDialog(true);
    }
    draftUi.pendingPick = false;
    draftUi.connected = false;
    if (isReconnect && draftUi.state) {
      updateConnectionIndicator();
    } else {
      updateUIFromState();
    }

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${location.host}/api/draft/ws?room=${encodeURIComponent(roomId)}&seat=${encodeURIComponent(String(seat))}`;
    const socket = new WebSocket(wsUrl);
    draftUi.socket = socket;

    socket.addEventListener('open', () => {
      draftUi.connected = true;
      draftUi.reconnectAttempt = 0;
      updateConnectionIndicator();
    });

    socket.addEventListener('close', () => {
      if (draftUi.socket !== socket) return;
      draftUi.connected = false;
      draftUi.pendingPick = false;
      draftUi.socket = null;
      if (draftUi.state) {
        updateConnectionIndicator();
      } else {
        updateUIFromState();
      }
      if (!draftUi.shouldReconnect) {
        return;
      }
      scheduleReconnect();
    });

    socket.addEventListener('message', (event) => {
      if (draftUi.socket !== socket) return;
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (
        msg.type === 'state'
        || msg.type === 'pick_accepted'
        || msg.type === 'move_accepted'
        || msg.type === 'set_basics_accepted'
      ) {
        if (msg.state) {
          draftUi.state = msg.state;
        }
        draftUi.pendingPick = false;
        draftUi.pendingDeckMutation = false;
        if (msg.type === 'set_basics_accepted') {
          draftUi.pendingBasicsSet = false;
          closeBasicsDialog(true);
        }
      } else if (msg.type === 'draft_completed') {
        draftUi.pendingPick = false;
        draftUi.pendingDeckMutation = false;
      } else if (msg.type === 'seat_occupied' || msg.type === 'room_missing') {
        draftUi.pendingPick = false;
        draftUi.pendingDeckMutation = false;
        draftUi.pendingBasicsSet = false;
        draftUi.shouldReconnect = false;
        clearReconnectTimer();
        teardownSocket();
        clearRoomSelection();
        if (typeof onLobbyRequested === 'function') {
          onLobbyRequested();
        }
        return;
      } else if (msg.type === 'error') {
        draftUi.pendingPick = false;
        draftUi.pendingDeckMutation = false;
        draftUi.pendingBasicsSet = false;
      }
      updateUIFromState();
    });
  }

  function render() {
    if (!ui.draftPane || !hasActiveRoom()) return false;

    const roomName = String(draftUi.roomId || '').trim();
    const cubeName = roomDisplayName();
    ui.draftPane.innerHTML = `
      <div class="draft-room">
        <div class="draft-panel draft-status-panel">
          <div class="draft-status-head">
            <div class="draft-status-room">${escapeHtml(roomName)}</div>
            <div class="draft-status-cube">${escapeHtml(cubeName)}</div>
          </div>
          <div class="draft-status-actions-row">
            <div class="draft-status-actions">
              <button type="button" class="action-button button-standard draft-lobby-button" id="draft-back-lobby" aria-label="Back to lobby">⬅️ Lobby</button>
              <button type="button" class="action-button button-standard draft-lobby-button" id="draft-open-cube" aria-label="Open cube battlebox">📚 List</button>
            </div>
            <div class="draft-status-meta">
              <div id="draft-seat-label" class="draft-status-seat">${formatSeatLabel(draftUi.seat, 0)}</div>
              <span class="draft-status-divider" aria-hidden="true">·</span>
              <span id="draft-connection-dot" class="draft-connection-dot is-offline" role="status" aria-label="Disconnected" title="Disconnected"></span>
            </div>
          </div>
        </div>

        <div class="draft-panel">
          <h3 class="panel-title draft-panel-title">Pack</h3>
          <div class="draft-pack-info-row">
            <div class="draft-pack-status-row">
              <div id="draft-pack-label" class="draft-pack-pick">Pack -/-</div>
              <span class="draft-status-divider" aria-hidden="true">·</span>
              <div id="draft-pick-label" class="draft-pack-pick">Pick -/-</div>
              <span id="draft-waiting-divider" class="draft-status-divider" aria-hidden="true" hidden>·</span>
              <div id="draft-waiting-label" class="draft-pack-pick" hidden>Waiting...</div>
            </div>
            <button type="button" class="action-button button-standard draft-pick-confirm-button" id="draft-pick-submit" disabled>
              Pick
            </button>
          </div>
          <div id="draft-pack-cards">
            <div id="draft-pack-empty" class="draft-empty">Waiting for state...</div>
            <div id="draft-pack-content" hidden>
              <div class="draft-pack-scroll-wrap">
                <div id="draft-pack-scroll-left" class="draft-pack-scroll-indicator draft-pack-scroll-indicator-left" aria-hidden="true" hidden>◀</div>
                <div class="draft-pack-scroll">
                  <div id="draft-pack-grid" class="draft-pack-grid"></div>
                </div>
                <div id="draft-pack-scroll-right" class="draft-pack-scroll-indicator draft-pack-scroll-indicator-right" aria-hidden="true" hidden>▶</div>
              </div>
            </div>
          </div>
        </div>

        <div class="draft-panel">
          <h3 class="panel-title draft-panel-title">Picks</h3>
          <div id="draft-picks-cards"></div>
          <div class="draft-picks-toolbar">
            <button type="button" class="action-button button-standard draft-sideboard-mode-button" id="draft-toggle-sideboard-mode" aria-pressed="false">
              Sideboard ↔️
            </button>
            <button type="button" class="action-button button-standard draft-picks-toolbar-button" id="draft-sample-hand">
              Sample Hand
            </button>
            <button type="button" class="action-button button-standard draft-picks-toolbar-button" id="draft-basics">
              Basics
            </button>
          </div>
        </div>

        <div id="draft-basics-overlay" class="draft-basics-overlay" hidden>
          <div class="draft-basics-backdrop"></div>
          <div class="draft-basics-dialog" role="dialog" aria-modal="true" aria-label="Basic lands selector">
            <div class="panel-title draft-basics-title">Basic Lands</div>
            <div class="draft-basics-grid">
              ${renderDraftBasicsPickerCards(draftUi.roomDeckPrintings)}
            </div>
            <div class="draft-basics-actions">
              <button type="button" class="action-button button-standard draft-basics-action-button" id="draft-basics-close">
                Close
              </button>
              <button type="button" class="action-button button-standard draft-basics-action-button" id="draft-basics-set">
                Set
              </button>
            </div>
            <div id="draft-basics-status" class="draft-basics-status" aria-live="polite" hidden></div>
          </div>
        </div>
      </div>
    `;

    const backButton = ui.draftPane.querySelector('#draft-back-lobby');
    if (backButton) {
      backButton.addEventListener('click', () => {
        leaveRoom();
      });
    }
    const cubeButton = ui.draftPane.querySelector('#draft-open-cube');
    if (cubeButton) {
      cubeButton.addEventListener('click', () => {
        const cubeDeckSlug = draftUi.roomDeckSlug;
        if (typeof onCubeRequested === 'function') {
          onCubeRequested(cubeDeckSlug);
        }
      });
    }
    syncSideboardModeUi();
    bindPackInteractions();
    syncBasicsDialogUi();

    void connectSocket(draftUi.roomId, draftUi.seat);
    updateUIFromState();
    return true;
  }

  return {
    hasActiveRoom,
    openRoom,
    render,
    leaveRoom,
    teardown,
  };
}
