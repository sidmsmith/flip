import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDeckTemplate } from "./flip-deck.js";
import {
  applyAction,
  createInitialState,
  scorePlayerTableau,
  shuffleDeck,
  FLIP7_BONUS,
  CARD_TYPES,
} from "./flip-engine.js";

describe("flip-deck", () => {
    const deck = buildDeckTemplate();
    assert.equal(deck.length, 96);
    const numbers = deck.filter((c) => c.type === CARD_TYPES.NUMBER);
    assert.equal(numbers.length, 78);
  });
});

describe("flip-engine scoring", () => {
  it("scores numbers and bonuses", () => {
    const player = {
      status: "stayed",
      cards: [
        { type: CARD_TYPES.NUMBER, value: 5 },
        { type: CARD_TYPES.NUMBER, value: 7 },
        { type: CARD_TYPES.BONUS, value: 4 },
      ],
      flip7ThisRound: false,
    };
    assert.equal(scorePlayerTableau(player), 16);
  });

  it("applies multiplier", () => {
    const player = {
      status: "stayed",
      cards: [
        { type: CARD_TYPES.NUMBER, value: 10 },
        { type: CARD_TYPES.MULTIPLIER, value: 2 },
      ],
      flip7ThisRound: false,
    };
    assert.equal(scorePlayerTableau(player), 20);
  });

  it("adds flip7 bonus", () => {
    const player = {
      status: "stayed",
      cards: [{ type: CARD_TYPES.NUMBER, value: 1 }],
      flip7ThisRound: true,
    };
    assert.equal(scorePlayerTableau(player, true), 1 + FLIP7_BONUS);
  });

  it("busted player scores 0", () => {
    const player = { status: "busted", cards: [], flip7ThisRound: false };
    assert.equal(scorePlayerTableau(player), 0);
  });
});

describe("flip-engine gameplay", () => {
  it("creates game with 3 players", () => {
    const state = createInitialState(["alice", "bob", "carol"], { rng: () => 0.5 });
    assert.equal(state.players.length, 3);
    assert.equal(state.phase, "playing");
    state.players.forEach((p) => {
      assert.ok(p.cards.length >= 1 || p.secondChance);
    });
  });

  it("rejects wrong player count", () => {
    assert.throws(() => createInitialState(["a", "b"]));
  });

  it("stay passes turn", () => {
    let state = createInitialState(["alice", "bob", "carol"], { rng: () => 0.5 });
    const first = state.turnIndex;
    state = applyAction(state, "stay", state.players[first].username);
    assert.notEqual(state.turnIndex, first);
  });

  it("bust on duplicate number keeps cards visible", () => {
    let state = createInitialState(["alice", "bob", "carol"], { rng: () => 0.5 });
    const player = state.players[0];
    player.cards.push({ id: "x", type: CARD_TYPES.NUMBER, value: 99 });
    state.deck.push({ id: "dup", type: CARD_TYPES.NUMBER, value: 99, label: "99" });
    state.turnIndex = 0;
    state = applyAction(state, "hit", player.username);
    assert.equal(state.players[0].status, "busted");
    assert.ok(state.players[0].cards.length >= 2);
  });

  it("second chance prevents bust", () => {
    let state = createInitialState(["alice", "bob", "carol"], { rng: () => 0.5 });
    const player = state.players[0];
    player.secondChance = { id: "sc", type: CARD_TYPES.SECOND_CHANCE };
    player.cards.push({ id: "x", type: CARD_TYPES.NUMBER, value: 50 });
    state.deck.push({ id: "dup", type: CARD_TYPES.NUMBER, value: 50, label: "50" });
    state.turnIndex = 0;
    state = applyAction(state, "hit", player.username);
    assert.equal(state.players[0].status, "active");
    assert.equal(state.players[0].secondChance, null);
  });

  it("next round deals a visible card to every player", () => {
    let state = createInitialState(["alice", "bob", "carol"], { rng: () => 0.5 });
    state.phase = "round_end";
    state = applyAction(state, "next_round", "alice");
    state.players.forEach((p) => {
      assert.ok(p.cards.length >= 1 || p.secondChance, `${p.username} needs opening card`);
    });
  });
});

describe("shuffleDeck", () => {
  it("preserves card count", () => {
    const deck = buildDeckTemplate();
    const shuffled = shuffleDeck(deck, () => 0.1);
    assert.equal(shuffled.length, 96);
  });
});
