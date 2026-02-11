const ROOM_LABELS = {
  1: 'Secret Entrance',
  2: 'Forge',
  3: 'Lost Well',
  4: 'Trap!',
  5: 'Arena',
  6: 'Stash',
  7: 'Archives',
  8: 'Catacombs',
  9: 'Throne of the Dead Three',
};

const ROOM_DESCRIPTIONS = {
  1: 'Search for a basic land and put it into your hand.',
  2: 'Put two +1/+1 counters on target creature.',
  3: 'Scry 2.',
  4: 'Target player loses 5 life.',
  5: 'Goad target creature.',
  6: 'Create a Treasure token.',
  7: 'Draw a card.',
  8: 'Create a 4/1 Skeleton token with menace.',
  9: 'Reveal 10 cards; put a creature onto the battlefield with three +1/+1 counters.',
};

// Undercity transitions used for life-tracker initiative (1-indexed).
const ROOM_TRANSITIONS = {
  1: [2, 3],
  2: [4, 5],
  3: [5, 6],
  4: [7],
  5: [7, 8],
  6: [8],
  7: [9],
  8: [9],
  9: [1],
};

function normalizePlayerId(playerId) {
  return playerId === 'p2' ? 'p2' : 'p1';
}

function normalizeRoomIndex(roomIndex, fallback = 1) {
  const parsed = Number.parseInt(String(roomIndex), 10);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed === 0) return 1; // Legacy stored "Entrance" maps to Secret Entrance.
  if (!Object.prototype.hasOwnProperty.call(ROOM_LABELS, parsed)) return fallback;
  return parsed;
}

function normalizeOwner(owner) {
  if (owner === 'p1' || owner === 'p2') return owner;
  return null;
}

function normalizeRooms(rooms) {
  const source = rooms && typeof rooms === 'object' ? rooms : {};
  return {
    p1: normalizeRoomIndex(source.p1, 1),
    p2: normalizeRoomIndex(source.p2, 1),
  };
}

export function createInitialInitiativeState(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    owner: normalizeOwner(source.owner),
    rooms: normalizeRooms(source.rooms),
  };
}

export function resetInitiativeState() {
  return {
    owner: null,
    rooms: { p1: 1, p2: 1 },
  };
}

export function getPlayerRoom(state, playerId) {
  const normalized = createInitialInitiativeState(state);
  const player = normalizePlayerId(playerId);
  return normalized.rooms[player];
}

export function getValidNextRooms(state, playerId) {
  const currentRoom = getPlayerRoom(state, playerId);
  const next = ROOM_TRANSITIONS[currentRoom];
  return Array.isArray(next) ? [...next] : [];
}

export function canMoveToRoom(state, playerId, roomIndex) {
  const normalized = createInitialInitiativeState(state);
  const player = normalizePlayerId(playerId);
  const currentRoom = normalized.rooms[player];
  const nextRoom = normalizeRoomIndex(roomIndex, -1);
  if (nextRoom < 0) return false;
  if (nextRoom === currentRoom) return false;
  return getValidNextRooms(normalized, player).includes(nextRoom);
}

export function applyInitiativeMove(state, playerId, roomIndex) {
  const normalized = createInitialInitiativeState(state);
  const player = normalizePlayerId(playerId);
  const nextRoom = normalizeRoomIndex(roomIndex, -1);

  if (nextRoom < 0) {
    return {
      state: normalized,
      changed: false,
      error: 'invalid-room',
    };
  }

  if (!canMoveToRoom(normalized, player, nextRoom)) {
    return {
      state: normalized,
      changed: false,
      error: 'invalid-transition',
    };
  }

  const nextState = {
    owner: player, // Rule: any successful move grants initiative to moved player.
    rooms: {
      p1: normalized.rooms.p1,
      p2: normalized.rooms.p2,
    },
  };
  nextState.rooms[player] = nextRoom;

  return {
    state: nextState,
    changed: true,
    error: null,
  };
}

