import * as classic from "./flip-engine.js";
import * as vengeance from "./flip-vengeance-engine.js";

export {
  MIN_PLAYERS,
  MAX_PLAYERS,
  TARGET_SCORE_DEFAULT,
  FLIP7_BONUS,
  CARD_TYPES,
} from "./flip-deck.js";

export { shuffleDeck } from "./flip-engine.js";

function engineFor(stateOrMode) {
  const mode =
    typeof stateOrMode === "string"
      ? stateOrMode
      : stateOrMode?.gameMode || "classic";
  return mode === "vengeance" ? vengeance : classic;
}

export function createInitialState(usernames, options = {}) {
  return engineFor(options.gameMode || "classic").createInitialState(
    usernames,
    options
  );
}

export function applyAction(state, action, username, payload = {}) {
  return engineFor(state).applyAction(state, action, username, payload);
}

export function publicState(state, forUsername) {
  if (!state) return null;
  return engineFor(state).publicState(state, forUsername);
}
