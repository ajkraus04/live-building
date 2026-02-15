import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  twitter: {
    apiKey: required("TWITTER_API_KEY"),
    apiSecret: required("TWITTER_API_SECRET"),
    accessToken: required("TWITTER_ACCESS_TOKEN"),
    accessSecret: required("TWITTER_ACCESS_SECRET"),
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
  },
  screenpipe: {
    apiUrl: optional("SCREENPIPE_API_URL", "http://localhost:3030"),
  },
  watchedRepos: optional("WATCHED_REPOS", "").split(",").filter(Boolean),
  claudeHistoryPath: optional(
    "CLAUDE_HISTORY_PATH",
    path.join(process.env.HOME || "~", ".claude")
  ),
  pollIntervalSeconds: parseInt(optional("POLL_INTERVAL_SECONDS", "30")),
  tweet: {
    maxPerHour: parseInt(optional("TWEET_MAX_PER_HOUR", "3")),
    maxPerDay: parseInt(optional("TWEET_MAX_PER_DAY", "30")),
    minIntervalMinutes: parseInt(optional("TWEET_MIN_INTERVAL_MINUTES", "10")),
    dryRun: optional("TWEET_DRY_RUN", "false") === "true",
  },
  contextWindowMinutes: parseInt(optional("CONTEXT_WINDOW_MINUTES", "15")),
};

export type Config = typeof config;