export function createInitiativeOverlay(container, state, persist) {
  const writeState = typeof persist === 'function' ? persist : () => {};

  let overlay = null;
  let roomList = null;
  let draggedPlayer = null;

  const displayRows = [
    [1],
    [2, 3],
    [4, 5, 6],
    [7, 8],
    [9],
  ];

  const buildHtml = () => {
    const rowsHtml = displayRows.map((row) => {
      const rowItems = row
        .map((idx) => {
          const label = ROOM_LABELS[idx] || `Room ${idx}`;
          const description = ROOM_DESCRIPTIONS[idx] || '';
          return `
            <li class="initiative-room-item" data-room="${idx}">
              <span
                class="initiative-room-player initiative-room-player-left"
                data-room-player-left="${idx}"
                data-initiative-player="p1"
                aria-label="Player 1 initiative token"
              ></span>
              <span class="initiative-room-body">
                <span class="initiative-room-label">${label}</span>
                <span class="initiative-room-desc">${description}</span>
              </span>
              <span
                class="initiative-room-player initiative-room-player-right"
                data-room-player-right="${idx}"
                data-initiative-player="p2"
                aria-label="Player 2 initiative token"
              ></span>
            </li>
          `;
        })
        .join('');
      return `<ul class="initiative-room-row" style="--initiative-cols: ${row.length};">${rowItems}</ul>`;
    }).join('');

    return `
      <div class="initiative-overlay-backdrop" data-initiative-overlay-backdrop></div>
      <div class="initiative-overlay-sheet" role="dialog" aria-modal="true" aria-label="Initiative rooms">
        <div class="initiative-room-list" data-initiative-room-list>
          ${rowsHtml}
        </div>
      </div>
    `;
  };

  const getInitiativeState = () => {
    state.initiative = createInitialInitiativeState(state.initiative);
    return state.initiative;
  };

  const sync = () => {
    if (!overlay || !roomList) return;
    const initiative = getInitiativeState();
    const p1Room = getPlayerRoom(initiative, 'p1') || 1;
    const p2Room = getPlayerRoom(initiative, 'p2') || 1;

    overlay.classList.toggle('initiative-owner-p1', initiative.owner === 'p1');
    overlay.classList.toggle('initiative-owner-p2', initiative.owner === 'p2');

    overlay.querySelectorAll('[data-room-player-left]').forEach((slot) => {
      const room = Number.parseInt(slot.dataset.roomPlayerLeft || '', 10);
      const hasToken = room === p1Room;
      slot.textContent = hasToken ? '🐿️' : '';
      slot.classList.toggle('initiative-player-token', hasToken);
      slot.classList.toggle('initiative-player-selected', hasToken && draggedPlayer === 'p1');
    });

    overlay.querySelectorAll('[data-room-player-right]').forEach((slot) => {
      const room = Number.parseInt(slot.dataset.roomPlayerRight || '', 10);
      const hasToken = room === p2Room;
      slot.textContent = hasToken ? '🐭' : '';
      slot.classList.toggle('initiative-player-token', hasToken);
      slot.classList.toggle('initiative-player-selected', hasToken && draggedPlayer === 'p2');
    });

    roomList.querySelectorAll('.initiative-room-item').forEach((item) => {
      const room = Number.parseInt(item.dataset.room || '', 10);
      const valid = draggedPlayer ? canMoveToRoom(initiative, draggedPlayer, room) : false;
      item.classList.toggle('initiative-room-valid-drop', valid);
    });
  };

  const hide = () => {
    if (!overlay) return;
    draggedPlayer = null;
    overlay.hidden = true;
    sync();
  };

  const ensure = () => {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'initiative-overlay';
    overlay.hidden = true;
    overlay.innerHTML = buildHtml();
    container.appendChild(overlay);
    roomList = overlay.querySelector('[data-initiative-room-list]');

    const backdrop = overlay.querySelector('[data-initiative-overlay-backdrop]');
    if (backdrop) backdrop.addEventListener('click', hide);

    const tryMoveSelectedPlayer = (room) => {
      if (!draggedPlayer || room == null) return false;
      const initiative = getInitiativeState();
      if (!canMoveToRoom(initiative, draggedPlayer, room)) return false;
      const result = applyInitiativeMove(initiative, draggedPlayer, room);
      if (!result.changed) return false;
      state.initiative = result.state;
      writeState();
      return true;
    };

    overlay.querySelectorAll('[data-initiative-player]').forEach((slot) => {
      slot.addEventListener('click', (event) => {
        const player = slot.dataset.initiativePlayer === 'p2' ? 'p2' : 'p1';
        const hasToken = slot.textContent && slot.textContent.trim().length > 0;
        if (!hasToken) return;
        event.preventDefault();
        event.stopPropagation();
        draggedPlayer = draggedPlayer === player ? null : player;
        sync();
      });
    });

    overlay.querySelectorAll('.initiative-room-item').forEach((item) => {
      item.addEventListener('click', (event) => {
        const room = Number.parseInt(item.dataset.room || '', 10);
        if (!draggedPlayer) return;
        if (!canMoveToRoom(getInitiativeState(), draggedPlayer, room)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!tryMoveSelectedPlayer(room)) return;
        draggedPlayer = null;
        sync();
      });
    });
  };

  const show = () => {
    ensure();
    draggedPlayer = null;
    sync();
    overlay.hidden = false;
  };

  const toggle = () => {
    if (overlay && !overlay.hidden) {
      hide();
      return;
    }
    show();
  };

  return {
    toggle,
    hide,
    sync,
    isOpen: () => Boolean(overlay && !overlay.hidden),
  };
}
