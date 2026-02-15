import { config } from "./config";
import { createLogger } from "./utils/logger";
import { startGitCollector } from "./collectors/git";
import { startClaudeCodeCollector } from "./collectors/claudeCode";
import { startScreenpipeCollector } from "./collectors/screenpipe";
import { startContextAccumulator } from "./engine/contextAccumulator";
import { decideTweet } from "./engine/tweetDecider";
import { generateTweet } from "./engine/tweetGenerator";
import { createRateLimiter } from "./publisher/rateLimiter";
import { createTwitterPublisher } from "./publisher/twitter";
import type { ContextSnapshot } from "./engine/contextAccumulator";

const log = createLogger("main");

async function handleSnapshot(
  snapshot: ContextSnapshot,
  rateLimiter: ReturnType<typeof createRateLimiter>,
  publisher: ReturnType<typeof createTwitterPublisher>
) {
  try {
    if (!rateLimiter.canTweet()) {
      const status = rateLimiter.getStatus();
      log.info("Rate limited, skipping snapshot", status);
      return;
    }

    const decision = await decideTweet(snapshot);
    if (!decision.shouldTweet) {
      log.info("Not tweet-worthy", { reason: decision.reason });
      return;
    }

    const tweet = await generateTweet(snapshot, decision.topic);
    if (!tweet.text) {
      log.warn("Empty tweet generated, skipping");
      return;
    }

    const result = await publisher.postTweet(tweet.text, { asThread: true });
    rateLimiter.recordTweet();

    log.info("Tweet published", {
      id: result.id,
      text: result.text,
      topic: decision.topic,
    });
  } catch (err) {
    log.error("Error in tweet pipeline", err);
  }
}

function main() {
  log.info("Live Building agent starting", {
    dryRun: config.tweet.dryRun,
    watchedRepos: config.watchedRepos,
    pollInterval: config.pollIntervalSeconds,
    contextWindow: config.contextWindowMinutes,
  });

  const cleanups: Array<() => void> = [];

  // Start collectors
  cleanups.push(startGitCollector());
  log.info("Git collector started");

  cleanups.push(startClaudeCodeCollector());
  log.info("Claude Code collector started");

  cleanups.push(startScreenpipeCollector());
  log.info("Screenpipe collector started");

  // Start publisher + rate limiter
  const rateLimiter = createRateLimiter();
  const publisher = createTwitterPublisher();

  // Start context accumulator with tweet pipeline
  const stopAccumulator = startContextAccumulator((snapshot) => {
    handleSnapshot(snapshot, rateLimiter, publisher);
  });
  cleanups.push(stopAccumulator);
  log.info("Context accumulator started");

  log.info("Live Building agent running");

  // Graceful shutdown
  const shutdown = () => {
    log.info("Shutting down...");
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (err) {
        log.error("Cleanup error", err);
      }
    }
    log.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
