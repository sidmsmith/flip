import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildVengeanceDeckTemplate, VENGEANCE_CARD_TYPES } from "./flip-vengeance-deck.js";
import { createInitialState, applyAction } from "./flip-vengeance-engine.js";

describe("flip-vengeance-deck", () => {
  it("has 108 cards total", () => {
    const deck = buildVengeanceDeckTemplate();
    assert.equal(deck.length, 108);
    assert.equal(deck.filter((c) => c.type === VENGEANCE_CARD_TYPES.NUMBER).length, 92);
    assert.equal(deck.filter((c) => c.type === VENGEANCE_CARD_TYPES.FLIP_FOUR).length, 2);
  });
});

describe("flip-vengeance-engine", () => {
  it("creates a 3-player vengeance game", () => {
    const state = createInitialState(["alice", "bob", "carol"], { rng: () => 0.5 });
    assert.equal(state.gameMode, "vengeance");
    assert.equal(state.deck.length + 3, 108 - 0); // minus dealt cards
    assert.ok(state.players.length === 3);
  });

  it("stay passes turn", () => {
    let state = createInitialState(["alice", "bob", "carol"], { rng: () => 0.5 });
    if (state.pendingChoice) return; // opening action — skip
    const first = state.turnIndex;
    const who = state.players[first].username;
    if (state.players.find((p) => p.username === who)?.status !== "active") return;
    state = applyAction(state, "stay", who);
    assert.notEqual(state.turnIndex, first);
  });
});
