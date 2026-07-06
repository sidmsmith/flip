/**
 * Flip 7 deck definition (The Op Games).
 * 79 number cards (one 0, plus n copies of value n for n=1..12)
 * 6 modifier cards (+2, +4, +6, +8, +10, x2)
 * 9 action cards (3 each: Freeze, Flip Three, Second Chance)
 * Total 94 cards — all shuffled together for play.
 */

export const TARGET_SCORE_DEFAULT = 200;
export const FLIP7_BONUS = 15;
export const CLASSIC_MIN_PLAYERS = 1;
export const VENGEANCE_MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
/** @deprecated use minPlayersForMode() */
export const MIN_PLAYERS = CLASSIC_MIN_PLAYERS;

export function minPlayersForMode(gameMode) {
  return gameMode === "vengeance" ? VENGEANCE_MIN_PLAYERS : CLASSIC_MIN_PLAYERS;
}

export const CARD_TYPES = {
  NUMBER: "number",
  BONUS: "bonus",
  MULTIPLIER: "multiplier",
  FREEZE: "freeze",
  FLIP_THREE: "flip_three",
  SECOND_CHANCE: "second_chance",
};

/** Build the full 94-card deck template (before shuffle). */
export function buildDeckTemplate() {
  const cards = [];
  let id = 0;

  cards.push({
    id: `n${id++}`,
    type: CARD_TYPES.NUMBER,
    value: 0,
    label: "0",
  });

  for (let value = 1; value <= 12; value++) {
    for (let copy = 0; copy < value; copy++) {
      cards.push({
        id: `n${id++}`,
        type: CARD_TYPES.NUMBER,
        value,
        label: String(value),
      });
    }
  }

  for (const value of [2, 4, 6, 8, 10]) {
    cards.push({
      id: `b${id++}`,
      type: CARD_TYPES.BONUS,
      value,
      label: `+${value}`,
    });
  }

  cards.push({
    id: `m${id++}`,
    type: CARD_TYPES.MULTIPLIER,
    value: 2,
    label: "x2",
  });

  const actions = [
    [CARD_TYPES.FREEZE, "FREEZE"],
    [CARD_TYPES.FLIP_THREE, "FLIP 3"],
    [CARD_TYPES.SECOND_CHANCE, "2nd CHANCE"],
  ];
  for (const [type, label] of actions) {
    for (let i = 0; i < 3; i++) {
      cards.push({ id: `a${id++}`, type, value: 0, label });
    }
  }

  return cards;
}

/** Card colors for UI (matches cards.webp palette). */
export const CARD_COLORS = {
  number: {
    0: "#e8e8e8",
    1: "#b8b8b8",
    2: "#b8e986",
    3: "#ff6b9d",
    4: "#4ecdc4",
    5: "#6bcb77",
    6: "#c77dff",
    7: "#ff8a65",
    8: "#d4ed91",
    9: "#ffb347",
    10: "#ff6b6b",
    11: "#74b9ff",
    12: "#636e72",
  },
  bonus: "#ffb347",
  multiplier: "#ffb347",
  freeze: "#74b9ff",
  flip_three: "#ffe066",
  second_chance: "#ff6b6b",
};
