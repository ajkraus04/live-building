import fs from "fs";
import path from "path";
import { createLogger } from "./logger";

const log = createLogger("state");
const DATA_DIR = path.resolve(__dirname, "../../data");

export type TweetRecord = {
  id: string;
  text: string;
  timestamp: string;
  topic: string;
  threadId?: string;
  mediaUrl?: string;
};

export type AppState = {
  lastTweetTimestamp: string | null;
  lastScreenpipePoll: string | null;
  lastClaudeEventOffset: Record<string, number>;
  lastGitCommit: Record<string, string>;
  currentThreadId: string | null;
  tweetsPostedThisHour: number;
  tweetsPostedToday: number;
  hourResetAt: string;
  dayResetAt: string;
};

const DEFAULT_STATE: AppState = {
  lastTweetTimestamp: null,
  lastScreenpipePoll: null,
  lastClaudeEventOffset: {},
  lastGitCommit: {},
  currentThreadId: null,
  tweetsPostedThisHour: 0,
  tweetsPostedToday: 0,
  hourResetAt: new Date().toISOString(),
  dayResetAt: new Date().toISOString(),
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadState(): AppState {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, "state.json");
  if (!fs.existsSync(filePath)) return { ...DEFAULT_STATE };

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (err) {
    log.warn("Failed to load state, using defaults", err);
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: AppState): void {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, "state.json");
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function loadTweetHistory(): TweetRecord[] {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, "tweet-history.json");
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    log.warn("Failed to load tweet history", err);
    return [];
  }
}

export function appendTweetHistory(tweet: TweetRecord): void {
  ensureDataDir();
  const history = loadTweetHistory();
  history.push(tweet);
  const filePath = path.join(DATA_DIR, "tweet-history.json");
  fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
}

export function getRecentTweets(count: number = 10): TweetRecord[] {
  const history = loadTweetHistory();
  return history.slice(-count);
}
