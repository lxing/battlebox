import { buildDoubleFacedMap, normalizeName } from './utils.js';

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

function buildDraftCardMetaMap(deck) {
  const map = {};
  const addCard = (card) => {
    const name = String(card?.name || '').trim();
    const key = normalizeName(name);
    if (!key || map[key]) return;
    const manaValue = Number(card?.mana_value);
    map[key] = {
      name,
      type: String(card?.type || ''),
      mana_cost: String(card?.mana_cost || ''),
      mana_value: Number.isFinite(manaValue) ? manaValue : 0,
      printing: String(card?.printing || ''),
      double_faced: card?.double_faced === true,
    };
  };

  (Array.isArray(deck?.cards) ? deck.cards : []).forEach(addCard);
  (Array.isArray(deck?.sideboard) ? deck.sideboard : []).forEach(addCard);
  return map;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildDefaultPassPattern(packSize) {
  const size = Number.parseInt(String(packSize), 10) || 0;
  if (size <= 0) return [];
  return Array.from({ length: size }, () => 1);
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

async function createDraftRoom(deck, preset) {
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
  const res = await fetch('/api/draft/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

function parseDraftPresets(rawPresets) {
  if (!rawPresets || typeof rawPresets !== 'object' || Array.isArray(rawPresets)) return [];
  return Object.entries(rawPresets)
    .map(([id, value]) => {
      const key = String(id || '').trim();
      if (!key || !value || typeof value !== 'object') return null;
      const seatCount = Number.parseInt(String(value.seat_count), 10);
      const packCount = Number.parseInt(String(value.pack_count), 10);
      const packSize = Number.parseInt(String(value.pack_size), 10);
      const passPatternRaw = Array.isArray(value.pass_pattern) ? value.pass_pattern : buildDefaultPassPattern(packSize);
      const passPattern = passPatternRaw.map((entry) => Number.parseInt(String(entry), 10));
      const passTotal = passPattern.reduce((sum, entry) => sum + entry, 0);
      if (!Number.isFinite(seatCount) || seatCount <= 0) return null;
      if (!Number.isFinite(packCount) || packCount <= 0) return null;
      if (!Number.isFinite(packSize) || packSize <= 0) return null;
      if (!passPattern.every((entry) => Number.isFinite(entry) && entry > 0)) return null;
      if (passPattern.length === 0 || passTotal > packSize) return null;
      return {
        id: key,
        label: key,
        seat_count: seatCount,
        pack_count: packCount,
        pack_size: packSize,
        pass_pattern: passPattern,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function normalizePositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function buildDraftPresetConfigKey(seatCount, packCount, packSize) {
  return `${normalizePositiveInt(seatCount)}|${normalizePositiveInt(packCount)}|${normalizePositiveInt(packSize)}`;
}

function sumPassPattern(passPattern) {
  if (!Array.isArray(passPattern) || passPattern.length === 0) return 0;
  const parsed = passPattern.map((value) => Number.parseInt(String(value), 10));
  if (!parsed.every((value) => Number.isFinite(value) && value > 0)) return 0;
  return parsed.reduce((sum, value) => sum + value, 0);
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
  const packCount = normalizePositiveInt(preset?.pack_count);
  const packSize = normalizePositiveInt(preset?.pack_size);
  const passPattern = Array.isArray(preset?.pass_pattern)
    ? preset.pass_pattern.map((value) => Number.parseInt(String(value), 10))
    : [];
  const validPattern = passPattern.length > 0 && passPattern.every((value) => Number.isFinite(value) && value > 0);
  if (packCount <= 0 || packSize <= 0 || !validPattern) return '';

  const totalPicks = passPattern.reduce((sum, value) => sum + value, 0);
  const burnCount = Math.max(0, packSize - totalPicks);
  const allSinglePicks = passPattern.length === packSize && passPattern.every((value) => value === 1);

  if (allSinglePicks && burnCount === 0) {
    return `${packCount}x${packSize}`;
  }

  const patternParts = passPattern.map((value) => String(value));
  if (burnCount > 0) {
    patternParts.push(`🚮${burnCount}`);
  }
  return `${packCount}x(${patternParts.join(',')})`;
}

async function deleteDraftRoom(roomID) {
  const id = String(roomID || '').trim();
  if (!id) throw new Error('Missing room id');
  const res = await fetch(`/api/draft/rooms?room_id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
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
    currentDeckSlug: '',
    currentPresetID: '',
    cubeDeckBySlug: new Map(),
    presetsRawRef: null,
    allPresetEntries: [],
    presetByConfig: new Map(),
    roomByID: new Map(),
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
  }

  function setPreferredDeckSlug(deckSlug) {
    state.currentDeckSlug = normalizeName(deckSlug || '');
  }

  function ensurePresetCache(rawPresets) {
    if (state.presetsRawRef === rawPresets) return;
    const allPresetEntries = parseDraftPresets(rawPresets);
    const presetByConfig = new Map();
    allPresetEntries.forEach((preset) => {
      const key = buildDraftPresetConfigKey(preset.seat_count, preset.pack_count, preset.pack_size);
      if (!presetByConfig.has(key)) {
        presetByConfig.set(key, preset);
      }
    });
    state.presetsRawRef = rawPresets;
    state.allPresetEntries = allPresetEntries;
    state.presetByConfig = presetByConfig;
  }

  function resolveRoomTotals(room) {
    const seatCount = normalizePositiveInt(room?.seat_count);
    const packCount = normalizePositiveInt(room?.pack_count);
    const packSize = normalizePositiveInt(room?.pack_size);
    const key = buildDraftPresetConfigKey(seatCount, packCount, packSize);
    const preset = state.presetByConfig.get(key);
    const picksPerPack = sumPassPattern(preset?.pass_pattern) || packSize;
    return {
      packTotal: packCount,
      pickTotal: picksPerPack,
    };
  }

  function bindLobbySeatButtons(scope) {
    if (!scope) return;
    scope.querySelectorAll('[data-room-id][data-seat-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const roomID = String(button.dataset.roomId || '').trim();
        const room = state.roomByID.get(roomID) || null;
        const roomDeckSlug = String(button.dataset.roomDeckSlug || '').trim();
        const roomDeck = state.cubeDeckBySlug.get(normalizeName(roomDeckSlug));
        const roomDeckName = String(roomDeck?.name || roomDeckSlug || '').trim();
        const roomDeckPrintings = roomDeck && roomDeck.printings && typeof roomDeck.printings === 'object'
          ? roomDeck.printings
          : {};
        const roomDeckDoubleFaced = buildDoubleFacedMap(roomDeck);
        const roomDeckCardMeta = buildDraftCardMetaMap(roomDeck);
        const seatRaw = Number.parseInt(String(button.dataset.seatId || '0'), 10);
        const seat = Number.isFinite(seatRaw) && seatRaw >= 0 ? seatRaw : 0;
        if (!roomID) return;
        const totals = resolveRoomTotals(room);
        draftController.openRoom(
          roomID,
          seat,
          roomDeckSlug,
          roomDeckPrintings,
          roomDeckName,
          roomDeckDoubleFaced,
          roomDeckCardMeta,
          totals.packTotal,
          totals.pickTotal,
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
          await deleteDraftRoom(roomID);
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
      state.roomsList.innerHTML = '';
      return;
    }

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
            data-room-deck-slug="${escapeHtml(room.deck_slug || '')}"
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
    const totals = resolveRoomTotals(room);
    const packLabel = formatProgressLabel('Pack', room.pack_no, totals.packTotal);
    const pickLabel = formatProgressLabel('Pick', room.pick_no, totals.pickTotal);
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
                  title="Delete room"
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
      const rooms = await fetchDraftRooms();
      renderRooms(rooms);
    } catch (err) {
      const message = err && err.message ? err.message : 'Failed to load rooms.';
      state.roomsList.innerHTML = `<div class="aux-empty">${escapeHtml(message)}</div>`;
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
      draftController.render();
      return;
    }

    const cube = await loadBattlebox('cube');
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
          <button type="button" class="action-button button-standard" id="lobby-create-room" ${noDecks || noPresets ? 'disabled' : ''}>Create Room</button>
        </div>
        <div id="lobby-rooms-list" class="lobby-rooms-list"></div>
      </div>
    `;

    const deckSelect = ui.draftPane.querySelector('#lobby-deck-select');
    const presetSelect = ui.draftPane.querySelector('#lobby-preset-select');
    const createRoomButton = ui.draftPane.querySelector('#lobby-create-room');
    const roomsList = ui.draftPane.querySelector('#lobby-rooms-list');

    state.roomsList = roomsList;

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
        const deck = resolveDeck();
        const preset = resolvePreset();
        if (!deck || !preset) return;
        createRoomButton.disabled = true;
        try {
          await createDraftRoom(deck, preset);
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
