import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import { getRecentTweets } from "../utils/state";
import type { ContextSnapshot } from "./contextAccumulator";

const log = createLogger("tweet-decider");

export type TweetDecision = {
  shouldTweet: boolean;
  reason: string;
  topic: string;
};

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `You are a tweet-worthiness evaluator for a developer who builds in public. Your job is to decide whether recent coding activity is interesting enough to tweet about.

Tweet-worthy activity:
- Starting or completing a feature
- Solving an interesting bug
- Learning something new or having an "aha" moment
- Making architectural decisions
- Breakthroughs or milestones
- Trying new tools or technologies

NOT tweet-worthy:
- Routine file saves without meaningful changes
- Repetitive debugging without resolution
- Context switching between tasks without progress
- Minor formatting or config changes
- Activity that's too similar to a recent tweet

Respond with valid JSON only, no markdown fences:
{"shouldTweet": true/false, "reason": "brief explanation", "topic": "concise topic if tweeting"}`;

export async function decideTweet(snapshot: ContextSnapshot): Promise<TweetDecision> {
  const recentTweets = getRecentTweets(10);
  const recentTweetSummary = recentTweets.length > 0
    ? recentTweets.map((t) => `- [${t.timestamp}] ${t.text}`).join("\n")
    : "No recent tweets.";

  const userPrompt = `Activity summary from the last ${config.contextWindowMinutes} minutes:
${snapshot.summary}

Recent tweets (avoid repetition):
${recentTweetSummary}

Should this activity be tweeted about?`;

  try {
    log.info("Evaluating tweet-worthiness");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [
        { role: "user", content: userPrompt },
      ],
      system: SYSTEM_PROMPT,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const decision = JSON.parse(text) as TweetDecision;

    log.info("Tweet decision", {
      shouldTweet: decision.shouldTweet,
      reason: decision.reason,
      topic: decision.topic,
    });

    return decision;
  } catch (err) {
    log.error("Failed to evaluate tweet-worthiness", err);
    return { shouldTweet: false, reason: "Error during evaluation", topic: "" };
  }
}
