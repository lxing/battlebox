function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getNamedCardImageUrl(cardName) {
  const name = String(cardName || '').trim();
  if (!name) return '';
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
}

function normalizeSeat(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function createDraftController({
  ui,
  onLobbyRequested,
}) {
  const draftUi = {
    socket: null,
    roomId: '',
    roomLabel: '',
    seat: 0,
    state: null,
    connected: false,
    pendingPick: false,
    reconnectAttempt: 0,
    reconnectTimer: null,
    shouldReconnect: false,
    selectedPackID: '',
    selectedPackIndex: -1,
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
    draftUi.roomLabel = '';
    draftUi.seat = 0;
    draftUi.state = null;
    draftUi.pendingPick = false;
    draftUi.selectedPackID = '';
    draftUi.selectedPackIndex = -1;
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
    draftUi.selectedPackIndex = -1;
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

  function openRoom(roomId, seat, roomLabel = '') {
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) return;
    draftUi.roomId = normalizedRoomId;
    draftUi.roomLabel = String(roomLabel || '').trim();
    draftUi.seat = normalizeSeat(seat);
    draftUi.state = null;
    draftUi.reconnectAttempt = 0;
    draftUi.selectedPackID = '';
    draftUi.selectedPackIndex = -1;
  }

  function syncPackSelectionUi(cardButtons, pickButton, canPick) {
    const selectedIndex = draftUi.selectedPackIndex;
    cardButtons.forEach((btn) => {
      const idx = Number.parseInt(btn.dataset.index || '-1', 10);
      btn.classList.toggle('is-selected', idx === selectedIndex);
    });
    if (pickButton) {
      pickButton.disabled = !canPick || selectedIndex < 0;
    }
  }

  function updateUIFromState() {
    if (!ui.draftPane || !hasActiveRoom()) return;
    const packInfoEl = ui.draftPane.querySelector('#draft-pack-pick');
    const packEl = ui.draftPane.querySelector('#draft-pack-cards');
    const poolEl = ui.draftPane.querySelector('#draft-pool-cards');

    updateConnectionIndicator();

    const state = draftUi.state;
    if (!state) {
      draftUi.selectedPackID = '';
      draftUi.selectedPackIndex = -1;
      if (packInfoEl) packInfoEl.textContent = '· Pack - · Pick -';
      if (packEl) packEl.innerHTML = '<div class="draft-empty">Waiting for state...</div>';
      if (poolEl) poolEl.innerHTML = '';
      return;
    }

    if (packInfoEl) {
      packInfoEl.textContent = `· Pack ${state.pack_no + 1} · Pick ${state.pick_no + 1}`;
    }

    if (poolEl) {
      const rows = (state.pool || []).map((name) => `<li>${name}</li>`).join('');
      poolEl.innerHTML = rows ? `<ul class="draft-pool-list">${rows}</ul>` : '<div class="draft-empty">No picks yet.</div>';
    }

    if (!packEl) return;
    const active = state.active_pack;
    if (!active || !Array.isArray(active.cards) || active.cards.length === 0) {
      draftUi.selectedPackID = '';
      draftUi.selectedPackIndex = -1;
      packEl.innerHTML = state.state === 'done'
        ? '<div class="draft-empty">Draft complete.</div>'
        : '<div class="draft-empty">Waiting for next pack...</div>';
      return;
    }

    const activePackID = String(active.pack_id || '');
    if (draftUi.selectedPackID !== activePackID) {
      draftUi.selectedPackID = activePackID;
      draftUi.selectedPackIndex = -1;
    }
    if (draftUi.selectedPackIndex >= active.cards.length) {
      draftUi.selectedPackIndex = -1;
    }

    const canPick = Boolean(state.can_pick) && !draftUi.pendingPick;
    packEl.innerHTML = `
      <div id="draft-pack-grid" class="draft-pack-grid">
        ${active.cards.map((name, idx) => {
    const safeName = escapeHtml(name);
    const imageUrl = getNamedCardImageUrl(name);
    return `
          <button
            type="button"
            class="action-button draft-pack-card${idx === draftUi.selectedPackIndex ? ' is-selected' : ''}"
            data-index="${idx}"
            ${canPick ? '' : 'disabled'}
            title="${safeName}"
            aria-label="${safeName}"
          >
            <span class="draft-pack-card-frame">
              ${imageUrl ? `<img src="${imageUrl}" alt="${safeName}" loading="lazy">` : `<span class="draft-pack-card-fallback">${safeName}</span>`}
            </span>
          </button>
        `;
  }).join('')}
      </div>
      <div class="draft-pack-actions">
        <button type="button" class="action-button button-standard draft-pick-confirm-button" id="draft-pick-selected" ${canPick && draftUi.selectedPackIndex >= 0 ? '' : 'disabled'}>
          Pick selected card
        </button>
      </div>
    `;

    const cardButtons = [...packEl.querySelectorAll('.draft-pack-card')];
    const pickButton = packEl.querySelector('#draft-pick-selected');

    if (canPick) {
      cardButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number.parseInt(btn.dataset.index || '-1', 10);
          if (i < 0 || i >= active.cards.length) return;
          draftUi.selectedPackIndex = i;
          syncPackSelectionUi(cardButtons, pickButton, canPick);
        });
      });
    }

    if (pickButton) {
      pickButton.addEventListener('click', () => {
        const i = draftUi.selectedPackIndex;
        const chosen = active.cards[i];
        if (!canPick || !chosen || !draftUi.socket || draftUi.socket.readyState !== WebSocket.OPEN) return;
        const nextSeq = Number.parseInt(String(state.next_seq || 1), 10) || 1;
        draftUi.pendingPick = true;
        draftUi.selectedPackIndex = -1;
        syncPackSelectionUi(cardButtons, pickButton, false);
        updateUIFromState();
        draftUi.socket.send(JSON.stringify({
          type: 'pick',
          seq: nextSeq,
          pack_id: active.pack_id,
          card_name: chosen,
        }));
      });
    }

    if (!canPick) {
      syncPackSelectionUi(cardButtons, pickButton, false);
    } else {
      syncPackSelectionUi(cardButtons, pickButton, true);
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
      draftUi.selectedPackIndex = -1;
    }
    draftUi.pendingPick = false;
    draftUi.connected = false;
    updateUIFromState();

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${location.host}/api/draft/ws?room=${encodeURIComponent(roomId)}&seat=${encodeURIComponent(String(seat))}`;
    const socket = new WebSocket(wsUrl);
    draftUi.socket = socket;

    socket.addEventListener('open', () => {
      draftUi.connected = true;
      draftUi.reconnectAttempt = 0;
      updateUIFromState();
    });

    socket.addEventListener('close', () => {
      if (draftUi.socket !== socket) return;
      draftUi.connected = false;
      draftUi.pendingPick = false;
      draftUi.socket = null;
      updateUIFromState();
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
            <div class="draft-status-name">${escapeHtml(draftUi.roomLabel || draftUi.roomId)}</div>
            <div class="draft-status-seat">Seat ${draftUi.seat + 1}</div>
            <div id="draft-pack-pick" class="draft-pack-pick">· Pack - · Pick -</div>
            <span class="draft-status-divider" aria-hidden="true">·</span>
            <span id="draft-connection-dot" class="draft-connection-dot is-offline" role="status" aria-label="Disconnected" title="Disconnected"></span>
          </div>
        </div>

        <div class="draft-panel">
          <h3 class="panel-title draft-panel-title">Pack</h3>
          <div id="draft-pack-cards"></div>
        </div>

        <div class="draft-panel">
          <h3 class="panel-title draft-panel-title">Pool</h3>
          <div id="draft-pool-cards"></div>
        </div>
      </div>
    `;

    const backButton = ui.draftPane.querySelector('#draft-back-lobby');
    if (backButton) {
      backButton.addEventListener('click', () => {
        leaveRoom();
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
