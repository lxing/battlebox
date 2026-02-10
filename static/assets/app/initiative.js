const PLAYERS = ['p1', 'p2'];

const ROOM_LABELS = {
  0: 'Entrance',
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

// Undercity transitions used for life-tracker initiative.
// Rule: room 0 is only reachable from room 9 (or via full game reset).
const ROOM_TRANSITIONS = {
  0: [1],
  1: [2, 3],
  2: [4, 5],
  3: [5, 6],
  4: [7],
  5: [7, 8],
  6: [8],
  7: [9],
  8: [9],
  9: [0],
};

const DRAG_MIME = 'application/x-battlebox-initiative-player';

function normalizePlayerId(playerId) {
  return playerId === 'p2' ? 'p2' : 'p1';
}

function normalizeRoomIndex(roomIndex, fallback = 0) {
  const parsed = Number.parseInt(String(roomIndex), 10);
  if (!Number.isInteger(parsed)) return fallback;
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
    p1: normalizeRoomIndex(source.p1, 0),
    p2: normalizeRoomIndex(source.p2, 0),
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
    rooms: { p1: 0, p2: 0 },
  };
}

export function listInitiativeRooms() {
  return Object.keys(ROOM_LABELS)
    .map((key) => Number.parseInt(key, 10))
    .sort((a, b) => a - b)
    .map((index) => ({ index, label: ROOM_LABELS[index] }));
}

export function getInitiativeRoomLabel(roomIndex) {
  const idx = normalizeRoomIndex(roomIndex, -1);
  if (idx < 0) return 'Unknown';
  return ROOM_LABELS[idx];
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

export function getInitiativeDragMimeType() {
  return DRAG_MIME;
}

export function buildInitiativeDragPayload(playerId, state) {
  const player = normalizePlayerId(playerId);
  return JSON.stringify({
    player,
    fromRoom: getPlayerRoom(state, player),
  });
}

export function parseInitiativeDragPayload(raw) {
  try {
    const parsed = JSON.parse(String(raw || ''));
    return {
      player: normalizePlayerId(parsed.player),
      fromRoom: normalizeRoomIndex(parsed.fromRoom, 0),
    };
  } catch (_) {
    return null;
  }
}

export function getInitiativePlayers() {
  return [...PLAYERS];
}
