import { normalizeName } from './utils.js';

function buildDraftDeckNames(deck) {
  const names = [];
  (Array.isArray(deck?.cards) ? deck.cards : []).forEach((card) => {
    const qty = Number.parseInt(String(card?.qty), 10) || 0;
    const name = String(card?.name || '').trim();
    if (!name || qty <= 0) return;
    for (let i = 0; i < qty; i += 1) names.push(name);
  });
  return names;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchDraftRooms() {
  const res = await fetch('/api/draft/rooms', {
    method: 'GET',
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `Failed to load rooms (${res.status})`);
  }
  const payload = await res.json();
  if (!payload || !Array.isArray(payload.rooms)) return [];
  return payload.rooms;
}

async function createDraftRoom(deck) {
  const deckNames = buildDraftDeckNames(deck);
  const res = await fetch('/api/draft/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deck: deckNames,
      label: deck?.name || '',
      pack_count: 7,
      pack_size: 8,
    }),
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `Failed to create room (${res.status})`);
  }
  const payload = await res.json();
  if (!payload || !payload.room_id) throw new Error('Missing room id');
  return payload;
}

export function createLobbyController({
  ui,
  loadBattlebox,
  draftController,
}) {
  const state = {
    eventSource: null,
    roomsList: null,
    refreshButton: null,
    currentDeckSlug: '',
  };

  function stopStream() {
    if (state.eventSource) {
      try {
        state.eventSource.close();
      } catch (_) {
        // best effort
      }
      state.eventSource = null;
    }
  }

  function teardown() {
    stopStream();
    state.roomsList = null;
    state.refreshButton = null;
  }

  function setPreferredDeckSlug(deckSlug) {
    state.currentDeckSlug = normalizeName(deckSlug || '');
  }

  function bindLobbySeatButtons(scope) {
    if (!scope) return;
    scope.querySelectorAll('[data-room-id][data-seat-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const roomID = String(button.dataset.roomId || '').trim();
        const roomLabel = String(button.dataset.roomLabel || '').trim();
        const seatRaw = Number.parseInt(String(button.dataset.seatId || '0'), 10);
        const seat = Number.isFinite(seatRaw) && seatRaw >= 0 ? seatRaw : 0;
        if (!roomID) return;
        draftController.openRoom(roomID, seat, roomLabel);
        void render(state.currentDeckSlug);
      });
    });
  }

  function renderRooms(rooms) {
    if (!state.roomsList) return;
    if (!Array.isArray(rooms) || rooms.length === 0) {
      state.roomsList.innerHTML = '<div class="aux-empty">No draft rooms yet.</div>';
      return;
    }

    state.roomsList.innerHTML = `
      <ul class="lobby-room-list">
        ${rooms.map((room) => {
    const seatCount = Math.max(0, Number.parseInt(String(room.seat_count || 0), 10) || 0);
    const occupiedSeatSet = new Set(
      (Array.isArray(room.occupied_seats) ? room.occupied_seats : [])
        .map((value) => Number.parseInt(String(value), 10))
        .filter((value) => Number.isFinite(value) && value >= 0),
    );
    const seatButtons = Array.from({ length: seatCount }, (_, idx) => {
      const occupied = occupiedSeatSet.has(idx);
      return `
          <button
            type="button"
            class="action-button button-standard lobby-join-button"
            data-room-id="${escapeHtml(room.room_id)}"
            data-room-label="${escapeHtml(room.label || '')}"
            data-seat-id="${idx}"
          ${occupied ? 'disabled aria-disabled="true"' : ''}
        >
          ${idx + 1}
        </button>
      `;
    }).join('');
    const roomID = escapeHtml(room.room_id);
    const cubeLabel = escapeHtml(room.label || 'Unknown');
    const packNo = (Number.parseInt(String(room.pack_no || 0), 10) || 0) + 1;
    const pickNo = (Number.parseInt(String(room.pick_no || 0), 10) || 0) + 1;
    const connectedSeats = Number.parseInt(String(room.connected_seats || 0), 10) || 0;
    return `
            <li class="lobby-room-item">
              <div class="lobby-room-head">
                <div class="lobby-room-id">${roomID}</div>
                <div class="lobby-room-cube">${cubeLabel}</div>
              </div>
              <div class="lobby-room-meta">Pack ${packNo} · Pick ${pickNo} · ${connectedSeats}/${seatCount} connected</div>
              <div class="lobby-room-actions">${seatButtons}</div>
            </li>
          `;
  }).join('')}
      </ul>
    `;
    bindLobbySeatButtons(state.roomsList);
  }

  async function refreshRooms() {
    if (!state.roomsList) return;
    if (state.refreshButton) state.refreshButton.disabled = true;
    state.roomsList.innerHTML = '<div class="aux-empty">Loading rooms...</div>';
    try {
      const rooms = await fetchDraftRooms();
      renderRooms(rooms);
    } catch (err) {
      const message = err && err.message ? err.message : 'Failed to load rooms.';
      state.roomsList.innerHTML = `<div class="aux-empty">${escapeHtml(message)}</div>`;
    } finally {
      if (state.refreshButton) state.refreshButton.disabled = false;
    }
  }

  function startStream() {
    stopStream();
    if (!('EventSource' in window)) return;
    const source = new EventSource('/api/draft/lobby/events');
    state.eventSource = source;
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
        renderRooms(rooms);
      } catch (_) {
        // ignore malformed events
      }
    };
    source.onerror = () => {
      // Browser will auto-reconnect EventSource.
    };
  }

  async function render(currentDeckSlug) {
    if (!ui.draftPane) return;
    if (currentDeckSlug !== undefined) {
      setPreferredDeckSlug(currentDeckSlug);
    }

    if (draftController.hasActiveRoom()) {
      stopStream();
      state.roomsList = null;
      state.refreshButton = null;
      draftController.render();
      return;
    }

    const cube = await loadBattlebox('cube');
    const decks = Array.isArray(cube?.decks) ? cube.decks : [];
    const activeDeckSlug = state.currentDeckSlug;
    const deckOptions = decks.map((deck) => {
      const selected = normalizeName(deck.slug) === activeDeckSlug ? ' selected' : '';
      return `<option value="${escapeHtml(deck.slug)}"${selected}>${escapeHtml(deck.name || deck.slug)}</option>`;
    }).join('');
    const noDecks = decks.length === 0;
    const selectedDeck = decks.find((deck) => normalizeName(deck.slug) === activeDeckSlug) || decks[0] || null;
    const selectedDeckSlug = selectedDeck ? selectedDeck.slug : '';

    ui.draftPane.innerHTML = `
      <div class="lobby-panel">
        <div class="lobby-start-row">
          <select id="lobby-deck-select" class="lobby-deck-select" ${noDecks ? 'disabled' : ''}>
            ${deckOptions}
          </select>
          <button type="button" class="action-button button-standard" id="lobby-create-room" ${noDecks ? 'disabled' : ''}>Create Room</button>
          <button type="button" class="action-button button-standard" id="lobby-refresh-rooms">Refresh</button>
        </div>
        <div id="lobby-rooms-list" class="lobby-rooms-list"></div>
      </div>
    `;

    const deckSelect = ui.draftPane.querySelector('#lobby-deck-select');
    const createRoomButton = ui.draftPane.querySelector('#lobby-create-room');
    const refreshButton = ui.draftPane.querySelector('#lobby-refresh-rooms');
    const roomsList = ui.draftPane.querySelector('#lobby-rooms-list');

    state.roomsList = roomsList;
    state.refreshButton = refreshButton;

    const resolveDeck = () => {
      if (!deckSelect) return selectedDeck;
      const slug = normalizeName(deckSelect.value || selectedDeckSlug);
      return decks.find((deck) => normalizeName(deck.slug) === slug) || selectedDeck;
    };

    if (refreshButton) {
      refreshButton.addEventListener('click', () => {
        void refreshRooms();
      });
    }

    if (createRoomButton) {
      createRoomButton.addEventListener('click', async () => {
        const deck = resolveDeck();
        if (!deck) return;
        createRoomButton.disabled = true;
        try {
          await createDraftRoom(deck);
          await refreshRooms();
        } catch (err) {
          window.alert(err && err.message ? err.message : 'Failed to create room.');
        } finally {
          createRoomButton.disabled = false;
        }
      });
    }

    await refreshRooms();
    startStream();
  }

  return {
    render,
    teardown,
    setPreferredDeckSlug,
  };
}
