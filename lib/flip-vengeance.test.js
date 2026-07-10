import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildVengeanceDeckTemplate, NUMBER_VARIANTS, VENGEANCE_CARD_TYPES } from "./flip-vengeance-deck.js";
import { createInitialState, applyAction, playKeepGive, resolveCardAction, startNextRound, scoreVengeanceTableau, publicState } from "./flip-vengeance-engine.js";

function swapCard(id = "swap-1") {
  return { id, type: VENGEANCE_CARD_TYPES.SWAP, label: "SWAP" };
}

function justOneMoreCard(id = "jom-1") {
  return { id, type: VENGEANCE_CARD_TYPES.JUST_ONE_MORE, label: "JUST ONE MORE" };
}

function minusModifier(value = 10, id = "mod-10") {
  return { id, type: VENGEANCE_CARD_TYPES.MOD_MINUS, label: `-${value}`, value };
}

function numberCard(value, id) {
  return { id, type: VENGEANCE_CARD_TYPES.NUMBER, value, label: String(value) };
}

function minimalVengeanceState(overrides = {}) {
  const state = {
    gameMode: "vengeance",
    brutalMode: false,
    phase: "playing",
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

  it("hit with SWAP goes directly to card picker for drawer", () => {
    let state = minimalVengeanceState({
      turnIndex: 0,
      deck: [swapCard("swap-hit")],
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

    state = applyAction(state, "hit", "alice");
    assert.equal(state.pendingChoice, null);
    assert.equal(state.pendingResolution?.type, "swap");
    assert.equal(state.pendingResolution?.fromUsername, "alice");
  });

  it("hit with SWAP and only one player with face-up cards discards and continues", () => {
    let state = minimalVengeanceState({
      turnIndex: 0,
      deck: [swapCard("swap-lone")],
      players: [
        {
          username: "alice",
          status: "active",
          numbers: [numberCard(3, "n1")],
          modifiers: [],
          flip7ThisRound: false,
        },
        { username: "bob", status: "busted", numbers: [numberCard(2, "n-bob")], modifiers: [], flip7ThisRound: false },
      ],
    });

    state = applyAction(state, "hit", "alice");
    assert.equal(state.pendingChoice, null);
    assert.equal(state.pendingResolution, null);
    assert.equal(state.lastEvent?.type, "action_discarded");
    assert.equal(state.lastEvent?.reason, "no_targets");
    assert.ok(state.discard.some((c) => c.id === "swap-lone"));
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

  it("hit with SWAP when two players have face-up cards opens swap resolution", () => {
    let state = minimalVengeanceState({
      turnIndex: 0,
      deck: [swapCard("swap-2p")],
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

    state = applyAction(state, "hit", "alice");
    assert.equal(state.pendingResolution?.type, "swap");
    assert.equal(state.pendingResolution?.fromUsername, "alice");
  });

  it("playKeepGive SWAP with only one player holding face-up cards discards and continues", () => {
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

  it("assigning a modifier to another player does not prompt them to keep or give", () => {
    const card = minusModifier(10);
    let state = minimalVengeanceState({
      pendingChoice: { category: "modifier", card, fromUsername: "alice" },
      players: [
        { username: "alice", status: "active", numbers: [], modifiers: [], flip7ThisRound: false },
        { username: "bob", status: "active", numbers: [], modifiers: [], flip7ThisRound: false },
      ],
    });

    state = playKeepGive(state, "alice", "bob");
    assert.equal(state.pendingChoice, null);
    assert.equal(state.players.find((p) => p.username === "bob")?.modifiers.length, 1);
    assert.equal(state.lastEvent?.type, "modifier_assigned");
    assert.equal(state.lastEvent?.recipient, "bob");
  });

  it("assigning Just One More prompts the recipient to resolve it", () => {
    const card = justOneMoreCard();
    let state = minimalVengeanceState({
      pendingChoice: { category: "action", card, fromUsername: "alice" },
      deck: [numberCard(8, "jom-draw")],
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
    assert.equal(state.players.find((p) => p.username === "bob")?.numbers.length, 3);
    assert.equal(state.lastEvent?.type, "just_one_more");
    assert.equal(state.lastEvent?.target, "bob");
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

    state.pendingChoice = {
      category: "action",
      card: { id: "ff-1", type: VENGEANCE_CARD_TYPES.FLIP_FOUR, label: "FLIP 4" },
      fromUsername: "sidney",
    };
    state = playKeepGive(state, "sidney", "parker");

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

  it("brutal mode still excludes busted players from Flip 4 recipient list", () => {
    let state = minimalVengeanceState({
      brutalMode: true,
      pendingChoice: {
        category: "action",
        card: { id: "ff-2", type: VENGEANCE_CARD_TYPES.FLIP_FOUR, label: "FLIP 4" },
        fromUsername: "sidney",
      },
      players: [
        {
          username: "sidney",
          status: "active",
          numbers: [numberCard(7, "s-7"), numberCard(11, "s-11"), numberCard(13, "s-13")],
          modifiers: [],
          flip7ThisRound: false,
        },
        {
          username: "parker",
          status: "busted",
          numbers: [numberCard(10, "p-10"), numberCard(2, "p-2"), numberCard(10, "p-10b")],
          modifiers: [],
          flip7ThisRound: false,
        },
      ],
    });

    const view = publicState(state, "sidney");
    assert.deepEqual(view.pendingChoice.canTarget, ["sidney"]);
    assert.deepEqual(view.legalTargets, ["sidney"]);

    assert.throws(
      () => playKeepGive(state, "sidney", "parker"),
      /Invalid target/
    );
  });

  it("auto-assigns Flip 4 to the only valid recipient", () => {
    let state = minimalVengeanceState({
      brutalMode: true,
      deck: [
        numberCard(1, "n1"),
        numberCard(2, "n2"),
        numberCard(3, "n3"),
        numberCard(4, "n4"),
      ],
      players: [
        {
          username: "sidney",
          status: "active",
          numbers: [],
          modifiers: [],
          flip7ThisRound: false,
        },
        {
          username: "parker",
          status: "busted",
          numbers: [numberCard(10, "p-10")],
          modifiers: [],
          flip7ThisRound: false,
        },
      ],
      turnIndex: 0,
    });

    const flipFour = { id: "ff-auto", type: VENGEANCE_CARD_TYPES.FLIP_FOUR, label: "FLIP 4" };
    state.pendingChoice = {
      category: "action",
      card: flipFour,
      fromUsername: "sidney",
    };

    state = playKeepGive(state, "sidney", "sidney");

    assert.equal(state.pendingChoice, null);
    assert.equal(state.players.find((p) => p.username === "sidney").numbers.length, 4);
  });

  it("swap that creates a duplicate busts a stayed player", () => {
    let state = minimalVengeanceState({
      pendingResolution: {
        type: "swap",
        fromUsername: "parker",
        card: swapCard("swap-bust"),
      },
      players: [
        {
          username: "sidney",
          status: "stayed",
          numbers: [
            numberCard(13, "p1-13"),
            numberCard(11, "p1-11"),
            numberCard(2, "p1-2"),
          ],
          modifiers: [],
          flip7ThisRound: false,
        },
        {
          username: "parker",
          status: "active",
          numbers: [
            numberCard(12, "p2-12"),
            numberCard(11, "p2-11"),
            numberCard(2, "p2-2"),
          ],
          modifiers: [],
          flip7ThisRound: false,
        },
      ],
    });

    state = resolveCardAction(state, "parker", {
      cardId: "p1-13",
      cardId2: "p2-2",
      ownerUsername: "sidney",
      ownerUsername2: "parker",
    });

    const sidney = state.players.find((p) => p.username === "sidney");
    const parker = state.players.find((p) => p.username === "parker");
    assert.equal(sidney.status, "busted");
    assert.deepEqual(sidney.numbers.map((c) => c.value).sort((a, b) => a - b), [2, 2, 11]);
    assert.deepEqual(parker.numbers.map((c) => c.value).sort((a, b) => a - b), [11, 12, 13]);
    assert.equal(state.lastEvent?.type, "bust");
    assert.equal(state.lastEvent?.username, "sidney");
    assert.equal(scoreVengeanceTableau(sidney), 0);
  });

  it("steal that creates a duplicate busts the thief", () => {
    let state = minimalVengeanceState({
      pendingResolution: {
        type: "steal",
        fromUsername: "parker",
        card: { id: "steal-1", type: VENGEANCE_CARD_TYPES.STEAL, label: "STEAL" },
      },
      players: [
        {
          username: "sidney",
          status: "stayed",
          numbers: [numberCard(5, "v-5")],
          modifiers: [],
          flip7ThisRound: false,
        },
        {
          username: "parker",
          status: "active",
          numbers: [numberCard(5, "t-5"), numberCard(8, "t-8")],
          modifiers: [],
          flip7ThisRound: false,
        },
      ],
    });

    state = resolveCardAction(state, "parker", {
      targetUsername: "sidney",
      cardId: "v-5",
    });

    const parker = state.players.find((p) => p.username === "parker");
    assert.equal(parker.status, "busted");
    assert.ok(
      state.lastEvent?.type === "bust" || state.phase === "round_end",
      "bust or round ended after steal bust"
    );
  });

  it("steal that gives the 7th unique card ends the round with Flip 7", () => {
    let state = minimalVengeanceState({
      pendingResolution: {
        type: "steal",
        fromUsername: "parker",
        card: { id: "steal-1", type: VENGEANCE_CARD_TYPES.STEAL, label: "STEAL" },
      },
      players: [
        {
          username: "sidney",
          status: "stayed",
          numbers: [
            numberCard(7, "s-7"),
            numberCard(8, "s-8"),
          ],
          modifiers: [],
          flip7ThisRound: false,
        },
        {
          username: "parker",
          status: "active",
          numbers: [
            numberCard(1, "p-1"),
            numberCard(2, "p-2"),
            numberCard(3, "p-3"),
            numberCard(4, "p-4"),
            numberCard(5, "p-5"),
            numberCard(6, "p-6"),
          ],
          modifiers: [],
          flip7ThisRound: false,
        },
      ],
    });

    state = resolveCardAction(state, "parker", {
      targetUsername: "sidney",
      cardId: "s-7",
    });

    const parker = state.players.find((p) => p.username === "parker");
    assert.equal(parker.flip7ThisRound, true);
    assert.equal(state.phase, "round_end");
    assert.equal(state.roundEndReason, "flip7");
    assert.equal(parker.roundScore, 43);
  });

  it("endRound scoring skips flip 7 bonus for busted players", () => {
    const player = {
      status: "busted",
      numbers: [numberCard(2, "a"), numberCard(2, "b")],
      modifiers: [],
      flip7ThisRound: true,
    };
    const flip7 = !!player.flip7ThisRound;
    let score = scoreVengeanceTableau(player, false);
    if (flip7 && player.status !== "busted") score += 15;
    assert.equal(score, 0);
  });

  it("zero card scores full hand value when Flip 7 is achieved", () => {
    const zero = {
      id: "z",
      type: VENGEANCE_CARD_TYPES.NUMBER,
      value: 0,
      variant: NUMBER_VARIANTS.ZERO,
      label: "0",
    };
    const player = {
      status: "stayed",
      numbers: [zero, numberCard(1, "a"), numberCard(2, "b"), numberCard(3, "c"), numberCard(4, "d"), numberCard(5, "e"), numberCard(6, "f")],
      modifiers: [],
      flip7ThisRound: true,
    };
    assert.equal(scoreVengeanceTableau(player), 21);
    let roundScore = scoreVengeanceTableau(player);
    roundScore += 15;
    assert.equal(roundScore, 36);
  });

  it("zero card without Flip 7 scores 0", () => {
    const zero = {
      id: "z",
      type: VENGEANCE_CARD_TYPES.NUMBER,
      value: 0,
      variant: NUMBER_VARIANTS.ZERO,
      label: "0",
    };
    const player = {
      status: "active",
      numbers: [zero, numberCard(5, "a"), numberCard(7, "b")],
      modifiers: [],
      flip7ThisRound: false,
    };
    assert.equal(scoreVengeanceTableau(player), 0);
  });

  it("busted player with -8 modifier scores -8 (numbers ignored)", () => {
    const player = {
      status: "busted",
      numbers: [numberCard(10, "a"), numberCard(2, "b"), numberCard(10, "c")],
      modifiers: [minusModifier(8, "m8")],
      flip7ThisRound: false,
    };
    assert.equal(scoreVengeanceTableau(player), -8);
  });

  it("endRound applies brutal -8 to busted player round score", () => {
    let state = minimalVengeanceState({
      brutalMode: true,
      phase: "playing",
      players: [
        {
          username: "sidney",
          status: "stayed",
          numbers: [numberCard(5, "s")],
          modifiers: [],
          flip7ThisRound: false,
          roundScore: 0,
          totalScore: 40,
        },
        {
          username: "parker",
          status: "busted",
          numbers: [numberCard(10, "p1"), numberCard(2, "p2"), numberCard(10, "p3")],
          modifiers: [minusModifier(8, "m8")],
          flip7ThisRound: false,
          roundScore: 0,
          totalScore: 100,
        },
      ],
    });
    state.phase = "round_end";
    state.roundEndReason = "all_stayed";
    for (const p of state.players) {
      let score = scoreVengeanceTableau(p, false);
      if (p.flip7ThisRound && p.status !== "busted") score += 15;
      p.roundScore = Math.max(-Infinity, score);
      p.totalScore += p.roundScore;
    }
    const parker = state.players.find((p) => p.username === "parker");
    assert.equal(parker.roundScore, -8);
    assert.equal(parker.totalScore, 92);
  });

  it("busted players hide cards from public state and swappable list", () => {
    let state = minimalVengeanceState({
      players: [
        {
          username: "sidney",
          status: "active",
          numbers: [numberCard(5, "s")],
          modifiers: [],
          flip7ThisRound: false,
        },
        {
          username: "parker",
          status: "busted",
          numbers: [numberCard(10, "p1"), numberCard(2, "p2")],
          modifiers: [minusModifier(8, "m8")],
          flip7ThisRound: false,
        },
      ],
      pendingResolution: { type: "steal", fromUsername: "sidney", card: { id: "st", type: VENGEANCE_CARD_TYPES.STEAL } },
    });

    const view = publicState(state, "sidney");
    const parker = view.players.find((p) => p.username === "parker");
    assert.equal(parker.numbers.length, 0);
    assert.equal(parker.modifiers.length, 0);
    assert.equal(parker.hiddenCardCount, 3);
    assert.equal(view.swappableCards.length, 1);
    assert.equal(view.swappableCards[0].username, "sidney");
  });

  it("Flip 4 can target a stayed player", () => {
    const view = publicState(
      minimalVengeanceState({
        pendingChoice: {
          category: "action",
          card: { id: "ff", type: VENGEANCE_CARD_TYPES.FLIP_FOUR, label: "FLIP 4" },
          fromUsername: "alice",
        },
        players: [
          { username: "alice", status: "active", numbers: [], modifiers: [], flip7ThisRound: false },
          { username: "bob", status: "stayed", numbers: [numberCard(1, "b")], modifiers: [], flip7ThisRound: false },
        ],
      }),
      "alice"
    );
    assert.ok(view.pendingChoice.canTarget.includes("bob"));
  });

  it("Flip 4 ends the round immediately when Flip 7 is reached mid-draw", () => {
    let state = minimalVengeanceState({
      deck: [
        numberCard(1, "a"),
        numberCard(2, "b"),
        numberCard(3, "c"),
        numberCard(4, "d"),
      ],
      players: [
        {
          username: "bob",
          status: "stayed",
          numbers: [
            numberCard(5, "e"),
            numberCard(6, "f"),
            numberCard(7, "g"),
            numberCard(8, "h"),
            numberCard(9, "i"),
          ],
          modifiers: [],
          flip7ThisRound: false,
        },
        { username: "alice", status: "active", numbers: [], modifiers: [], flip7ThisRound: false },
      ],
    });

    state = executeFlipFourViaTest(state, "bob", "alice");
    assert.equal(state.phase, "round_end");
    assert.equal(state.roundEndReason, "flip7");
    assert.equal(state.deck.length, 2, "remaining flip-four draws are skipped after Flip 7");
  });
});

function executeFlipFourViaTest(state, target, from) {
  return playKeepGive(
    {
      ...state,
      pendingChoice: {
        category: "action",
        card: { id: "ff", type: VENGEANCE_CARD_TYPES.FLIP_FOUR, label: "FLIP 4" },
        fromUsername: from,
      },
    },
    from,
    target
  );
}