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
    seat: 0,
    state: null,
    connected: false,
    status: '',
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
    draftUi.seat = 0;
    draftUi.state = null;
    draftUi.pendingPick = false;
    draftUi.selectedPackID = '';
    draftUi.selectedPackIndex = -1;
  }

  function scheduleReconnect() {
    if (!draftUi.shouldReconnect || !draftUi.roomId) return;
    clearReconnectTimer();
    const delay = reconnectDelayMs(draftUi.reconnectAttempt);
    draftUi.reconnectAttempt += 1;
    const label = delay >= 1000 ? `${Math.round(delay / 1000)}s` : `${delay}ms`;
    draftUi.status = `Disconnected. Reconnecting in ${label}...`;
    updateUIFromState();
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

  function openRoom(roomId, seat) {
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) return;
    draftUi.roomId = normalizedRoomId;
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
    const statusEl = ui.draftPane.querySelector('#draft-status');
    const packInfoEl = ui.draftPane.querySelector('#draft-pack-info');
    const packEl = ui.draftPane.querySelector('#draft-pack-cards');
    const poolEl = ui.draftPane.querySelector('#draft-pool-cards');

    if (statusEl) {
      statusEl.textContent = draftUi.status || (draftUi.connected ? 'Connected' : 'Disconnected');
    }

    const state = draftUi.state;
    if (!state) {
      draftUi.selectedPackID = '';
      draftUi.selectedPackIndex = -1;
      if (packInfoEl) packInfoEl.textContent = '';
      if (packEl) packEl.innerHTML = '<div class="draft-empty">Waiting for state...</div>';
      if (poolEl) poolEl.innerHTML = '';
      return;
    }

    if (packInfoEl) {
      packInfoEl.textContent = `Pack ${state.pack_no + 1} · Pick ${state.pick_no + 1}`;
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
      <div id="draft-pack-grid-wrap" class="draft-pack-grid-wrap">
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
      </div>
      <div class="draft-pack-actions">
        <button type="button" class="action-button draft-pick-confirm-button" id="draft-pick-selected" ${canPick && draftUi.selectedPackIndex >= 0 ? '' : 'disabled'}>
          Pick selected card
        </button>
      </div>
    `;
    syncPackGridViewport(active.cards.length);

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

  function syncPackGridViewport(cardCount) {
    if (!ui.draftPane) return;
    const gridWrap = ui.draftPane.querySelector('#draft-pack-grid-wrap');
    const grid = ui.draftPane.querySelector('#draft-pack-grid');
    if (!(gridWrap instanceof HTMLElement) || !(grid instanceof HTMLElement)) return;

    if (cardCount <= 9) {
      gridWrap.style.maxHeight = 'none';
      gridWrap.style.overflowY = 'visible';
      gridWrap.scrollTop = 0;
      return;
    }

    const firstCard = grid.querySelector('.draft-pack-card');
    if (!(firstCard instanceof HTMLElement)) return;
    const cardHeight = firstCard.getBoundingClientRect().height;
    if (!cardHeight) {
      window.requestAnimationFrame(() => {
        syncPackGridViewport(cardCount);
      });
      return;
    }

    const gridStyles = window.getComputedStyle(grid);
    const rowGap = Number.parseFloat(gridStyles.rowGap || gridStyles.gap || '0') || 0;
    const maxHeight = (cardHeight * 3) + (rowGap * 2);
    gridWrap.style.maxHeight = `${maxHeight}px`;
    gridWrap.style.overflowY = 'auto';
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
    draftUi.status = isReconnect ? 'Reconnecting...' : 'Connecting...';
    draftUi.connected = false;
    updateUIFromState();

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${location.host}/api/draft/ws?room=${encodeURIComponent(roomId)}&seat=${encodeURIComponent(String(seat))}`;
    const socket = new WebSocket(wsUrl);
    draftUi.socket = socket;

    socket.addEventListener('open', () => {
      draftUi.connected = true;
      draftUi.reconnectAttempt = 0;
      draftUi.status = 'Connected';
      updateUIFromState();
    });

    socket.addEventListener('close', () => {
      if (draftUi.socket !== socket) return;
      draftUi.connected = false;
      draftUi.pendingPick = false;
      draftUi.socket = null;
      if (!draftUi.shouldReconnect) {
        draftUi.status = 'Disconnected';
        updateUIFromState();
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
      } else if (msg.type === 'round_advanced') {
        draftUi.status = `Round advanced: pack ${Number(msg.pack_no || 0) + 1}, pick ${Number(msg.pick_no || 0) + 1}`;
      } else if (msg.type === 'draft_completed') {
        draftUi.status = 'Draft complete';
        draftUi.pendingPick = false;
      } else if (msg.type === 'seat_occupied' || msg.type === 'room_missing') {
        draftUi.pendingPick = false;
        draftUi.shouldReconnect = false;
        clearReconnectTimer();
        draftUi.status = msg.error || (msg.type === 'room_missing' ? 'Room not found' : 'Seat occupied');
        updateUIFromState();
        teardownSocket();
        clearRoomSelection();
        if (typeof onLobbyRequested === 'function') {
          onLobbyRequested();
        }
        return;
      } else if (msg.type === 'error') {
        draftUi.status = msg.error || 'Draft error';
        draftUi.pendingPick = false;
      }
      updateUIFromState();
    });
  }

  function render() {
    if (!ui.draftPane || !hasActiveRoom()) return false;

    ui.draftPane.innerHTML = `
      <div class="draft-room">
        <div class="draft-meta">
          <div><strong>Room:</strong> ${escapeHtml(draftUi.roomId)}</div>
          <div><strong>Seat:</strong> ${draftUi.seat + 1}</div>
          <button type="button" class="action-button" id="draft-back-lobby">Lobby</button>
          <div id="draft-status" class="draft-status">Connecting...</div>
        </div>
        <div id="draft-pack-info" class="draft-pack-info"></div>
        <div class="draft-grid">
          <div class="draft-col">
            <h3>Pack</h3>
            <div id="draft-pack-cards"></div>
          </div>
          <div class="draft-col">
            <h3>Pool</h3>
            <div id="draft-pool-cards"></div>
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
