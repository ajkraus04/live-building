# Live Building

An autonomous agent that watches your coding activity and tweets about it in real time. It collects signals from git commits, Claude Code sessions, and Screenpipe screen/voice captures, then uses Claude to decide when something is tweet-worthy and generates a post.

## How It Works

```
Collectors ──► Event Bus ──► Context Accumulator ──► Tweet Decider ──► Tweet Generator ──► Twitter
```

1. **Collectors** watch for activity from three sources:
   - **Git** — monitors repos for new commits via filesystem watcher
   - **Claude Code** — reads Claude conversation history for tool usage and file edits
   - **Screenpipe** — polls the local Screenpipe API for screen captures and voice transcriptions

2. **Context Accumulator** buffers events over a sliding time window (default 15 min) and periodically builds a snapshot summarizing recent activity.

3. **Tweet Decider** sends the snapshot to Claude Haiku to evaluate whether the activity is interesting enough to tweet about, avoiding repetition with recent tweets.

4. **Tweet Generator** crafts the tweet text using Claude, keeping it authentic and concise.

5. **Publisher** posts to Twitter/X with built-in rate limiting (configurable max per hour/day and minimum interval).

## Setup

```bash
npm install
cp .env.example .env
```

Fill in your `.env`:

| Variable | Required | Description |
|---|---|---|
| `TWITTER_API_KEY` | Yes | Twitter API key (Basic tier) |
| `TWITTER_API_SECRET` | Yes | Twitter API secret |
| `TWITTER_ACCESS_TOKEN` | Yes | Twitter access token |
| `TWITTER_ACCESS_SECRET` | Yes | Twitter access token secret |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `SCREENPIPE_API_URL` | No | Screenpipe endpoint (default: `http://localhost:3030`) |
| `WATCHED_REPOS` | No | Comma-separated repo paths to watch |
| `POLL_INTERVAL_SECONDS` | No | How often to poll collectors (default: `30`) |
| `TWEET_MAX_PER_HOUR` | No | Rate limit per hour (default: `3`) |
| `TWEET_MAX_PER_DAY` | No | Rate limit per day (default: `30`) |
| `TWEET_MIN_INTERVAL_MINUTES` | No | Minimum time between tweets (default: `10`) |
| `CONTEXT_WINDOW_MINUTES` | No | Sliding window for context accumulation (default: `15`) |
| `TWEET_DRY_RUN` | No | Set to `true` to log tweets without posting (default: `false`) |

## Usage

```bash
# Development
npm run dev

# Production
npm run build
npm start

# With PM2 (auto-restart, logging)
pm2 start ecosystem.config.js
```

## Project Structure

```
src/
├── collectors/        # Data sources (git, Claude Code, Screenpipe)
├── engine/            # Context accumulation, tweet decision, tweet generation
├── publisher/         # Twitter client and rate limiter
├── utils/             # Logger and persistent state
├── config.ts          # Environment config
├── eventBus.ts        # Central event bus
└── index.ts           # Entry point
```
