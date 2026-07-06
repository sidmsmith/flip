import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildVengeanceDeckTemplate, VENGEANCE_CARD_TYPES } from "./flip-vengeance-deck.js";
import { createInitialState, applyAction, playKeepGive, resolveCardAction } from "./flip-vengeance-engine.js";

function swapCard(id = "swap-1") {
  return { id, type: VENGEANCE_CARD_TYPES.SWAP, label: "SWAP" };
}

function numberCard(value, id) {
  return { id, type: VENGEANCE_CARD_TYPES.NUMBER, value, label: String(value) };
}

function minimalVengeanceState(overrides = {}) {
  const state = {
    gameMode: "vengeance",
    brutalMode: false,
    players: [
      { username: "alice", status: "active", numbers: [], modifiers: [], flip7ThisRound: false },
      { username: "bob", status: "busted", numbers: [], modifiers: [], flip7ThisRound: false },
    ],
    turnIndex: 0,
    deck: [],
    discard: [],
    sidePile: [],
    pendingChoice: null,
    pendingChoiceQueue: [],
    pendingResolution: null,
    resolvingOpeningDeal: false,
    justOneMorePendingStay: null,
    lastEvent: null,
    ...overrides,
  };
  return state;
}
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

  it("playKeepGive SWAP as only active player does not throw", () => {
    const card = swapCard();
    let state = minimalVengeanceState({
      pendingChoice: { category: "action", card, fromUsername: "alice" },
      players: [
        {
          username: "alice",
          status: "active",
          numbers: [numberCard(3, "n1"), numberCard(5, "n2")],
          modifiers: [],
          flip7ThisRound: false,
        },
        { username: "bob", status: "busted", numbers: [], modifiers: [], flip7ThisRound: false },
      ],
    });

    state = playKeepGive(state, "alice", "alice");
    assert.equal(state.pendingChoice, null);
    assert.equal(state.pendingResolution?.type, "swap");
    assert.equal(state.pendingResolution?.fromUsername, "alice");
  });

  it("playKeepGive SWAP with fewer than two cards discards and continues", () => {
    const card = swapCard();
    let state = minimalVengeanceState({
      pendingChoice: { category: "action", card, fromUsername: "alice" },
      players: [
        {
          username: "alice",
          status: "active",
          numbers: [numberCard(3, "n1")],
          modifiers: [],
          flip7ThisRound: false,
        },
        { username: "bob", status: "busted", numbers: [], modifiers: [], flip7ThisRound: false },
      ],
    });

    state = playKeepGive(state, "alice", "alice");
    assert.equal(state.pendingChoice, null);
    assert.equal(state.pendingResolution, null);
    assert.equal(state.lastEvent?.type, "action_discarded");
    assert.equal(state.lastEvent?.reason, "no_targets");
    assert.ok(state.discard.some((c) => c.id === "swap-1"));
    assert.equal(state.turnIndex, 0);
  });

  it("resolveCardAction swap rejects two cards from the same player", () => {
    const state = minimalVengeanceState({
      pendingResolution: { type: "swap", fromUsername: "alice", card: swapCard() },
      players: [
        {
          username: "alice",
          status: "active",
          numbers: [numberCard(3, "n1"), numberCard(5, "n2")],
          modifiers: [],
          flip7ThisRound: false,
        },
        {
          username: "bob",
          status: "busted",
          numbers: [numberCard(7, "n3")],
          modifiers: [],
          flip7ThisRound: false,
        },
      ],
    });

    assert.throws(
      () =>
        resolveCardAction(state, "alice", {
          cardId: "n1",
          cardId2: "n2",
          ownerUsername: "alice",
          ownerUsername2: "alice",
        }),
      /different players/
    );
  });

  it("playKeepGive giving SWAP assigns resolution to the recipient", () => {
    const card = swapCard();
    let state = minimalVengeanceState({
      pendingChoice: { category: "action", card, fromUsername: "alice" },
      players: [
        {
          username: "alice",
          status: "active",
          numbers: [numberCard(3, "n1"), numberCard(5, "n2")],
          modifiers: [],
          flip7ThisRound: false,
        },
        {
          username: "bob",
          status: "active",
          numbers: [numberCard(7, "n3"), numberCard(9, "n4")],
          modifiers: [],
          flip7ThisRound: false,
        },
      ],
    });

    state = playKeepGive(state, "alice", "bob");
    assert.equal(state.pendingChoice, null);
    assert.equal(state.pendingResolution?.type, "swap");
    assert.equal(state.pendingResolution?.fromUsername, "bob");
  });
});