/**
 * Flip 7 With a Vengeance deck (108 cards).
 * 92 number cards (0 + 1..13 pyramid; Unlucky 7, Lucky 13 specials)
 * 6 modifier cards (÷2, −2, −4, −6, −8, −10)
 * 10 action cards (2 each: Just One More, Swap, Steal, Discard, Flip Four)
 */

export const VENGEANCE_CARD_TYPES = {
  NUMBER: "number",
  MOD_DIVIDE: "mod_divide",
  MOD_MINUS: "mod_minus",
  JUST_ONE_MORE: "just_one_more",
  SWAP: "swap",
  STEAL: "steal",
  DISCARD: "discard",
  FLIP_FOUR: "flip_four",
};

export const NUMBER_VARIANTS = {
  NORMAL: "normal",
  ZERO: "zero",
  UNLUCKY_7: "unlucky_7",
  LUCKY_13: "lucky_13",
};

/** Build the full 108-card Vengeance deck template (before shuffle). */
export function buildVengeanceDeckTemplate() {
  const cards = [];
  let id = 0;

  cards.push({
    id: `vn${id++}`,
    type: VENGEANCE_CARD_TYPES.NUMBER,
    value: 0,
    variant: NUMBER_VARIANTS.ZERO,
    label: "0",
  });

  for (let value = 1; value <= 13; value++) {
    for (let copy = 0; copy < value; copy++) {
      let variant = NUMBER_VARIANTS.NORMAL;
      let label = String(value);
      if (value === 7 && copy === value - 1) {
        variant = NUMBER_VARIANTS.UNLUCKY_7;
        label = "7☠";
      } else if (value === 13 && copy === value - 1) {
        variant = NUMBER_VARIANTS.LUCKY_13;
        label = "13★";
      }
      cards.push({
        id: `vn${id++}`,
        type: VENGEANCE_CARD_TYPES.NUMBER,
        value,
        variant,
        label,
      });
    }
  }

  cards.push({
    id: `vm${id++}`,
    type: VENGEANCE_CARD_TYPES.MOD_DIVIDE,
    value: 2,
    label: "÷2",
  });

  for (const value of [2, 4, 6, 8, 10]) {
    cards.push({
      id: `vm${id++}`,
      type: VENGEANCE_CARD_TYPES.MOD_MINUS,
      value,
      label: `−${value}`,
    });
  }

  const actions = [
    [VENGEANCE_CARD_TYPES.JUST_ONE_MORE, "JUST 1 MORE"],
    [VENGEANCE_CARD_TYPES.SWAP, "SWAP"],
    [VENGEANCE_CARD_TYPES.STEAL, "STEAL"],
    [VENGEANCE_CARD_TYPES.DISCARD, "DISCARD"],
    [VENGEANCE_CARD_TYPES.FLIP_FOUR, "FLIP 4"],
  ];
  for (const [type, label] of actions) {
    for (let i = 0; i < 2; i++) {
      cards.push({ id: `va${id++}`, type, value: 0, label });
    }
  }

  return cards;
}

export const VENGEANCE_CARD_COLORS = {
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
    13: "#a29bfe",
  },
  mod_divide: "#fd79a8",
  mod_minus: "#fdcb6e",
  just_one_more: "#55efc4",
  swap: "#74b9ff",
  steal: "#e17055",
  discard: "#dfe6e9",
  flip_four: "#ffe066",
};
