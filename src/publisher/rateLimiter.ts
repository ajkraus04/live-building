import { config } from "../config";
import { loadState, saveState, type AppState } from "../utils/state";
import { createLogger } from "../utils/logger";

const log = createLogger("rate-limiter");

function resetCountersIfNeeded(state: AppState): AppState {
  const now = new Date();

  if (now >= new Date(state.hourResetAt)) {
    const nextHour = new Date(now);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    state.tweetsPostedThisHour = 0;
    state.hourResetAt = nextHour.toISOString();
    log.debug("Hourly tweet counter reset");
  }

  if (now >= new Date(state.dayResetAt)) {
    const nextDay = new Date(now);
    nextDay.setHours(0, 0, 0, 0);
    nextDay.setDate(nextDay.getDate() + 1);
    state.tweetsPostedToday = 0;
    state.dayResetAt = nextDay.toISOString();
    log.debug("Daily tweet counter reset");
  }

  return state;
}

function getNextAllowedAt(state: AppState): Date | null {
  if (!state.lastTweetTimestamp) return null;

  const minInterval = config.tweet.minIntervalMinutes * 60 * 1000;
  const nextAllowed = new Date(new Date(state.lastTweetTimestamp).getTime() + minInterval);
  return nextAllowed > new Date() ? nextAllowed : null;
}

export function createRateLimiter() {
  return {
    canTweet(): boolean {
      const state = resetCountersIfNeeded(loadState());
      saveState(state);

      if (state.tweetsPostedThisHour >= config.tweet.maxPerHour) {
        log.info("Hourly tweet limit reached", { count: state.tweetsPostedThisHour, max: config.tweet.maxPerHour });
        return false;
      }

      if (state.tweetsPostedToday >= config.tweet.maxPerDay) {
        log.info("Daily tweet limit reached", { count: state.tweetsPostedToday, max: config.tweet.maxPerDay });
        return false;
      }

      const nextAllowed = getNextAllowedAt(state);
      if (nextAllowed) {
        log.info("Min interval not elapsed", { nextAllowedAt: nextAllowed.toISOString() });
        return false;
      }

      return true;
    },

    recordTweet(): void {
      const state = resetCountersIfNeeded(loadState());
      state.tweetsPostedThisHour += 1;
      state.tweetsPostedToday += 1;
      state.lastTweetTimestamp = new Date().toISOString();
      saveState(state);
      log.info("Tweet recorded", { thisHour: state.tweetsPostedThisHour, today: state.tweetsPostedToday });
    },

    getStatus(): { tweetsThisHour: number; tweetsToday: number; nextAllowedAt: Date | null } {
      const state = resetCountersIfNeeded(loadState());
      saveState(state);

      return {
        tweetsThisHour: state.tweetsPostedThisHour,
        tweetsToday: state.tweetsPostedToday,
        nextAllowedAt: getNextAllowedAt(state),
      };
    },
  };
}
