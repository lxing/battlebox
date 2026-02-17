import { buildDoubleFacedMap, normalizeName } from './utils.js';

export function normalizePositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function buildDefaultPassPattern(packSize) {
  const size = Number.parseInt(String(packSize), 10) || 0;
  if (size <= 0) return [];
  return Array.from({ length: size }, () => 1);
}

export function parseDraftPresets(rawPresets) {
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

export function buildDraftPresetConfigKey(seatCount, packCount, packSize) {
  return `${normalizePositiveInt(seatCount)}|${normalizePositiveInt(packCount)}|${normalizePositiveInt(packSize)}`;
}

export function sumPassPattern(passPattern) {
  if (!Array.isArray(passPattern) || passPattern.length === 0) return 0;
  const parsed = passPattern.map((value) => Number.parseInt(String(value), 10));
  if (!parsed.every((value) => Number.isFinite(value) && value > 0)) return 0;
  return parsed.reduce((sum, value) => sum + value, 0);
}

export function buildPresetByConfig(presetEntries) {
  const out = new Map();
  (Array.isArray(presetEntries) ? presetEntries : []).forEach((preset) => {
    const key = buildDraftPresetConfigKey(preset?.seat_count, preset?.pack_count, preset?.pack_size);
    if (key && !out.has(key)) {
      out.set(key, preset);
    }
  });
  return out;
}

export function resolveRoomTotals(room, presetByConfig) {
  const seatCount = normalizePositiveInt(room?.seat_count);
  const packCount = normalizePositiveInt(room?.pack_count);
  const packSize = normalizePositiveInt(room?.pack_size);
  const key = buildDraftPresetConfigKey(seatCount, packCount, packSize);
  const preset = presetByConfig instanceof Map ? presetByConfig.get(key) : null;
  const picksPerPack = sumPassPattern(preset?.pass_pattern) || packSize;
  return {
    packTotal: packCount,
    pickTotal: picksPerPack,
  };
}

export function buildDraftCardMetaMap(deck) {
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

export function buildCubeDeckBySlug(cube) {
  const decks = Array.isArray(cube?.decks) ? cube.decks : [];
  return new Map(decks.map((deck) => [normalizeName(deck.slug), deck]));
}

export function buildOpenRoomContext(room, seat, cubeDeckBySlug, presetByConfig) {
  const roomID = String(room?.room_id || '').trim();
  if (!roomID) return null;
  const seatNumber = Number.parseInt(String(seat), 10);
  const normalizedSeat = Number.isFinite(seatNumber) && seatNumber >= 0 ? seatNumber : 0;
  const roomDeckSlug = String(room?.deck_slug || '').trim();
  const roomDeck = cubeDeckBySlug instanceof Map
    ? cubeDeckBySlug.get(normalizeName(roomDeckSlug))
    : null;
  const roomDeckName = String(roomDeck?.name || roomDeckSlug || '').trim();
  const roomDeckPrintings = roomDeck && roomDeck.printings && typeof roomDeck.printings === 'object'
    ? roomDeck.printings
    : {};
  const roomDeckDoubleFaced = buildDoubleFacedMap(roomDeck);
  const roomDeckCardMeta = buildDraftCardMetaMap(roomDeck);
  const totals = resolveRoomTotals(room, presetByConfig);
  return {
    roomId: roomID,
    seat: normalizedSeat,
    roomDeckSlug,
    roomDeckPrintings,
    roomDeckName,
    roomDeckDoubleFaced,
    roomDeckCardMeta,
    roomPackTotal: totals.packTotal,
    roomPickTotal: totals.pickTotal,
  };
}
