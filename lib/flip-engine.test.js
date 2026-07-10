import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDeckTemplate } from "./flip-deck.js";
import {
  applyAction,
  createInitialState,
  dealOpeningCards,
  publicState,
  scorePlayerTableau,
  shuffleDeck,
  FLIP7_BONUS,
  CARD_TYPES,
} from "./flip-engine.js";

describe("flip-deck", () => {
  it("has 94 cards total", () => {
    const deck = buildDeckTemplate();
    assert.equal(deck.length, 94);
    const numbers = deck.filter((c) => c.type === CARD_TYPES.NUMBER);
    assert.equal(numbers.length, 79);
    const freeze = deck.filter((c) => c.type === CARD_TYPES.FREEZE);
    assert.equal(freeze.length, 3);
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

  it("publicState exposes projected total while round is in play", () => {
    const state = createInitialState(["alice", "bob"], { rng: () => 0.5 });
    state.players[0].totalScore = 40;
    state.players[0].cards = [
      { id: "n5", type: CARD_TYPES.NUMBER, value: 5, label: "5" },
      { id: "n7", type: CARD_TYPES.NUMBER, value: 7, label: "7" },
    ];
    state.players[0].status = "active";

    const view = publicState(state, "alice");
    assert.equal(view.gameMode, "classic");
    const alice = view.players.find((p) => p.username === "alice");
    assert.equal(alice.tableauScore, 12);
    assert.equal(alice.projectedRoundScore, 12);
    assert.equal(alice.projectedTotalScore, 52);
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

  it("rejects empty player list", () => {
    assert.throws(() => createInitialState([]));
  });

  it("allows 1 and 2 players", () => {
    assert.doesNotThrow(() => createInitialState(["a"]));
    assert.doesNotThrow(() => createInitialState(["a", "b"]));
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
    const pendingDrawers = new Set(
      (state.pendingActionQueue || []).map((a) => a.fromUsername)
    );
    state.players.forEach((p) => {
      assert.ok(
        p.cards.length >= 1 || p.secondChance || pendingDrawers.has(p.username),
        `${p.username} needs opening card`
      );
    });
  });

  it("next round does not rebuild the full deck", () => {
    let state = createInitialState(["alice", "bob", "carol"], { rng: () => 0.5 });
    const sentinel = { id: "sentinel-unique", type: CARD_TYPES.NUMBER, value: 11, label: "11" };
    state.players[0].cards.push(sentinel);
    state.phase = "round_end";
    state = applyAction(state, "next_round", "alice");

    const allIds = [
      ...state.deck.map((c) => c.id),
      ...state.discard.map((c) => c.id),
      ...state.players.flatMap((p) => [
        ...p.cards.map((c) => c.id),
        ...(p.secondChance ? [p.secondChance.id] : []),
      ]),
    ];
    assert.ok(allIds.includes("sentinel-unique"));
    assert.equal(state.round, 2);
  });

  it("mid-round shuffle keeps tableau cards including busted players", () => {
    let state = createInitialState(["alice", "bob", "carol"], { rng: () => 0.5 });
    const bustCards = [{ id: "b1", type: CARD_TYPES.NUMBER, value: 5 }];
    state.players[0].cards = bustCards;
    state.players[0].status = "busted";
    state.deck = [];
    state.discard = [{ id: "d1", type: CARD_TYPES.NUMBER, value: 1, label: "1" }];
    state.turnIndex = 1;
    state.players[1].status = "active";
    state = applyAction(state, "hit", "bob");
    assert.deepEqual(state.players[0].cards, bustCards);
    assert.equal(state.players[0].status, "busted");
    assert.ok(state.deck.length >= 0);
  });

  it("opening deal action card queues resolution instead of burying", () => {
    const deck = buildDeckTemplate();
    const freeze = deck.find((c) => c.type === CARD_TYPES.FREEZE);
    const numbers = deck.filter((c) => c.type === CARD_TYPES.NUMBER);
    const ordered = [freeze, numbers[0], numbers[1], numbers[2], ...deck.filter((c) => c !== freeze && c !== numbers[0] && c !== numbers[1] && c !== numbers[2])];

    let state = createInitialState(["alice", "bob", "carol"], {
      rng: () => 0.5,
    });
    state.deck = ordered.slice().reverse();
    dealOpeningCards(state);

    assert.ok(state.pendingAction);
    assert.equal(state.pendingAction.fromUsername, "alice");
    assert.equal(state.pendingAction.type, CARD_TYPES.FREEZE);
    assert.equal(state.resolvingOpeningActions, true);
    assert.equal(state.pendingActionQueue.length, 1);
  });

  it("opening deal freeze can target self", () => {
    const deck = buildDeckTemplate();
    const freeze = deck.find((c) => c.type === CARD_TYPES.FREEZE);
    const numbers = deck.filter((c) => c.type === CARD_TYPES.NUMBER);
    const ordered = [freeze, numbers[0], numbers[1], numbers[2], ...deck.filter((c) => c !== freeze && c !== numbers[0] && c !== numbers[1] && c !== numbers[2])];

    let state = createInitialState(["alice", "bob", "carol"], { rng: () => 0.5 });
    state.deck = ordered.slice().reverse();
    dealOpeningCards(state);

    state = applyAction(state, "play_action", "alice", { targetUsername: "alice" });
    assert.equal(state.players[0].status, "frozen");
    assert.equal(state.pendingAction, null);
    assert.equal(state.resolvingOpeningActions, false);
  });

  it("solo game flags solo and auto-resolves opening action", () => {
    const deck = buildDeckTemplate();
    const freeze = deck.find((c) => c.type === CARD_TYPES.FREEZE);
    const numbers = deck.filter((c) => c.type === CARD_TYPES.NUMBER);
    const ordered = [
      freeze,
      numbers[0],
      ...deck.filter((c) => c !== freeze && c !== numbers[0]),
    ];

    let state = createInitialState(["solo"], { rng: () => 0.5 });
    assert.equal(state.solo, true);
    state.deck = ordered.slice().reverse();
    dealOpeningCards(state);
    assert.equal(state.pendingAction, null);
  });
});

describe("shuffleDeck", () => {
  it("preserves card count", () => {
    const deck = buildDeckTemplate();
    const shuffled = shuffleDeck(deck, () => 0.1);
    assert.equal(shuffled.length, 94);
  });
});
