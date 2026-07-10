import {
  buildVengeanceDeckTemplate,
  VENGEANCE_CARD_TYPES,
  NUMBER_VARIANTS,
} from "./flip-vengeance-deck.js";
import {
  TARGET_SCORE_DEFAULT,
  FLIP7_BONUS,
  VENGEANCE_MIN_PLAYERS,
  MAX_PLAYERS,
} from "./flip-deck.js";
import { shuffleDeck } from "./flip-engine.js";

export { VENGEANCE_MIN_PLAYERS as MIN_PLAYERS, MAX_PLAYERS, TARGET_SCORE_DEFAULT, FLIP7_BONUS };

function emptyPlayer(username, seatIndex) {
  return {
    username,
    seatIndex,
    numbers: [],
    modifiers: [],
    status: "active",
    roundScore: 0,
    totalScore: 0,
    flip7ThisRound: false,
  };
}

function allCardsOnTable(player) {
  return [...player.numbers, ...player.modifiers];
}

function hasZero(player) {
  return player.numbers.some((c) => c.variant === NUMBER_VARIANTS.ZERO);
}

function countLucky13(player) {
  return player.numbers.filter((c) => c.variant === NUMBER_VARIANTS.LUCKY_13).length;
}

function numberValues(player) {
  return player.numbers.map((c) => c.value);
}

function uniqueNumberCount(player) {
  return new Set(numberValues(player)).size;
}

/** Flip 7: 7 unique values, or 6 unique + 2 lucky 13s (exception). */
function meetsFlip7(player) {
  const unique = uniqueNumberCount(player);
  if (unique >= 7) return true;
  if (countLucky13(player) >= 2 && unique >= 6) return true;
  return false;
}

function wouldBust(player, card) {
  if (card.type !== VENGEANCE_CARD_TYPES.NUMBER) return false;
  if (card.variant === NUMBER_VARIANTS.UNLUCKY_7) return false;

  const value = card.value;
  const existing = numberValues(player).filter((v) => v === value).length;

  if (value === 13 && card.variant === NUMBER_VARIANTS.LUCKY_13) {
    const lucky = countLucky13(player);
    if (lucky >= 2) return true;
    if (lucky === 1 && existing >= 1) return false;
    if (existing >= 2) return true;
    return false;
  }

  if (value === 13) {
    const lucky = countLucky13(player);
    if (lucky > 0 && existing === 1) return false;
  }

  return existing >= 1;
}

/** True if the player's current number tableau has a busting duplicate. */
function isBustedTableau(player) {
  const sim = { numbers: [], modifiers: [] };
  for (const card of player.numbers) {
    if (card.type !== VENGEANCE_CARD_TYPES.NUMBER) continue;
    if (wouldBust(sim, card)) return true;
    if (card.variant === NUMBER_VARIANTS.UNLUCKY_7) {
      const unlucky = sim.numbers.find((c) => c.variant === NUMBER_VARIANTS.UNLUCKY_7);
      sim.numbers = unlucky ? [unlucky] : [];
      sim.modifiers = [];
    }
    sim.numbers.push(card);
  }
  return false;
}

function applyTableauBustChecks(state, players, rng, cause = {}) {
  let anyBusted = false;
  for (const player of players) {
    if (player.status === "busted") continue;
    if (!isBustedTableau(player)) continue;
    player.status = "busted";
    state.lastEvent = { type: "bust", username: player.username, ...cause };
    anyBusted = true;
  }
  if (!anyBusted) return null;
  const endReason = checkRoundEnd(state);
  if (endReason) return endRound(state, endReason);
  return state;
}

/** End the round when a player's tableau reaches Flip 7 (e.g. after steal/swap). */
function resolveFlip7ForPlayers(state, players, rng) {
  for (const player of players) {
    if (player.status === "busted" || player.flip7ThisRound) continue;
    if (!meetsFlip7(player)) continue;
    player.flip7ThisRound = true;
    if (state.brutalMode) {
      state.pendingBrutalFlip7 = { username: player.username, awaitingChoice: true };
      state.phase = "brutal_choice";
      return state;
    }
    return endRound(state, "flip7");
  }
  return null;
}

function guardAnyFlip7Achieved(state, rng) {
  return resolveFlip7ForPlayers(state, state.players, rng);
}

