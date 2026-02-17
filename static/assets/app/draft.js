import { cardFaceImageUrl, dfcFlipControlMarkup } from './cardFaces.js';
import { renderDecklistGrid as renderSharedDecklistGrid } from './decklist.js';
import { isDoubleFacedCard, normalizeName, scryfallImageUrlByName } from './utils.js';

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
    const printing = String(meta?.printing || printings?.[key] || '');
    aggregated.set(key, {
      qty: 1,
      name: String(meta?.name || rawName),
      type: String(meta?.type || ''),
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
    selectedPackIndexes: new Set(),
    packCardBackFaces: new Map(),
    lastPicksHtml: '',
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
    draftUi.selectedPackID = '';
    draftUi.selectedPackIndexes.clear();
    draftUi.packCardBackFaces.clear();
    draftUi.lastPicksHtml = '';
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
    draftUi.selectedPackID = '';
    draftUi.selectedPackIndexes.clear();
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
    draftUi.selectedPackIndexes.clear();
    draftUi.packCardBackFaces.clear();
    draftUi.lastPicksHtml = '';
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

  function syncPackSelectionUi(cardButtons, pickButtons, canPick, expectedPicks) {
    const required = Number.isFinite(expectedPicks) && expectedPicks > 0 ? expectedPicks : 1;
    const selectedCount = draftUi.selectedPackIndexes.size;
    cardButtons.forEach((btn) => {
      const idx = Number.parseInt(btn.dataset.index || '-1', 10);
      const isSelected = draftUi.selectedPackIndexes.has(idx);
      const lockUnselected = canPick && selectedCount >= required && !isSelected;
      const disabled = !canPick;
      btn.classList.toggle('is-selected', isSelected);
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
    pickButtons.forEach((button) => {
      button.disabled = !canPick || selectedCount !== required;
    });
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
    const mainboardButton = ui.draftPane.querySelector('#draft-pick-mainboard');
    const sideboardButton = ui.draftPane.querySelector('#draft-pick-sideboard');
    const pickButtons = [mainboardButton, sideboardButton].filter(Boolean);
    const ctx = getActivePackInteractionState();
    if (!ctx) {
      syncPackSelectionUi(cardButtons, pickButtons, false, 1);
      return;
    }
    syncPackSelectionUi(cardButtons, pickButtons, ctx.canPick, ctx.expectedPicks);
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

  function submitSelectedPicks(zone) {
    const ctx = getActivePackInteractionState();
    if (!ctx || !ctx.canPick) return;
    const selectedIndexes = [...draftUi.selectedPackIndexes].sort((a, b) => a - b);
    if (selectedIndexes.length !== ctx.expectedPicks) return;
    const picks = selectedIndexes.map((idx) => ({
      card_name: ctx.active.cards[idx],
      zone,
    }));
    if (!picks.every((pick) => pick && pick.card_name)) return;
    if (!draftUi.socket || draftUi.socket.readyState !== WebSocket.OPEN) return;
    const nextSeq = Number.parseInt(String(ctx.state.next_seq || 1), 10) || 1;
    draftUi.pendingPick = true;
    draftUi.selectedPackIndexes.clear();
    syncPackSelectionUiFromDom();
    updateUIFromState();
    draftUi.socket.send(JSON.stringify({
      type: 'pick',
      seq: nextSeq,
      pack_id: ctx.active.pack_id,
      picks,
    }));
  }

  function handlePackCardToggle(index) {
    const ctx = getActivePackInteractionState();
    if (!ctx || !ctx.canPick) return;
    if (index < 0 || index >= ctx.active.cards.length) return;
    if (draftUi.selectedPackIndexes.has(index)) {
      draftUi.selectedPackIndexes.delete(index);
    } else {
      if (draftUi.selectedPackIndexes.size >= ctx.expectedPicks) return;
      draftUi.selectedPackIndexes.add(index);
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

      const mainboardButton = target.closest('#draft-pick-mainboard');
      if (mainboardButton && packRoot.contains(mainboardButton)) {
        submitSelectedPicks('mainboard');
        return;
      }
      const sideboardButton = target.closest('#draft-pick-sideboard');
      if (sideboardButton && packRoot.contains(sideboardButton)) {
        submitSelectedPicks('sideboard');
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
  }

  function updateUIFromState() {
    if (!ui.draftPane || !hasActiveRoom()) return;
    const seatInfoEl = ui.draftPane.querySelector('#draft-seat-label');
    const packInfoEl = ui.draftPane.querySelector('#draft-pack-label');
    const pickInfoEl = ui.draftPane.querySelector('#draft-pick-label');
    const packRoot = ui.draftPane.querySelector('#draft-pack-cards');
    const packEmptyEl = ui.draftPane.querySelector('#draft-pack-empty');
    const packContentEl = ui.draftPane.querySelector('#draft-pack-content');
    const mainboardButton = ui.draftPane.querySelector('#draft-pick-mainboard');
    const sideboardButton = ui.draftPane.querySelector('#draft-pick-sideboard');
    const picksEl = ui.draftPane.querySelector('#draft-picks-cards');

    updateConnectionIndicator();

    const state = draftUi.state;
    if (!state) {
      draftUi.selectedPackID = '';
      draftUi.selectedPackIndexes.clear();
      if (seatInfoEl) seatInfoEl.textContent = formatSeatLabel(draftUi.seat, 0);
      if (packInfoEl) packInfoEl.textContent = 'Pack -/-';
      if (pickInfoEl) pickInfoEl.textContent = 'Pick -/-';
      if (packEmptyEl) {
        packEmptyEl.hidden = false;
        packEmptyEl.textContent = 'Waiting for state...';
      }
      if (packContentEl) packContentEl.hidden = true;
      updatePackScrollIndicators();
      if (mainboardButton) {
        mainboardButton.textContent = 'Mainboard (1)';
        mainboardButton.disabled = true;
      }
      if (sideboardButton) {
        sideboardButton.textContent = 'Sideboard (1)';
        sideboardButton.disabled = true;
      }
      if (picksEl) {
        picksEl.innerHTML = '';
        draftUi.lastPicksHtml = '';
      }
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
      const basePickLabel = formatPickProgressLabel(
        state.pick_no,
        draftUi.roomPickTotal,
        state.expected_picks,
      );
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
      pickInfoEl.textContent = waitingOnTable ? `${basePickLabel} · Waiting...` : basePickLabel;
    }

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

    if (!packRoot) return;
    const active = state.active_pack;
    if (!active || !Array.isArray(active.cards) || active.cards.length === 0) {
      draftUi.selectedPackID = '';
      draftUi.selectedPackIndexes.clear();
      if (packEmptyEl) {
        packEmptyEl.hidden = false;
        packEmptyEl.textContent = state.state === 'done'
          ? 'Draft complete.'
          : 'Waiting for next pack...';
      }
      if (packContentEl) packContentEl.hidden = true;
      updatePackScrollIndicators();
      if (mainboardButton) {
        mainboardButton.textContent = 'Mainboard (1)';
        mainboardButton.disabled = true;
      }
      if (sideboardButton) {
        sideboardButton.textContent = 'Sideboard (1)';
        sideboardButton.disabled = true;
      }
      return;
    }

    const activePackID = String(active.pack_id || '');
    if (draftUi.selectedPackID !== activePackID) {
      draftUi.selectedPackID = activePackID;
      draftUi.selectedPackIndexes.clear();
      draftUi.packCardBackFaces.clear();
    }
    [...draftUi.selectedPackIndexes].forEach((idx) => {
      if (idx < 0 || idx >= active.cards.length) {
        draftUi.selectedPackIndexes.delete(idx);
      }
    });

    const ctx = getActivePackInteractionState();
    const canPick = Boolean(ctx?.canPick);
    const expectedPicks = ctx?.expectedPicks || 1;
    if (!canPick) {
      draftUi.selectedPackIndexes.clear();
    }

    renderPackCardsInPlace(activePackID, active.cards, canPick);
    if (mainboardButton) {
      mainboardButton.textContent = `Mainboard (${expectedPicks})`;
    }
    if (sideboardButton) {
      sideboardButton.textContent = `Sideboard (${expectedPicks})`;
    }
    if (packEmptyEl) packEmptyEl.hidden = true;
    if (packContentEl) packContentEl.hidden = false;

    syncPackColumnWidth(packRoot);
    updatePackScrollIndicators();
    window.requestAnimationFrame(() => {
      updatePackScrollIndicators();
    });
    syncPackSelectionUiFromDom();
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
      draftUi.selectedPackIndexes.clear();
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

      if (msg.type === 'state' || msg.type === 'pick_accepted') {
        if (msg.state) {
          draftUi.state = msg.state;
        }
        draftUi.pendingPick = false;
      } else if (msg.type === 'draft_completed') {
        draftUi.pendingPick = false;
      } else if (msg.type === 'seat_occupied' || msg.type === 'room_missing') {
        draftUi.pendingPick = false;
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
            <div id="draft-pack-label" class="draft-pack-pick">Pack -</div>
            <span class="draft-status-divider" aria-hidden="true">·</span>
            <div id="draft-pick-label" class="draft-pack-pick">Pick -</div>
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
              <div class="draft-pack-actions">
                <button type="button" class="action-button button-standard draft-pick-confirm-button" id="draft-pick-mainboard" disabled>
                  Mainboard (1)
                </button>
                <button type="button" class="action-button button-standard draft-pick-confirm-button" id="draft-pick-sideboard" disabled>
                  Sideboard (1)
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="draft-panel">
          <h3 class="panel-title draft-panel-title">Picks</h3>
          <div id="draft-picks-cards"></div>
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
    bindPackInteractions();

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
