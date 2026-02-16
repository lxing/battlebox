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

function normalizeSeat(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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
}) {
  const draftUi = {
    socket: null,
    roomId: '',
    roomDeckSlug: '',
    roomDeckName: '',
    roomDeckPrintings: {},
    roomDeckDoubleFaced: {},
    roomDeckCardMeta: {},
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
    draftUi.seat = 0;
    draftUi.state = null;
    draftUi.pendingPick = false;
    draftUi.selectedPackID = '';
    draftUi.selectedPackIndexes.clear();
    draftUi.packCardBackFaces.clear();
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
  ) {
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) return;
    draftUi.roomId = normalizedRoomId;
    draftUi.roomDeckSlug = normalizeDraftSlug(roomDeckSlug);
    draftUi.roomDeckName = String(roomDeckName || '').trim();
    draftUi.roomDeckPrintings = roomDeckPrintings && typeof roomDeckPrintings === 'object' ? roomDeckPrintings : {};
    draftUi.roomDeckDoubleFaced = roomDeckDoubleFaced && typeof roomDeckDoubleFaced === 'object' ? roomDeckDoubleFaced : {};
    draftUi.roomDeckCardMeta = roomDeckCardMeta && typeof roomDeckCardMeta === 'object' ? roomDeckCardMeta : {};
    draftUi.seat = normalizeSeat(seat);
    draftUi.state = null;
    draftUi.reconnectAttempt = 0;
    draftUi.selectedPackID = '';
    draftUi.selectedPackIndexes.clear();
    draftUi.packCardBackFaces.clear();
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
      btn.classList.toggle('is-selected', draftUi.selectedPackIndexes.has(idx));
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

  function updateUIFromState() {
    if (!ui.draftPane || !hasActiveRoom()) return;
    const packInfoEl = ui.draftPane.querySelector('#draft-pack-label');
    const pickInfoEl = ui.draftPane.querySelector('#draft-pick-label');
    const packEl = ui.draftPane.querySelector('#draft-pack-cards');
    const picksEl = ui.draftPane.querySelector('#draft-picks-cards');

    updateConnectionIndicator();

    const state = draftUi.state;
    if (!state) {
      draftUi.selectedPackID = '';
      draftUi.selectedPackIndexes.clear();
      if (packInfoEl) packInfoEl.textContent = 'Pack -';
      if (pickInfoEl) pickInfoEl.textContent = 'Pick -';
      if (packEl) packEl.innerHTML = '<div class="draft-empty">Waiting for state...</div>';
      if (picksEl) picksEl.innerHTML = '';
      return;
    }

    if (packInfoEl) {
      packInfoEl.textContent = `Pack ${state.pack_no + 1}`;
    }
    if (pickInfoEl) {
      pickInfoEl.textContent = `Pick ${state.pick_no + 1}`;
    }

    if (picksEl) {
      picksEl.innerHTML = renderDraftPicksDecklist(
        state.picks,
        draftUi.roomDeckCardMeta,
        draftUi.roomDeckPrintings,
        draftUi.roomDeckDoubleFaced,
      );
    }

    if (!packEl) return;
    const active = state.active_pack;
    if (!active || !Array.isArray(active.cards) || active.cards.length === 0) {
      draftUi.selectedPackID = '';
      draftUi.selectedPackIndexes.clear();
      packEl.innerHTML = state.state === 'done'
        ? '<div class="draft-empty">Draft complete.</div>'
        : '<div class="draft-empty">Waiting for next pack...</div>';
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
    const canPick = Boolean(state.can_pick) && !draftUi.pendingPick;
    const expectedPicks = Math.max(1, Number.parseInt(String(state.expected_picks || 1), 10) || 1);
    if (!canPick) {
      draftUi.selectedPackIndexes.clear();
    }
    packEl.innerHTML = `
      <div class="draft-pack-scroll">
        <div id="draft-pack-grid" class="draft-pack-grid">
          ${active.cards.map((name, idx) => {
    const safeName = escapeHtml(name);
    const doubleFaced = isDoubleFacedCard(name, draftUi.roomDeckDoubleFaced);
    const faceKey = packCardFaceKey(activePackID, idx);
    const showingBack = doubleFaced && draftUi.packCardBackFaces.get(faceKey) === true;
    const imageUrl = getDraftCardImageUrl(name, draftUi.roomDeckPrintings, showingBack);
    const faceLabel = doubleFaced ? (showingBack ? ' (back face)' : ' (front face)') : '';
    const flipControl = doubleFaced
      ? dfcFlipControlMarkup(
        `data-draft-card-flip="1" data-draft-card-index="${idx}"`,
        showingBack ? 'Show front face' : 'Show back face',
      )
      : '';
    return `
          <button
            type="button"
            class="action-button draft-pack-card${draftUi.selectedPackIndexes.has(idx) ? ' is-selected' : ''}"
            data-index="${idx}"
            ${canPick ? '' : 'aria-disabled="true"'}
            title="${safeName}"
            aria-label="${safeName}${faceLabel}"
          >
            <span class="draft-pack-card-frame">
              ${flipControl}
              ${imageUrl ? `<img src="${imageUrl}" alt="${safeName}${faceLabel}" loading="lazy">` : `<span class="draft-pack-card-fallback">${safeName}${faceLabel}</span>`}
            </span>
          </button>
        `;
  }).join('')}
        </div>
      </div>
      <div class="draft-pack-actions">
        <button type="button" class="action-button button-standard draft-pick-confirm-button" id="draft-pick-mainboard" ${canPick && draftUi.selectedPackIndexes.size === expectedPicks ? '' : 'disabled'}>
          Mainboard (${expectedPicks})
        </button>
        <button type="button" class="action-button button-standard draft-pick-confirm-button" id="draft-pick-sideboard" ${canPick && draftUi.selectedPackIndexes.size === expectedPicks ? '' : 'disabled'}>
          Sideboard (${expectedPicks})
        </button>
      </div>
    `;
    syncPackColumnWidth(packEl);

    const cardButtons = [...packEl.querySelectorAll('.draft-pack-card')];
    const cardFlipControls = [...packEl.querySelectorAll('[data-draft-card-flip="1"]')];
    const mainboardButton = packEl.querySelector('#draft-pick-mainboard');
    const sideboardButton = packEl.querySelector('#draft-pick-sideboard');
    const pickButtons = [mainboardButton, sideboardButton].filter(Boolean);

    cardButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!canPick) return;
        const i = Number.parseInt(btn.dataset.index || '-1', 10);
        if (i < 0 || i >= active.cards.length) return;
        if (draftUi.selectedPackIndexes.has(i)) {
          draftUi.selectedPackIndexes.delete(i);
        } else {
          draftUi.selectedPackIndexes.add(i);
        }
        syncPackSelectionUi(cardButtons, pickButtons, canPick, expectedPicks);
      });
    });

    cardFlipControls.forEach((control) => {
      control.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const i = Number.parseInt(control.dataset.draftCardIndex || '-1', 10);
        if (i < 0 || i >= active.cards.length) return;
        const cardName = active.cards[i];
        if (!isDoubleFacedCard(cardName, draftUi.roomDeckDoubleFaced)) return;
        const key = packCardFaceKey(activePackID, i);
        const next = !(draftUi.packCardBackFaces.get(key) === true);
        draftUi.packCardBackFaces.set(key, next);
        updateUIFromState();
      });
    });

    function sendPick(zone) {
      return () => {
        const selectedIndexes = [...draftUi.selectedPackIndexes].sort((a, b) => a - b);
        if (!canPick || selectedIndexes.length !== expectedPicks) return;
        const picks = selectedIndexes.map((idx) => ({
          card_name: active.cards[idx],
          zone,
        }));
        if (!picks.every((pick) => pick && pick.card_name)) return;
        if (!draftUi.socket || draftUi.socket.readyState !== WebSocket.OPEN) return;
        const nextSeq = Number.parseInt(String(state.next_seq || 1), 10) || 1;
        draftUi.pendingPick = true;
        draftUi.selectedPackIndexes.clear();
        syncPackSelectionUi(cardButtons, pickButtons, false, expectedPicks);
        updateUIFromState();
        draftUi.socket.send(JSON.stringify({
          type: 'pick',
          seq: nextSeq,
          pack_id: active.pack_id,
          picks,
        }));
      };
    }

    if (mainboardButton) {
      mainboardButton.addEventListener('click', sendPick('mainboard'));
    }
    if (sideboardButton) {
      sideboardButton.addEventListener('click', sendPick('sideboard'));
    }

    if (!canPick) {
      syncPackSelectionUi(cardButtons, pickButtons, false, expectedPicks);
    } else {
      syncPackSelectionUi(cardButtons, pickButtons, true, expectedPicks);
    }
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

    ui.draftPane.innerHTML = `
      <div class="draft-room">
        <div class="draft-panel draft-status-panel">
          <div class="draft-status-row">
            <button type="button" class="draft-lobby-button" id="draft-back-lobby" aria-label="Back to lobby">⬅️</button>
            <button type="button" class="draft-lobby-button" id="draft-open-cube" aria-label="Open cube battlebox">📚</button>
            <div class="draft-status-name">${escapeHtml(roomDisplayName())}</div>
            <div class="draft-status-seat">Seat ${draftUi.seat + 1}</div>
            <span class="draft-status-divider" aria-hidden="true">·</span>
            <div id="draft-pack-label" class="draft-pack-pick">Pack -</div>
            <span class="draft-status-divider" aria-hidden="true">·</span>
            <div id="draft-pick-label" class="draft-pack-pick">Pick -</div>
            <span class="draft-status-divider" aria-hidden="true">·</span>
            <span id="draft-connection-dot" class="draft-connection-dot is-offline" role="status" aria-label="Disconnected" title="Disconnected"></span>
          </div>
        </div>

        <div class="draft-panel">
          <h3 class="panel-title draft-panel-title">Pack</h3>
          <div id="draft-pack-cards"></div>
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