export function scoreVengeanceTableau(player, flip7Bonus = false) {
  if (player.status === "busted") {
    let sum = 0;
    const divide = player.modifiers.find((c) => c.type === VENGEANCE_CARD_TYPES.MOD_DIVIDE);
    if (divide) sum = Math.floor(sum / 2);
    for (const m of player.modifiers) {
      if (m.type === VENGEANCE_CARD_TYPES.MOD_MINUS) sum -= m.value;
    }
    return sum;
  }

  const flip7Achieved = !!player.flip7ThisRound;
  let sum = 0;
  if (!hasZero(player) || flip7Achieved) {
    sum = player.numbers.reduce((s, c) => s + c.value, 0);
  }

  const divide = player.modifiers.find((c) => c.type === VENGEANCE_CARD_TYPES.MOD_DIVIDE);
  if (divide) sum = Math.floor(sum / 2);

  for (const m of player.modifiers) {
    if (m.type === VENGEANCE_CARD_TYPES.MOD_MINUS) sum -= m.value;
  }

  if (flip7Bonus && player.flip7ThisRound) sum += FLIP7_BONUS;

  return sum;
}

function refillDeckFromDiscard(state, rng = Math.random) {
  if (state.sidePile?.length > 0) {
    state.discard.push(...state.sidePile);
    state.sidePile = [];
  }
  if (state.deck.length === 0 && state.discard.length > 0) {
    state.deck = shuffleDeck(state.discard, rng);
    state.discard = [];
  }
}

function drawCard(state, rng = Math.random) {
  refillDeckFromDiscard(state, rng);
  if (state.deck.length === 0) throw new Error("Deck empty.");
  return state.deck.pop();
}

function collectRoundToDiscard(state) {
  for (const player of state.players) {
    for (const c of player.numbers) state.discard.push(c);
    for (const c of player.modifiers) state.discard.push(c);
    player.numbers = [];
    player.modifiers = [];
  }
}

function legalKeepGiveTargets(state, brutalMode) {
  return state.players.filter((p) => {
    if (p.status === "busted") return brutalMode;
    return true;
  });
}

/** Who may receive the current pending modifier or action card. */
function canReceivePendingCard(state, player, category, card) {
  if (category === "modifier") {
    if (player.status === "busted" && !state.brutalMode) return false;
    return true;
  }
  if (player.status === "busted") return false;
  return true;
}

function legalRecipientsForPendingChoice(state) {
  const pending = state.pendingChoice;
  if (!pending) return [];
  return state.players.filter((p) =>
    canReceivePendingCard(state, p, pending.category, pending.card)
  );
}

function tryAutoAssignPendingChoice(state, fromUsername, rng) {
  const recipients = legalRecipientsForPendingChoice(state);
  if (recipients.length !== 1) return state;
  return playKeepGive(state, fromUsername, recipients[0].username, rng);
}

function applyUnlucky7(player) {
  const unlucky = player.numbers.find((c) => c.variant === NUMBER_VARIANTS.UNLUCKY_7);
  player.numbers = unlucky ? [unlucky] : [];
  player.modifiers = [];
}

function addNumberCard(player, card) {
  if (card.variant === NUMBER_VARIANTS.UNLUCKY_7) {
    applyUnlucky7(player);
    player.numbers.push(card);
    return { unlucky7: true };
  }
  player.numbers.push(card);
  if (meetsFlip7(player)) {
    player.flip7ThisRound = true;
    return { flip7: true };
  }
  return {};
}

function applyCardToPlayer(player, card, { checkBust = true } = {}) {
  if (card.type === VENGEANCE_CARD_TYPES.NUMBER) {
    if (checkBust && wouldBust(player, card)) {
      player.numbers.push(card);
      return { bust: true, card };
    }
    const result = addNumberCard(player, card);
    return { card, ...result };
  }

  if (
    card.type === VENGEANCE_CARD_TYPES.MOD_DIVIDE ||
    card.type === VENGEANCE_CARD_TYPES.MOD_MINUS
  ) {
    return { modifier: true, card };
  }

  return { action: true, card };
}

function faceUpCards(state) {
  const list = [];
  for (const p of state.players) {
    for (const c of p.numbers) list.push({ username: p.username, card: c, zone: "numbers" });
    for (const c of p.modifiers) list.push({ username: p.username, card: c, zone: "modifiers" });
  }
  return list;
}

function swapHasValidPair(state) {
  const playersWithCards = new Set(faceUpCards(state).map((c) => c.username));
  return playersWithCards.size >= 2;
}

function swapHasSecondPick(state, firstOwnerUsername) {
  const owner = firstOwnerUsername.toLowerCase();
  return faceUpCards(state).some((c) => c.username !== owner);
}

