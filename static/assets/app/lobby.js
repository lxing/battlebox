import { normalizeName } from './utils.js';
import {
  appendDeviceIDToUrl,
  fetchDraftRooms,
  getStableDeviceID,
} from './draftApi.js';
import {
  buildDefaultPassPattern,
  buildOpenRoomContext,
  buildPresetByConfig,
  normalizePositiveInt,
  parseDraftPresets,
  resolveRoomTotals,
} from './draftRoomContext.js';

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

async function createDraftRoom(deck, preset, deviceID) {
  const deckNames = buildDraftDeckNames(deck);
  const seatCount = Number.parseInt(String(preset?.seat_count), 10) || 0;
  const packCount = Number.parseInt(String(preset?.pack_count), 10) || 0;
  const packSize = Number.parseInt(String(preset?.pack_size), 10) || 0;
  let passPattern = buildDefaultPassPattern(packSize);
  if (Array.isArray(preset?.pass_pattern)) {
    const parsed = preset.pass_pattern.map((value) => Number.parseInt(String(value), 10));
    if (!parsed.every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error('Invalid draft preset');
    }
    passPattern = parsed;
  }
  if (seatCount <= 0 || packCount <= 0 || packSize <= 0) {
    throw new Error('Invalid draft preset');
  }
  if (passPattern.length === 0) {
    throw new Error('Invalid draft preset');
  }
  const res = await fetch(appendDeviceIDToUrl('/api/draft/rooms', deviceID), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-ID': String(deviceID || ''),
    },
    body: JSON.stringify({
      deck: deckNames,
      deck_slug: deck?.slug || '',
      seat_count: seatCount,
      pack_count: packCount,
      pack_size: packSize,
      pass_pattern: passPattern,
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

function formatProgressLabel(label, zeroBasedValue, total) {
  const safeTotal = normalizePositiveInt(total);
  if (safeTotal <= 0) return `${label} -/-`;
  const raw = Number.parseInt(String(zeroBasedValue), 10);
  const current = Number.isFinite(raw) ? raw + 1 : 1;
  const clamped = Math.max(1, Math.min(current, safeTotal));
  return `${label} ${clamped}/${safeTotal}`;
}

function formatPresetOptionLabel(preset) {
  const seatCount = normalizePositiveInt(preset?.seat_count);
  const packCount = normalizePositiveInt(preset?.pack_count);
  const packSize = normalizePositiveInt(preset?.pack_size);
  const passPattern = Array.isArray(preset?.pass_pattern)
    ? preset.pass_pattern.map((value) => Number.parseInt(String(value), 10))
    : [];
  const validPattern = passPattern.length > 0 && passPattern.every((value) => Number.isFinite(value) && value > 0);
  if (seatCount <= 0 || packCount <= 0 || packSize <= 0 || !validPattern) return '';

  const totalPicks = passPattern.reduce((sum, value) => sum + value, 0);
  const burnCount = Math.max(0, packSize - totalPicks);
  const allSinglePicks = passPattern.length === packSize && passPattern.every((value) => value === 1);
  const seatLabel = `${seatCount}p`;
  const divider = ' · ';

  if (allSinglePicks && burnCount === 0) {
    return `${seatLabel}${divider}${packCount}${divider}${packSize}`;
  }

  const patternParts = passPattern.map((value) => String(value));
  if (burnCount > 0) {
    patternParts.push(`🚮${burnCount}`);
  }
  return `${seatLabel}${divider}${packCount}${divider}${patternParts.join(',')}`;
}

async function deleteDraftRoom(roomID, deviceID) {
  const id = String(roomID || '').trim();
  if (!id) throw new Error('Missing room id');
  const res = await fetch(appendDeviceIDToUrl(`/api/draft/rooms?room_id=${encodeURIComponent(id)}`, deviceID), {
    method: 'DELETE',
    headers: {
      'X-Device-ID': String(deviceID || ''),
    },
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `Failed to delete room (${res.status})`);
  }
}

export function createLobbyController({
  ui,
  loadBattlebox,
  draftController,
}) {
  const state = {
    eventSource: null,
    roomsList: null,
    deviceID: '',
    currentDeckSlug: '',
    currentPresetID: '',
    cubeDeckBySlug: new Map(),
    presetsRawRef: null,
    allPresetEntries: [],
    presetByConfig: new Map(),
    roomByID: new Map(),
    createRoomButton: null,
    createRoomBaseDisabled: false,
    ownerHasRoom: false,
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
    state.createRoomButton = null;
  }

  function setPreferredDeckSlug(deckSlug) {
    state.currentDeckSlug = normalizeName(deckSlug || '');
  }

  function ensurePresetCache(rawPresets) {
    if (state.presetsRawRef === rawPresets) return;
    const allPresetEntries = parseDraftPresets(rawPresets);
    const presetByConfig = buildPresetByConfig(allPresetEntries);
    state.presetsRawRef = rawPresets;
    state.allPresetEntries = allPresetEntries;
    state.presetByConfig = presetByConfig;
  }

  function syncCreateRoomButtonState() {
    if (!state.createRoomButton) return;
    const blockedByOwner = state.ownerHasRoom;
    state.createRoomButton.disabled = state.createRoomBaseDisabled || blockedByOwner;
    if (blockedByOwner) {
      state.createRoomButton.setAttribute('title', 'You may only create one room on this device');
      state.createRoomButton.setAttribute('aria-label', 'Create Room (disabled: one room per device)');
    } else {
      state.createRoomButton.removeAttribute('title');
      state.createRoomButton.setAttribute('aria-label', 'Create Room');
    }
  }

  function bindLobbySeatButtons(scope) {
    if (!scope) return;
    scope.querySelectorAll('[data-room-id][data-seat-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const roomID = String(button.dataset.roomId || '').trim();
        const room = state.roomByID.get(roomID) || null;
        const seatRaw = Number.parseInt(String(button.dataset.seatId || '0'), 10);
        const seat = Number.isFinite(seatRaw) && seatRaw >= 0 ? seatRaw : 0;
        if (!roomID) return;
        const context = buildOpenRoomContext(room, seat, state.cubeDeckBySlug, state.presetByConfig);
        if (!context) return;
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
        void render(state.currentDeckSlug);
      });
    });
  }

  function bindLobbyDeleteButtons(scope) {
    if (!scope) return;
    scope.querySelectorAll('[data-delete-room-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const roomID = String(button.dataset.deleteRoomId || '').trim();
        if (!roomID) return;
        button.disabled = true;
        try {
          await deleteDraftRoom(roomID, state.deviceID);
          await refreshRooms();
        } catch (err) {
          window.alert(err && err.message ? err.message : 'Failed to delete room.');
          button.disabled = false;
        }
      });
    });
  }

  function renderRooms(rooms) {
    if (!state.roomsList) return;
    if (!Array.isArray(rooms) || rooms.length === 0) {
      state.roomByID = new Map();
      state.ownerHasRoom = false;
      syncCreateRoomButtonState();
      state.roomsList.innerHTML = '';
      return;
    }

    state.ownerHasRoom = rooms.some((room) => room && room.owned_by_requester === true);
    syncCreateRoomButtonState();

    state.roomByID = new Map(
      rooms.map((room) => [String(room?.room_id || '').trim(), room]),
    );

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
            data-seat-id="${idx}"
          ${occupied ? 'disabled aria-disabled="true"' : ''}
        >
          ${idx + 1}
        </button>
      `;
    }).join('');
    const roomID = escapeHtml(room.room_id);
    const roomDeckSlug = String(room.deck_slug || '').trim();
    const roomDeck = state.cubeDeckBySlug.get(normalizeName(roomDeckSlug));
    const cubeLabel = escapeHtml(String(roomDeck?.name || roomDeckSlug || 'Unknown').trim());
    const totals = resolveRoomTotals(room, state.presetByConfig);
    const packLabel = formatProgressLabel('Pack', room.pack_no, totals.packTotal);
    const pickLabel = formatProgressLabel('Pick', room.pick_no, totals.pickTotal);
    const canDelete = room?.owned_by_requester === true;
    const deleteTitle = canDelete ? 'Delete room' : 'Only the creator can delete this room';
    return `
            <li class="lobby-room-item">
              <div class="lobby-room-head">
                <div class="lobby-room-id">${roomID}</div>
                <div class="lobby-room-cube">${cubeLabel}</div>
              </div>
              <div class="lobby-room-meta">${packLabel} · ${pickLabel}</div>
              <div class="lobby-room-actions">
                <div class="lobby-seat-buttons">${seatButtons}</div>
                <button
                  type="button"
                  class="action-button button-standard lobby-room-delete-button"
                  data-delete-room-id="${roomID}"
                  aria-label="Delete room ${roomID}"
                  title="${deleteTitle}"
                  ${canDelete ? '' : 'disabled aria-disabled="true"'}
                >🗑️</button>
              </div>
            </li>
          `;
  }).join('')}
      </ul>
    `;
    bindLobbySeatButtons(state.roomsList);
    bindLobbyDeleteButtons(state.roomsList);
  }

  async function refreshRooms() {
    if (!state.roomsList) return;
    state.roomsList.innerHTML = '<div class="aux-empty">Loading rooms...</div>';
    try {
      const rooms = await fetchDraftRooms(state.deviceID);
      renderRooms(rooms);
    } catch (err) {
      const message = err && err.message ? err.message : 'Failed to load rooms.';
      state.roomsList.innerHTML = `<div class="aux-empty">${escapeHtml(message)}</div>`;
    }
  }

  function startStream() {
    stopStream();
    if (!('EventSource' in window) || !state.deviceID) return;
    const source = new EventSource(appendDeviceIDToUrl('/api/draft/lobby/events', state.deviceID));
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
      draftController.render();
      return;
    }

    const cube = await loadBattlebox('cube');
    if (!state.deviceID) {
      state.deviceID = await getStableDeviceID();
    }
    const decks = Array.isArray(cube?.decks) ? cube.decks : [];
    state.cubeDeckBySlug = new Map(decks.map((deck) => [normalizeName(deck.slug), deck]));
    const activeDeckSlug = state.currentDeckSlug;
    const deckOptions = decks.map((deck) => {
      const selected = normalizeName(deck.slug) === activeDeckSlug ? ' selected' : '';
      return `<option value="${escapeHtml(deck.slug)}"${selected}>${escapeHtml(deck.name || deck.slug)}</option>`;
    }).join('');
    const noDecks = decks.length === 0;
    const selectedDeck = decks.find((deck) => normalizeName(deck.slug) === activeDeckSlug) || decks[0] || null;
    const selectedDeckSlug = selectedDeck ? selectedDeck.slug : '';
    const allowedPresetIDs = new Set(Array.isArray(selectedDeck?.draft_presets) ? selectedDeck.draft_presets : []);
    ensurePresetCache(cube?.presets);
    const presetEntries = state.allPresetEntries.filter((preset) => allowedPresetIDs.has(preset.id));
    const noPresets = presetEntries.length === 0;
    if (!presetEntries.some((preset) => preset.id === state.currentPresetID)) {
      state.currentPresetID = presetEntries[0]?.id || '';
    }
    const presetOptions = presetEntries.map((preset) => {
      const selected = preset.id === state.currentPresetID ? ' selected' : '';
      const label = formatPresetOptionLabel(preset);
      return `<option value="${escapeHtml(preset.id)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');

    ui.draftPane.innerHTML = `
      <div class="lobby-panel">
        <div class="lobby-start-row">
          <select id="lobby-deck-select" class="lobby-deck-select" ${noDecks ? 'disabled' : ''}>
            ${deckOptions}
          </select>
          <select id="lobby-preset-select" class="lobby-deck-select" ${noPresets ? 'disabled' : ''}>
            ${presetOptions}
          </select>
          <button type="button" class="action-button button-standard" id="lobby-create-room" ${noDecks || noPresets ? 'disabled' : ''}>Create</button>
        </div>
        <div id="lobby-rooms-list" class="lobby-rooms-list"></div>
      </div>
    `;

    const deckSelect = ui.draftPane.querySelector('#lobby-deck-select');
    const presetSelect = ui.draftPane.querySelector('#lobby-preset-select');
    const createRoomButton = ui.draftPane.querySelector('#lobby-create-room');
    const roomsList = ui.draftPane.querySelector('#lobby-rooms-list');

    state.roomsList = roomsList;
    state.createRoomButton = createRoomButton;
    state.createRoomBaseDisabled = noDecks || noPresets;
    state.ownerHasRoom = false;
    syncCreateRoomButtonState();

    const resolveDeck = () => {
      if (!deckSelect) return selectedDeck;
      const slug = normalizeName(deckSelect.value || selectedDeckSlug);
      return decks.find((deck) => normalizeName(deck.slug) === slug) || selectedDeck;
    };
    const resolvePreset = () => {
      const selectedID = String(presetSelect?.value || state.currentPresetID || '').trim();
      return presetEntries.find((preset) => preset.id === selectedID) || null;
    };
    if (deckSelect) {
      deckSelect.addEventListener('change', () => {
        state.currentDeckSlug = normalizeName(deckSelect.value || '');
        void render(state.currentDeckSlug);
      });
    }
    if (presetSelect) {
      presetSelect.addEventListener('change', () => {
        state.currentPresetID = String(presetSelect.value || '').trim();
      });
    }

    if (createRoomButton) {
      createRoomButton.addEventListener('click', async () => {
        if (state.ownerHasRoom) return;
        const deck = resolveDeck();
        const preset = resolvePreset();
        if (!deck || !preset) return;
        createRoomButton.disabled = true;
        try {
          await createDraftRoom(deck, preset, state.deviceID);
          await refreshRooms();
        } catch (err) {
          window.alert(err && err.message ? err.message : 'Failed to create room.');
        } finally {
          syncCreateRoomButtonState();
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
