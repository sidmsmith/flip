import {
  buildDeckTemplate,
  CARD_TYPES,
  FLIP7_BONUS,
  CLASSIC_MIN_PLAYERS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TARGET_SCORE_DEFAULT,
} from "./flip-deck.js";

export { MIN_PLAYERS, MAX_PLAYERS, TARGET_SCORE_DEFAULT, FLIP7_BONUS, CARD_TYPES };

/** Fisher–Yates shuffle (optional seeded rng for tests). */
export function shuffleDeck(cards, rng = Math.random) {
  const deck = cards.map((c) => ({ ...c }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function emptyPlayer(username, seatIndex) {
  return {
    username,
    seatIndex,
    cards: [],
    secondChance: null,
    status: "active",
    roundScore: 0,
    totalScore: 0,
    flip7ThisRound: false,
  };
}

export function createInitialState(usernames, options = {}) {
  const names = usernames.map((u) => u.toLowerCase());
  if (names.length < CLASSIC_MIN_PLAYERS || names.length > MAX_PLAYERS) {
    throw new Error(`Classic Flip 7 requires ${CLASSIC_MIN_PLAYERS}-${MAX_PLAYERS} players.`);
  }

  const targetScore = options.targetScore ?? TARGET_SCORE_DEFAULT;
  const rng = options.rng ?? Math.random;

  const players = names.map((username, i) => emptyPlayer(username, i));
  const deck = shuffleDeck(buildDeckTemplate(), rng);

  const state = {
    solo: names.length === 1,
    phase: "playing",
    targetScore,
    round: 1,
    dealerIndex: 0,
    turnIndex: 0,
    deck,
    discard: [],
    players,
    pendingAction: null,
    pendingActionQueue: [],
    resolvingOpeningActions: false,
    forcedHitsRemaining: 0,
    forcedHitTarget: null,
    roundEndReason: null,
    roundWinner: null,
    winner: null,
    lastEvent: null,
  };

  dealOpeningCards(state, { isNewGame: true });
  return state;
}

/** Return scored tableaus to the discard pile between rounds. */
function collectPlayerCardsToDiscard(state) {
  for (const player of state.players) {
    for (const card of player.cards) {
      state.discard.push(card);
    }
    player.cards = [];
    if (player.secondChance) {
      state.discard.push(player.secondChance);
      player.secondChance = null;
    }
  }
}

/** Shuffle discard into draw pile when empty; player tableaus stay in place. */
function refillDeckFromDiscard(state, rng = Math.random) {
  if (state.deck.length === 0 && state.discard.length > 0) {
    state.deck = shuffleDeck(state.discard, rng);
    state.discard = [];
  }
}

function numberValues(player) {
  return player.cards
    .filter((c) => c.type === CARD_TYPES.NUMBER)
    .map((c) => c.value);
}

function uniqueNumberCount(player) {
  return new Set(numberValues(player)).size;
}

function hasDuplicateNumber(player, value) {
  return numberValues(player).filter((v) => v === value).length > 1;
}

/** Score cards on the table (ignores bust status — for showing busted hands). */
export function scoreCardsTableau(cards, flip7Bonus = false) {
  const numbers = cards.filter((c) => c.type === CARD_TYPES.NUMBER);
  const bonuses = cards.filter((c) => c.type === CARD_TYPES.BONUS);
  const multipliers = cards.filter((c) => c.type === CARD_TYPES.MULTIPLIER);
  let sum = numbers.reduce((s, c) => s + c.value, 0);
  sum += bonuses.reduce((s, c) => s + c.value, 0);
  for (const _ of multipliers) sum *= 2;
  return sum;
}

/** Score a player's tableau for the current round. */
export function scorePlayerTableau(player, flip7Bonus = false) {
  if (player.status === "busted") return 0;

  return scoreCardsTableau(player.cards, flip7Bonus) +
    (flip7Bonus && player.flip7ThisRound ? FLIP7_BONUS : 0);
}

export function dealOpeningCards(state, { isNewGame = false, rng = Math.random } = {}) {
  const actionQueue = [];

  if (!isNewGame) {
    collectPlayerCardsToDiscard(state);
  }

  for (const player of state.players) {
    if (isNewGame) {
      player.cards = [];
    }
    player.secondChance = null;
    player.status = "active";
    player.roundScore = 0;
    player.flip7ThisRound = false;

    refillDeckFromDiscard(state, rng);
    if (state.deck.length === 0) throw new Error("Deck empty.");

    const card = state.deck.pop();
    const result = applyDrawnCard(player, card, { initialDeal: true });
    if (
      result.action === CARD_TYPES.FREEZE ||
      result.action === CARD_TYPES.FLIP_THREE
    ) {
      actionQueue.push({
        type: result.action,
        fromUsername: player.username,
        card,
      });
    }
  }

  state.pendingActionQueue = actionQueue;
  state.resolvingOpeningActions = actionQueue.length > 0;

  if (actionQueue.length > 0) {
    state.pendingAction = actionQueue[0];
    state.turnIndex = state.players.findIndex(
      (p) => p.username === actionQueue[0].fromUsername
    );
  } else {
    state.pendingAction = null;
    beginNormalPlay(state);
  }

  return maybeAutoResolveSoloAction(state);
}

/** Solo classic: action cards always apply to the only player. */
function maybeAutoResolveSoloAction(state) {
  if (!state.solo) return state;
  while (state.pendingAction) {
    const user = state.players[0].username;
    playAction(state, user, user);
  }
  return state;
}

function beginNormalPlay(state) {
  state.turnIndex = (state.dealerIndex + 1) % state.players.length;
  advanceTurn(state);
}

function continueOpeningActionsOrBeginPlay(state) {
  if (state.pendingActionQueue.length > 0) {
    state.pendingAction = state.pendingActionQueue[0];
    const idx = state.players.findIndex(
      (p) => p.username === state.pendingAction.fromUsername
    );
    if (idx >= 0) state.turnIndex = idx;
    return state;
  }

  state.pendingAction = null;
  state.resolvingOpeningActions = false;
  beginNormalPlay(state);
  const endReason = checkRoundEnd(state);
  if (endReason) return endRound(state, endReason);
  return state;
}

function finishForcedHits(state) {
  state.forcedHitTarget = null;
  if (state.resolvingOpeningActions) {
    return continueOpeningActionsOrBeginPlay(state);
  }
  advanceTurn(state);
  const endReason = checkRoundEnd(state);
  if (endReason) return endRound(state, endReason);
  return state;
}

function applyDrawnCard(player, card, { initialDeal = false } = {}) {
  if (card.type === CARD_TYPES.NUMBER) {
    player.cards.push(card);
    if (!initialDeal && hasDuplicateNumber(player, card.value)) {
      return { bust: true, card };
    }
    if (uniqueNumberCount(player) >= 7) {
      player.flip7ThisRound = true;
      return { flip7: true, card };
    }
    return { card };
  }

  if (card.type === CARD_TYPES.BONUS || card.type === CARD_TYPES.MULTIPLIER) {
    player.cards.push(card);
    return { card };
  }

  if (card.type === CARD_TYPES.SECOND_CHANCE) {
    player.secondChance = card;
    return { card, held: true };
  }

  return { card, action: card.type };
}

function activePlayers(state) {
  return state.players.filter((p) => p.status === "active");
}

function allRoundDone(state) {
  const act = activePlayers(state);
  if (act.length === 0) return true;
  if (state.players.some((p) => p.flip7ThisRound)) return true;
  return act.every((p) => false); // all stayed or busted handled below
}

function checkRoundEnd(state) {
  if (state.players.some((p) => p.flip7ThisRound)) {
    return "flip7";
  }
  const canAct = state.players.filter((p) => p.status === "active");
  if (canAct.length === 0) {
    const anyScored = state.players.some(
      (p) => p.status === "stayed" || p.status === "frozen"
    );
    if (anyScored) return "all_stayed";
    return "all_busted";
  }
  return null;
}

function advanceTurn(state) {
  const n = state.players.length;
  let next = (state.turnIndex + 1) % n;
  let guard = 0;
  while (guard < n) {
    const p = state.players[next];
    if (p.status === "active") {
      state.turnIndex = next;
      return;
    }
    next = (next + 1) % n;
    guard++;
  }
}

function currentPlayer(state) {
  return state.players[state.turnIndex];
}

function legalTargets(state) {
  return state.players.filter((p) => p.status === "active");
}

/** Hit — draw top card. Returns updated state or throws. */
export function hit(state, username) {
  if (state.phase !== "playing") throw new Error("Game not in playing phase.");
  if (state.pendingAction) throw new Error("Resolve pending action first.");

  const user = username.toLowerCase();
  const player = state.players.find((p) => p.username === user);
  if (!player) throw new Error("Player not in game.");
  if (player.status !== "active") throw new Error("You cannot hit.");

  const forced = state.forcedHitsRemaining > 0 && state.forcedHitTarget === user;
  if (!forced && currentPlayer(state).username !== user) {
    throw new Error("Not your turn.");
  }

  if (state.deck.length === 0) {
    refillDeckFromDiscard(state);
    if (state.deck.length === 0) throw new Error("Deck empty.");
  }

  const card = state.deck.pop();
  const result = applyDrawnCard(player, card);

  if (result.bust) {
    if (player.secondChance) {
      player.secondChance = null;
      player.cards = player.cards.filter((c) => c.id !== card.id);
      state.discard.push(card);
      state.lastEvent = { type: "second_chance_used", username: user, card };
      if (forced) {
        state.forcedHitsRemaining--;
        if (state.forcedHitsRemaining <= 0) return finishForcedHits(state);
      }
      return state;
    }
    player.status = "busted";
    state.lastEvent = { type: "bust", username: user, card };
    if (forced) {
      state.forcedHitsRemaining = 0;
      return finishForcedHits(state);
    }
    const endReason = checkRoundEnd(state);
    if (endReason) return endRound(state, endReason);
    advanceTurn(state);
    return state;
  }

  if (result.action === CARD_TYPES.FREEZE || result.action === CARD_TYPES.FLIP_THREE) {
    state.pendingAction = {
      type: result.action,
      fromUsername: user,
      card,
    };
    state.lastEvent = { type: "action_drawn", username: user, card, action: result.action };
    return maybeAutoResolveSoloAction(state);
  }

  state.lastEvent = { type: "hit", username: user, card };

  if (result.flip7) {
    return endRound(state, "flip7");
  }

  if (forced) {
    state.forcedHitsRemaining--;
    if (state.forcedHitsRemaining <= 0) return finishForcedHits(state);
    return state;
  }

  advanceTurn(state);
  const endReason = checkRoundEnd(state);
  if (endReason) return endRound(state, endReason);
  return state;
}

/** Stay — bank cards for the round. */
export function stay(state, username) {
  if (state.phase !== "playing") throw new Error("Game not in playing phase.");
  if (state.pendingAction) throw new Error("Resolve pending action first.");
  if (state.forcedHitsRemaining > 0) throw new Error("Forced hits in progress.");

  const user = username.toLowerCase();
  const player = state.players.find((p) => p.username === user);
  if (!player) throw new Error("Player not in game.");
  if (player.status !== "active") throw new Error("You cannot stay.");
  if (currentPlayer(state).username !== user) throw new Error("Not your turn.");

  player.status = "stayed";
  state.lastEvent = { type: "stay", username: user };

  advanceTurn(state);
  const endReason = checkRoundEnd(state);
  if (endReason) return endRound(state, endReason);
  return state;
}

/** Play Freeze or Flip Three on an active player (including self). */
export function playAction(state, username, targetUsername) {
  if (!state.pendingAction) throw new Error("No pending action.");
  const user = username.toLowerCase();
  const target = targetUsername.toLowerCase();

  if (state.pendingAction.fromUsername !== user) {
    throw new Error("Only the drawer can resolve this action.");
  }

  const targetPlayer = state.players.find((p) => p.username === target);
  if (!targetPlayer) throw new Error("Invalid target.");
  if (targetPlayer.status !== "active") throw new Error("Target is not active.");

  const { type, card } = state.pendingAction;
  const fromOpening = state.resolvingOpeningActions;

  state.discard.push(card);
  state.pendingAction = null;
  if (fromOpening) state.pendingActionQueue.shift();

  if (type === CARD_TYPES.FREEZE) {
    targetPlayer.status = "frozen";
    state.lastEvent = { type: "freeze", from: user, target, card };
    if (fromOpening) return continueOpeningActionsOrBeginPlay(state);
    advanceTurn(state);
    const endReason = checkRoundEnd(state);
    if (endReason) return endRound(state, endReason);
    return state;
  }

  if (type === CARD_TYPES.FLIP_THREE) {
    state.forcedHitsRemaining = 3;
    state.forcedHitTarget = target;
    state.turnIndex = state.players.findIndex((p) => p.username === target);
    state.lastEvent = { type: "flip_three", from: user, target, card };
    return state;
  }

  throw new Error("Unknown action type.");
}

function endRound(state, reason) {
  state.phase = "round_end";
  state.roundEndReason = reason;

  const flip7Player = state.players.find((p) => p.flip7ThisRound);
  if (flip7Player) state.roundWinner = flip7Player.username;

  for (const player of state.players) {
    const flip7Bonus = !!player.flip7ThisRound;
    player.roundScore = scorePlayerTableau(player, flip7Bonus);
    player.totalScore += player.roundScore;
  }

  state.lastEvent = {
    type: "round_end",
    reason,
    scores: state.players.map((p) => ({
      username: p.username,
      roundScore: p.roundScore,
      totalScore: p.totalScore,
    })),
  };

  const winner = state.players.find((p) => p.totalScore >= state.targetScore);
  if (winner) {
    state.winner = winner.username;
    state.phase = "game_over";
    state.lastEvent.type = "game_over";
    state.lastEvent.winner = winner.username;
  }

  return state;
}

/** Start next round after round_end (host action). */
export function startNextRound(state, rng = Math.random) {
  if (state.phase !== "round_end") throw new Error("Not between rounds.");
  if (state.winner) throw new Error("Game already over.");

  state.round++;
  state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
  state.pendingAction = null;
  state.pendingActionQueue = [];
  state.resolvingOpeningActions = false;
  state.forcedHitsRemaining = 0;
  state.forcedHitTarget = null;
  state.roundEndReason = null;
  state.roundWinner = null;
  state.phase = "playing";

  dealOpeningCards(state, { rng });
  state.lastEvent = { type: "round_start", round: state.round };
  return state;
}

/** Public view — hide deck order, show only public info. */
export function publicState(state, forUsername) {
  const me = forUsername?.toLowerCase();
  return {
    phase: state.phase,
    solo: !!state.solo,
    targetScore: state.targetScore,
    round: state.round,
    dealerIndex: state.dealerIndex,
    turnIndex: state.turnIndex,
    deckCount: state.deck.length,
    players: state.players.map((p) => ({
      username: p.username,
      seatIndex: p.seatIndex,
      cards: p.cards,
      hasSecondChance: !!p.secondChance,
      status: p.status,
      roundScore: p.roundScore,
      totalScore: p.totalScore,
      flip7ThisRound: p.flip7ThisRound,
      tableauScore: scorePlayerTableau(p, false),
    })),
    pendingAction: state.pendingAction
      ? {
          type: state.pendingAction.type,
          fromUsername: state.pendingAction.fromUsername,
          needsTarget: true,
          canTarget: legalTargets(state).map((p) => p.username),
        }
      : null,
    forcedHitsRemaining: state.forcedHitsRemaining,
    forcedHitTarget: state.forcedHitTarget || null,
    roundEndReason: state.roundEndReason,
    roundWinner: state.roundWinner,
    winner: state.winner,
    lastEvent: state.lastEvent,
    isMyTurn:
      me &&
      state.phase === "playing" &&
      !state.pendingAction &&
      (currentPlayer(state)?.username === me ||
        (state.forcedHitsRemaining > 0 && state.forcedHitTarget === me)),
    mustResolveAction:
      me &&
      state.pendingAction?.fromUsername === me,
    legalTargets:
      me && state.pendingAction?.fromUsername === me
        ? legalTargets(state).map((p) => p.username)
        : [],
  };
}

export function applyAction(state, action, username, payload = {}) {
  const s = structuredClone(state);
  switch (action) {
    case "hit":
      return hit(s, username);
    case "stay":
      return stay(s, username);
    case "play_action":
      return playAction(s, username, payload.targetUsername);
    case "next_round":
      return startNextRound(s, payload.rng);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