function hasResolvableTargets(state, actionType, fromUsername = null) {
  const cards = faceUpCards(state);
  if (actionType === VENGEANCE_CARD_TYPES.JUST_ONE_MORE) {
    return state.players.some((p) => p.status !== "busted");
  }
  if (actionType === VENGEANCE_CARD_TYPES.FLIP_FOUR) {
    return state.players.some((p) => p.status !== "busted");
  }
  if (actionType === VENGEANCE_CARD_TYPES.SWAP) {
    return swapHasValidPair(state);
  }
  if (actionType === VENGEANCE_CARD_TYPES.STEAL) {
    return fromUsername
      ? cards.some((c) => c.username !== fromUsername)
      : cards.length > 0;
  }
  if (actionType === VENGEANCE_CARD_TYPES.DISCARD) {
    return cards.length > 0;
  }
  return false;
}

function discardActionCard(state, card) {
  state.discard.push(card);
}

function currentPlayer(state) {
  return state.players[state.turnIndex];
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

function beginNormalPlay(state) {
  state.turnIndex = (state.dealerIndex + 1) % state.players.length;
  advanceTurn(state);
}

function checkRoundEnd(state) {
  if (state.players.some((p) => p.flip7ThisRound)) return "flip7";
  const canAct = state.players.filter((p) => p.status === "active");
  if (canAct.length === 0) {
    const anyScored = state.players.some((p) => p.status === "stayed");
    if (anyScored) return "all_stayed";
    return "all_busted";
  }
  return null;
}

function endRound(state, reason) {
  state.phase = "round_end";
  state.roundEndReason = reason;

  const flip7Player = state.players.find((p) => p.flip7ThisRound);
  if (flip7Player) state.roundWinner = flip7Player.username;

  const floor = state.brutalMode ? -Infinity : 0;

  for (const player of state.players) {
    const flip7 = !!player.flip7ThisRound;
    let score = scoreVengeanceTableau(player, false);

    if (flip7 && player.status !== "busted" && !state.brutalMode) {
      score += FLIP7_BONUS;
    } else if (
      flip7 &&
      player.status !== "busted" &&
      state.brutalMode &&
      state.pendingBrutalFlip7?.username === player.username &&
      state.pendingBrutalFlip7.choice === "take"
    ) {
      score += FLIP7_BONUS;
    }

    player.roundScore = Math.max(floor, score);
    player.totalScore += player.roundScore;
  }

  if (
    state.brutalMode &&
    state.pendingBrutalFlip7?.choice === "penalize" &&
    state.pendingBrutalFlip7.target
  ) {
    const target = state.players.find(
      (p) => p.username === state.pendingBrutalFlip7.target
    );
    if (target) {
      target.roundScore = Math.max(floor, target.roundScore - FLIP7_BONUS);
      target.totalScore -= FLIP7_BONUS;
    }
  }

  state.pendingBrutalFlip7 = null;
  state.lastEvent = {
    type: "round_end",
    reason,
    scores: state.players.map((p) => ({
      username: p.username,
      roundScore: p.roundScore,
      totalScore: p.totalScore,
    })),
  };

  const leaders = state.players.filter((p) => p.totalScore >= state.targetScore);
  if (leaders.length) {
    const winner = leaders.reduce((a, b) => (a.totalScore >= b.totalScore ? a : b));
    state.winner = winner.username;
    state.phase = "game_over";
    state.lastEvent.type = "game_over";
    state.lastEvent.winner = winner.username;
  }

  return state;
}

function setPendingKeepGive(state, card, fromUsername, category) {
  state.pendingChoice = { category, card, fromUsername };
  state.turnIndex = state.players.findIndex((p) => p.username === fromUsername);
}

function resolveJustOneMore(state, targetUsername, rng) {
  const target = state.players.find((p) => p.username === targetUsername);
  if (!target || target.status === "busted") throw new Error("Invalid target.");

  const card = drawCard(state, rng);
  const result = applyCardToPlayer(target, card);

  if (result.bust) {
    target.status = "busted";
    state.lastEvent = { type: "bust", username: targetUsername, card };
    state.justOneMorePendingStay = null;
    const endReason = checkRoundEnd(state);
    if (endReason) return endRound(state, endReason);
    advanceTurn(state);
    return state;
  }

  if (result.modifier || result.action) {
    setPendingKeepGive(state, card, targetUsername, result.modifier ? "modifier" : "action");
    state.justOneMorePendingStay = targetUsername;
    state.lastEvent = { type: "just_one_more", from: state.lastActionFrom, target: targetUsername, card };
    return tryAutoAssignPendingChoice(state, targetUsername, rng);
  }

  if (result.flip7) {
    state.lastEvent = { type: "just_one_more", from: state.lastActionFrom, target: targetUsername, card };
    return endRound(state, "flip7");
  }

  target.status = "stayed";
  state.justOneMorePendingStay = null;
  state.lastEvent = { type: "just_one_more", from: state.lastActionFrom, target: targetUsername, card };
  const endReason = checkRoundEnd(state);
  if (endReason) return endRound(state, endReason);
  advanceTurn(state);
  return state;
}

function finishFlipFour(state, targetUsername, fromUsername, rng) {
  state.flipFourPending = null;
  state.lastEvent = { type: "flip_four", from: fromUsername, target: targetUsername };
  const target = state.players.find((p) => p.username === targetUsername);
  if (target?.flip7ThisRound) return endRound(state, "flip7");
  const endReason = checkRoundEnd(state);
  if (endReason) return endRound(state, endReason);
  advanceTurn(state);
  return state;
}

/** Apply an action card to the chosen recipient (who performs / receives the effect). */
function applyActionToRecipient(state, assigner, recipient, card, rng, { inFlipFour = false } = {}) {
  const afterNoOp = () =>
    inFlipFour ? advanceFlipFourAfterQueuedCard(state, rng) : continueAfterChoice(state, rng);

  if (
    card.type !== VENGEANCE_CARD_TYPES.JUST_ONE_MORE &&
    card.type !== VENGEANCE_CARD_TYPES.FLIP_FOUR &&
    !hasResolvableTargets(state, card.type, recipient)
  ) {
    state.discard.push(card);
    state.lastEvent = {
      type: "action_discarded",
      from: assigner,
      recipient,
      card,
      reason: "no_targets",
      flipFour: inFlipFour || undefined,
    };
    return afterNoOp();
  }

  state.discard.push(card);
  state.lastActionFrom = assigner;
  state.lastEvent =
    assigner === recipient
      ? { type: "action_kept", from: assigner, card }
      : { type: "action_assigned", from: assigner, recipient, card };

  switch (card.type) {
    case VENGEANCE_CARD_TYPES.JUST_ONE_MORE: {
      const result = resolveJustOneMore(state, recipient, rng);
      if (inFlipFour && !state.pendingChoice && !state.pendingResolution) {
        return advanceFlipFourAfterQueuedCard(state, rng);
      }
      return result;
    }
    case VENGEANCE_CARD_TYPES.FLIP_FOUR:
      return executeFlipFour(state, recipient, assigner, rng);
    case VENGEANCE_CARD_TYPES.SWAP:
      state.pendingResolution = {
        type: "swap",
        fromUsername: recipient,
        assignedBy: assigner,
        card,
      };
      return state;
    case VENGEANCE_CARD_TYPES.STEAL:
      state.pendingResolution = {
        type: "steal",
        fromUsername: recipient,
        assignedBy: assigner,
        card,
      };
      return state;
    case VENGEANCE_CARD_TYPES.DISCARD:
      state.pendingResolution = {
        type: "discard",
        fromUsername: recipient,
        assignedBy: assigner,
        card,
      };
      return state;
    default:
      return state;
  }
}

function advanceFlipFourAfterQueuedCard(state, rng) {
  if (!state.flipFourPending) return continueAfterChoice(state, rng);
  if (state.flipFourPending.queue.length > 0) {
    state.flipFourPending.queue.shift();
  }
  if (state.pendingResolution || state.pendingChoice) return state;
  return processFlipFourPendingQueue(state, rng);
}

function advanceAfterPendingResolution(state, rng) {
  if (state.flipFourPending) return advanceFlipFourAfterQueuedCard(state, rng);
  return continueAfterChoice(state, rng);
}

function processFlipFourPendingQueue(state, rng) {
  const pending = state.flipFourPending;
  if (!pending) return state;

  const { targetUsername, fromUsername, queue } = pending;
  const target = state.players.find((p) => p.username === targetUsername);
  if (!target || target.status === "busted") {
    return finishFlipFour(state, targetUsername, fromUsername, rng);
  }

  while (queue.length > 0) {
    const entry = queue[0];
    setPendingKeepGive(state, entry.card, targetUsername, entry.category);
    const assigned = tryAutoAssignPendingChoice(state, targetUsername, rng);
    if (state.pendingChoice || state.pendingResolution) return assigned;
    queue.shift();
  }

  return finishFlipFour(state, targetUsername, fromUsername, rng);
}

function executeFlipFour(state, targetUsername, fromUsername, rng) {
  const target = state.players.find((p) => p.username === targetUsername);
  if (!target || target.status === "busted") throw new Error("Invalid target.");

  const held = [];
  let stoppedEarly = false;

  for (let i = 0; i < 4 && !stoppedEarly; i++) {
    const card = drawCard(state, rng);
    const result = applyCardToPlayer(target, card, { checkBust: true });

    if (result.bust) {
      target.status = "busted";
      state.lastEvent = { type: "bust", username: targetUsername, card, flipFour: true };
      stoppedEarly = true;
      continue;
    }

    if (result.modifier || result.action) {
      held.push({ card, category: result.modifier ? "modifier" : "action" });
      continue;
    }

    if (result.flip7) {
      stoppedEarly = true;
    }
  }

  if (target.status === "busted" || held.length === 0) {
    return finishFlipFour(state, targetUsername, fromUsername, rng);
  }

  state.flipFourPending = {
    targetUsername,
    fromUsername,
    queue: held,
  };
  return processFlipFourPendingQueue(state, rng);
}

function giveModifier(state, targetUsername, card) {
  const target = state.players.find((p) => p.username === targetUsername);
  if (!target) throw new Error("Invalid target.");
  if (target.status === "busted" && !state.brutalMode) {
    throw new Error("Target is busted.");
  }
  target.modifiers.push(card);
}

export function createInitialState(usernames, options = {}) {
  const names = usernames.map((u) => u.toLowerCase());
  if (names.length < VENGEANCE_MIN_PLAYERS || names.length > MAX_PLAYERS) {
    throw new Error(`Vengeance requires ${VENGEANCE_MIN_PLAYERS}-${MAX_PLAYERS} players.`);
  }

  const rng = options.rng ?? Math.random;
  const players = names.map((username, i) => emptyPlayer(username, i));

  const state = {
    gameMode: "vengeance",
    brutalMode: !!options.brutalMode,
    phase: "playing",
    targetScore: options.targetScore ?? TARGET_SCORE_DEFAULT,
    round: 1,
    dealerIndex: 0,
    turnIndex: 0,
    deck: shuffleDeck(buildVengeanceDeckTemplate(), rng),
    discard: [],
    sidePile: [],
    players,
    pendingChoice: null,
    pendingChoiceQueue: [],
    resolvingOpeningDeal: false,
    pendingResolution: null,
    pendingBrutalFlip7: null,
    justOneMorePendingStay: null,
    flipFourPending: null,
    lastActionFrom: null,
    roundEndReason: null,
    roundWinner: null,
    winner: null,
    lastEvent: null,
  };

  dealOpeningCards(state, { isNewGame: true, rng });
  return state;
}

export function dealOpeningCards(state, { isNewGame = false, rng = Math.random } = {}) {
  if (!isNewGame) collectRoundToDiscard(state);

  const queue = [];

  for (const player of state.players) {
    player.status = "active";
    player.roundScore = 0;
    player.flip7ThisRound = false;
    if (isNewGame) {
      player.numbers = [];
      player.modifiers = [];
    }

    const card = drawCard(state, rng);
    const result = applyCardToPlayer(player, card, { checkBust: false });

    if (result.modifier || result.action) {
      queue.push({
        category: result.modifier ? "modifier" : "action",
        card,
        fromUsername: player.username,
      });
    } else if (result.bust) {
      player.status = "busted";
    } else if (result.flip7) {
      return endRound(state, "flip7");
    }
  }

  state.pendingChoiceQueue = queue;
  state.resolvingOpeningDeal = queue.length > 0;

  if (queue.length > 0) {
    const first = queue[0];
    state.pendingChoice = {
      category: first.category,
      card: first.card,
      fromUsername: first.fromUsername,
    };
    state.turnIndex = state.players.findIndex((p) => p.username === first.fromUsername);
    return tryAutoAssignPendingChoice(state, first.fromUsername, rng);
  } else {
    state.pendingChoice = null;
    beginNormalPlay(state);
  }

  return state;
}

function continueAfterChoice(state, rng) {
  if (state.resolvingOpeningDeal && state.pendingChoiceQueue.length > 0) {
    state.pendingChoiceQueue.shift();
    if (state.pendingChoiceQueue.length > 0) {
      const next = state.pendingChoiceQueue[0];
      state.pendingChoice = {
        category: next.category,
        card: next.card,
        fromUsername: next.fromUsername,
      };
      state.turnIndex = state.players.findIndex((p) => p.username === next.fromUsername);
      return tryAutoAssignPendingChoice(state, next.fromUsername, rng);
    }
    state.resolvingOpeningDeal = false;
    state.pendingChoice = null;
    beginNormalPlay(state);
    const endReason = checkRoundEnd(state);
    if (endReason) return endRound(state, endReason);
    return state;
  }

  state.pendingChoice = null;

  if (state.justOneMorePendingStay) {
    const u = state.justOneMorePendingStay;
    const p = state.players.find((x) => x.username === u);
    if (p && p.status === "active") p.status = "stayed";
    state.justOneMorePendingStay = null;
    const endReason = checkRoundEnd(state);
    if (endReason) return endRound(state, endReason);
    advanceTurn(state);
    return state;
  }

  if (!state.pendingResolution) {
    if (state.flipFourPending) {
      return processFlipFourPendingQueue(state, rng);
    }
    advanceTurn(state);
    const endReason = checkRoundEnd(state);
    if (endReason) return endRound(state, endReason);
  }
  return state;
}

export function hit(state, username, rng = Math.random) {
  if (state.phase !== "playing") throw new Error("Game not in playing phase.");
  if (state.pendingChoice || state.pendingResolution) {
    throw new Error("Resolve pending choice first.");
  }

  const flip7Guard = guardAnyFlip7Achieved(state, rng);
  if (flip7Guard) return flip7Guard;

  const user = username.toLowerCase();
  const player = state.players.find((p) => p.username === user);
  if (!player) throw new Error("Player not in game.");
  if (player.status !== "active") throw new Error("You cannot hit.");
  if (currentPlayer(state).username !== user) throw new Error("Not your turn.");

  const card = drawCard(state, rng);
  const result = applyCardToPlayer(player, card);

  if (result.bust) {
    player.status = "busted";
    state.lastEvent = { type: "bust", username: user, card };
    const endReason = checkRoundEnd(state);
    if (endReason) return endRound(state, endReason);
    advanceTurn(state);
    return state;
  }

  if (result.modifier || result.action) {
    setPendingKeepGive(state, card, user, result.modifier ? "modifier" : "action");
    state.lastEvent = {
      type: "card_drawn",
      username: user,
      card,
      category: result.modifier ? "modifier" : "action",
    };
    return tryAutoAssignPendingChoice(state, user, rng);
  }

  state.lastEvent = { type: "hit", username: user, card };

  if (result.flip7) {
    if (state.brutalMode) {
      state.pendingBrutalFlip7 = { username: user, awaitingChoice: true };
      state.phase = "brutal_choice";
      return state;
    }
    return endRound(state, "flip7");
  }

  advanceTurn(state);
  const endReason = checkRoundEnd(state);
  if (endReason) return endRound(state, endReason);
  return state;
}

export function stay(state, username) {
  if (state.phase !== "playing") throw new Error("Game not in playing phase.");
  if (state.pendingChoice || state.pendingResolution) {
    throw new Error("Resolve pending choice first.");
  }

  const user = username.toLowerCase();
  const player = state.players.find((p) => p.username === user);
  if (!player) throw new Error("Player not in game.");
  if (player.status !== "active") throw new Error("You cannot stay.");
  if (hasZero(player)) throw new Error("Zero card — you must hit.");
  if (currentPlayer(state).username !== user) throw new Error("Not your turn.");

  player.status = "stayed";
  state.lastEvent = { type: "stay", username: user };

  advanceTurn(state);
  const endReason = checkRoundEnd(state);
  if (endReason) return endRound(state, endReason);
  return state;
}

export function playKeepGive(state, username, targetUsername, rng = Math.random) {
  if (!state.pendingChoice) throw new Error("No pending choice.");

  const flip7Guard = guardAnyFlip7Achieved(state, rng);
  if (flip7Guard) return flip7Guard;

  const user = username.toLowerCase();
  let recipient = targetUsername.toLowerCase();

  if (state.pendingChoice.fromUsername !== user) {
    throw new Error("Only the assigning player can choose the recipient.");
  }

  const { card, category } = state.pendingChoice;
  const targets = legalRecipientsForPendingChoice(state);
  const valid = targets.some((p) => p.username === recipient);
  if (!valid) throw new Error("Invalid target.");

  const onlySelf = targets.length === 1 && targets[0].username === user;
  if (onlySelf) recipient = user;

  state.pendingChoice = null;
  const inFlipFour = !!state.flipFourPending;
  const afterAssign = () =>
    inFlipFour ? advanceFlipFourAfterQueuedCard(state, rng) : continueAfterChoice(state, rng);

  if (category === "modifier") {
    giveModifier(state, recipient, card);
    state.lastEvent = { type: "modifier_assigned", from: user, recipient, card };
    return afterAssign();
  }

  if (
    !hasResolvableTargets(state, card.type, recipient) &&
    card.type !== VENGEANCE_CARD_TYPES.JUST_ONE_MORE
  ) {
    discardActionCard(state, card);
    state.lastEvent = {
      type: "action_discarded",
      from: user,
      recipient,
      card,
      reason: "no_targets",
      flipFour: inFlipFour || undefined,
    };
    return afterAssign();
  }

  return applyActionToRecipient(state, user, recipient, card, rng, { inFlipFour });
}

export function resolveCardAction(state, username, payload = {}, rng = Math.random) {
  const user = username.toLowerCase();
  const pr = state.pendingResolution;
  if (!pr) throw new Error("No pending resolution.");
  if (pr.fromUsername !== user) throw new Error("Only the resolver can complete this.");

  const { targetUsername, cardId, cardId2, ownerUsername, ownerUsername2 } = payload;

  if (pr.type === "flip_four_pick") {
    if (!targetUsername) throw new Error("target_username required");
    state.pendingResolution = null;
    return executeFlipFour(state, targetUsername.toLowerCase(), user, rng);
  }

  if (pr.type === "swap") {
    if (payload.cancel) {
      state.pendingResolution = null;
      state.lastEvent = {
        type: "action_discarded",
        from: user,
        card: pr.card,
        reason: "no_valid_swap",
      };
      return advanceAfterPendingResolution(state, rng);
    }

    if (!cardId || !cardId2 || !ownerUsername || !ownerUsername2) {
      throw new Error("Swap requires two cards and owners.");
    }
    const o1 = ownerUsername.toLowerCase();
    const o2 = ownerUsername2.toLowerCase();
    if (o1 === o2) {
      throw new Error("Swap must be between two different players.");
    }
    const p1 = state.players.find((p) => p.username === o1);
    const p2 = state.players.find((p) => p.username === o2);
    if (!p1 || !p2) throw new Error("Invalid players.");

    function takeCardById(player, id) {
      let idx = player.numbers.findIndex((c) => c.id === id);
      if (idx >= 0) {
        const [c] = player.numbers.splice(idx, 1);
        return { card: c, zone: "numbers" };
      }
      idx = player.modifiers.findIndex((c) => c.id === id);
      if (idx >= 0) {
        const [c] = player.modifiers.splice(idx, 1);
        return { card: c, zone: "modifiers" };
      }
      return null;
    }

    const a = takeCardById(p1, cardId);
    const b = takeCardById(p2, cardId2);
    if (!a || !b) throw new Error("Card not found.");

    if (a.zone === "numbers") p2.numbers.push(a.card);
    else p2.modifiers.push(a.card);
    if (b.zone === "numbers") p1.numbers.push(b.card);
    else p1.modifiers.push(b.card);

    state.pendingResolution = null;
    state.lastEvent = { type: "swap", from: user, owners: [ownerUsername, ownerUsername2] };
    const bustResult = applyTableauBustChecks(state, [p1, p2], rng, { swap: true });
    if (bustResult) return bustResult;
    const flip7Result = resolveFlip7ForPlayers(state, [p1, p2], rng);
    if (flip7Result) return flip7Result;
    return advanceAfterPendingResolution(state, rng);
  }

  if (pr.type === "steal") {
    if (!targetUsername || !cardId) throw new Error("Steal requires target and card.");
    const victim = state.players.find((p) => p.username === targetUsername.toLowerCase());
    const thief = state.players.find((p) => p.username === user);
    if (!victim || !thief) throw new Error("Invalid target.");

    let stolenWasNumber = false;
    let idx = victim.numbers.findIndex((c) => c.id === cardId);
    if (idx >= 0) {
      const [c] = victim.numbers.splice(idx, 1);
      thief.numbers.push(c);
      stolenWasNumber = true;
    } else {
      idx = victim.modifiers.findIndex((c) => c.id === cardId);
      if (idx < 0) throw new Error("Card not found.");
      const [c] = victim.modifiers.splice(idx, 1);
      thief.modifiers.push(c);
    }

    state.pendingResolution = null;
    state.lastEvent = { type: "steal", from: user, target: targetUsername, cardId };
    if (stolenWasNumber) {
      const bustResult = applyTableauBustChecks(state, [thief], rng, { steal: true });
      if (bustResult) return bustResult;
      const flip7Result = resolveFlip7ForPlayers(state, [thief], rng);
      if (flip7Result) return flip7Result;
    }
    return advanceAfterPendingResolution(state, rng);
  }

  if (pr.type === "discard") {
    if (!targetUsername || !cardId) throw new Error("Discard requires target and card.");
    const victim = state.players.find((p) => p.username === targetUsername.toLowerCase());
    if (!victim) throw new Error("Invalid target.");

    let idx = victim.numbers.findIndex((c) => c.id === cardId);
    if (idx >= 0) {
      const [c] = victim.numbers.splice(idx, 1);
      state.discard.push(c);
    } else {
      idx = victim.modifiers.findIndex((c) => c.id === cardId);
      if (idx < 0) throw new Error("Card not found.");
      const [c] = victim.modifiers.splice(idx, 1);
      state.discard.push(c);
    }

    state.pendingResolution = null;
    state.lastEvent = { type: "discard_played", from: user, target: targetUsername, cardId };
    return advanceAfterPendingResolution(state, rng);
  }

  throw new Error("Unknown resolution type.");
}

export function brutalFlip7Choice(state, username, choice, targetUsername = null) {
  if (state.phase !== "brutal_choice") throw new Error("Not awaiting brutal choice.");
  const user = username.toLowerCase();
  if (state.pendingBrutalFlip7?.username !== user) {
    throw new Error("Only the Flip 7 player can choose.");
  }
  if (choice !== "take" && choice !== "penalize") {
    throw new Error("choice must be take or penalize");
  }
  if (choice === "penalize" && !targetUsername) {
    throw new Error("target_username required for penalize");
  }

  state.pendingBrutalFlip7 = {
    username: user,
    choice,
    target: targetUsername?.toLowerCase() || null,
  };
  state.phase = "playing";
  return endRound(state, "flip7");
}

export function startNextRound(state, rng = Math.random) {
  if (state.phase !== "round_end") throw new Error("Not between rounds.");
  if (state.winner) throw new Error("Game already over.");

  state.round++;
  state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
  state.pendingChoice = null;
  state.pendingChoiceQueue = [];
  state.resolvingOpeningDeal = false;
  state.pendingResolution = null;
  state.pendingBrutalFlip7 = null;
  state.justOneMorePendingStay = null;
  state.flipFourPending = null;
  state.roundEndReason = null;
  state.roundWinner = null;
  state.phase = "playing";

  dealOpeningCards(state, { rng });
  state.lastEvent = { type: "round_start", round: state.round };
  return state;
}

export function publicState(state, forUsername) {
  const me = forUsername?.toLowerCase();
  const pending = state.pendingChoice;
  const pr = state.pendingResolution;

  return {
    gameMode: "vengeance",
    brutalMode: state.brutalMode,
    phase: state.phase,
    targetScore: state.targetScore,
    round: state.round,
    dealerIndex: state.dealerIndex,
    turnIndex: state.turnIndex,
    deckCount: state.deck.length,
    players: state.players.map((p) => ({
      username: p.username,
      seatIndex: p.seatIndex,
      numbers: p.numbers,
      modifiers: p.modifiers,
      cards: [...p.numbers, ...p.modifiers],
      status: p.status,
      roundScore: p.roundScore,
      totalScore: p.totalScore,
      flip7ThisRound: p.flip7ThisRound,
      hasZero: hasZero(p),
      tableauScore: scoreVengeanceTableau(p, false),
    })),
    pendingChoice: pending
      ? {
          category: pending.category,
          fromUsername: pending.fromUsername,
          card: pending.card,
          canTarget: legalRecipientsForPendingChoice(state).map((p) => p.username),
        }
      : null,
    pendingResolution: pr
      ? {
          type: pr.type,
          fromUsername: pr.fromUsername,
          card: pr.card,
        }
      : null,
    pendingBrutalFlip7: state.pendingBrutalFlip7,
    flipFourPending: !!state.flipFourPending,
    roundEndReason: state.roundEndReason,
    roundWinner: state.roundWinner,
    winner: state.winner,
    lastEvent: state.lastEvent,
    isMyTurn:
      me &&
      state.phase === "playing" &&
      !pending &&
      !pr &&
      currentPlayer(state)?.username === me,
    mustResolveChoice: me && pending?.fromUsername === me,
    mustResolveAction: me && pr?.fromUsername === me,
    mustBrutalChoice:
      me && state.phase === "brutal_choice" && state.pendingBrutalFlip7?.username === me,
    legalTargets:
      me && pending?.fromUsername === me
        ? legalRecipientsForPendingChoice(state).map((p) => p.username)
        : [],
    swappableCards: pr?.type === "swap" || pr?.type === "steal" || pr?.type === "discard"
      ? faceUpCards(state)
      : [],
  };
}

export function applyAction(state, action, username, payload = {}) {
  const s = structuredClone(state);
  const rng = payload.rng ?? Math.random;
  switch (action) {
    case "hit":
      return hit(s, username, rng);
    case "stay":
      return stay(s, username);
    case "play_action":
      return playKeepGive(s, username, payload.targetUsername, rng);
    case "resolve_card":
      return resolveCardAction(s, username, payload, rng);
    case "brutal_flip7":
      return brutalFlip7Choice(s, username, payload.choice, payload.targetUsername);
    case "next_round":
      return startNextRound(s, rng);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
