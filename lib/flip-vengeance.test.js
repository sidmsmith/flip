import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildVengeanceDeckTemplate, VENGEANCE_CARD_TYPES } from "./flip-vengeance-deck.js";
import { createInitialState, applyAction, playKeepGive, resolveCardAction, startNextRound } from "./flip-vengeance-engine.js";

function swapCard(id = "swap-1") {
  return { id, type: VENGEANCE_CARD_TYPES.SWAP, label: "SWAP" };
}

function justOneMoreCard(id = "jom-1") {
  return { id, type: VENGEANCE_CARD_TYPES.JUST_ONE_MORE, label: "JUST ONE MORE" };
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
        {
          username: "bob",
          status: "busted",
          numbers: [numberCard(2, "n-bob")],
          modifiers: [],
          flip7ThisRound: false,
        },
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

  it("playKeepGive SWAP with only one player holding cards discards and continues", () => {
    const card = swapCard();
    let state = minimalVengeanceState({
      pendingChoice: { category: "action", card, fromUsername: "parker" },
      turnIndex: 0,
      players: [
        { username: "parker", status: "active", numbers: [], modifiers: [], flip7ThisRound: false },
        {
          username: "sidney",
          status: "active",
          numbers: [numberCard(11, "n1"), numberCard(4, "n2")],
          modifiers: [],
          flip7ThisRound: false,
        },
      ],
    });

    state = playKeepGive(state, "parker", "parker");
    assert.equal(state.pendingResolution, null);
    assert.equal(state.lastEvent?.type, "action_discarded");
    assert.equal(state.lastEvent?.reason, "no_targets");
    assert.equal(state.turnIndex, 1);
  });

  it("resolveCardAction can cancel stuck SWAP resolution", () => {
    const card = swapCard("swap-stuck");
    let state = minimalVengeanceState({
      pendingResolution: { type: "swap", fromUsername: "parker", card },
      turnIndex: 0,
      players: [
        { username: "parker", status: "active", numbers: [], modifiers: [], flip7ThisRound: false },
        {
          username: "sidney",
          status: "active",
          numbers: [numberCard(11, "n1"), numberCard(4, "n2")],
          modifiers: [],
          flip7ThisRound: false,
        },
      ],
    });

    state = resolveCardAction(state, "parker", { cancel: true });
    assert.equal(state.pendingResolution, null);
    assert.equal(state.lastEvent?.type, "action_discarded");
    assert.equal(state.lastEvent?.reason, "no_valid_swap");
    assert.equal(state.turnIndex, 1);
  });

  it("Just One More bust advances turn to the next active player", () => {
    const card = justOneMoreCard();
    let state = minimalVengeanceState({
      pendingChoice: { category: "action", card, fromUsername: "parker" },
      turnIndex: 1,
      deck: [numberCard(7, "bust-7")],
      players: [
        { username: "parker", status: "active", numbers: [], modifiers: [], flip7ThisRound: false },
        {
          username: "sidney",
          status: "active",
          numbers: [numberCard(7, "have-7")],
          modifiers: [],
          flip7ThisRound: false,
        },
      ],
    });

    state = playKeepGive(state, "parker", "sidney");
    assert.equal(state.players.find((p) => p.username === "sidney")?.status, "busted");
    assert.equal(state.players[state.turnIndex]?.username, "parker");
  });

  it("between rounds recycles tableau cards to discard instead of side pile", () => {
    let state = createInitialState(["alice", "bob"], { rng: () => 0.5 });
    state.players[0].numbers = [
      { id: "hold-1", type: VENGEANCE_CARD_TYPES.NUMBER, value: 8, label: "8", variant: "normal" },
    ];
    state.phase = "round_end";
    state.round = 1;
    state.sidePile = [{ id: "legacy-1", type: VENGEANCE_CARD_TYPES.NUMBER, value: 3, label: "3", variant: "normal" }];

    state = startNextRound(state, () => 0.5);

    assert.equal(state.sidePile.length, 0);
    const pool = state.deck.length + state.discard.length;
    assert.ok(pool >= 2, "tableau and legacy side cards should rejoin the draw pool");
    assert.ok(
      state.deck.some((c) => c.id === "hold-1") ||
        state.discard.some((c) => c.id === "hold-1") ||
        state.deck.some((c) => c.id === "legacy-1") ||
        state.discard.some((c) => c.id === "legacy-1")
    );
  });

  it("Flip Four draws all four cards before resolving a deferred Discard", () => {
    const discardAction = { id: "d-1", type: VENGEANCE_CARD_TYPES.DISCARD, label: "DISCARD" };
    let state = minimalVengeanceState({
      turnIndex: 0,
      deck: [
        numberCard(2, "n2"),
        numberCard(3, "n3"),
        numberCard(4, "n4"),
        discardAction,
      ],
      players: [
        { username: "parker", status: "active", numbers: [], modifiers: [], flip7ThisRound: false },
        { username: "sidney", status: "active", numbers: [], modifiers: [], flip7ThisRound: false },
      ],
    });

    state.pendingResolution = {
      type: "flip_four_pick",
      fromUsername: "sidney",
      card: { id: "ff-1", type: VENGEANCE_CARD_TYPES.FLIP_FOUR, label: "FLIP 4" },
    };
    state = resolveCardAction(state, "sidney", { targetUsername: "parker" }, () => 0.5);

    const parker = state.players.find((p) => p.username === "parker");
    assert.equal(state.deck.length, 0, "all four flip-four cards should be drawn");
    assert.equal(parker.numbers.length, 3);
    assert.ok(parker.numbers.some((c) => c.id === "n2"));
    assert.ok(parker.numbers.some((c) => c.id === "n3"));
    assert.ok(parker.numbers.some((c) => c.id === "n4"));
    const discardResolved =
      state.discard.some((c) => c.id === "d-1") ||
      state.pendingResolution?.type === "discard" ||
      state.pendingChoice?.card?.id === "d-1";
    assert.ok(discardResolved, "deferred discard resolves only after all four draws");
    if (!state.pendingChoice && !state.pendingResolution) {
      assert.equal(state.flipFourPending, null);
    }
  });
});