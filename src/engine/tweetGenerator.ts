import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { createLogger } from "../utils/logger";
import { getRecentTweets } from "../utils/state";
import type { ContextSnapshot } from "./contextAccumulator";

const log = createLogger("tweet-generator");

export type GeneratedTweet = {
  text: string;
  suggestScreenshot: boolean;
};

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `You are a developer tweeting about your build-in-public journey. Write a single tweet (max 280 characters) about the given coding activity.

Guidelines:
- Sound like a real developer, not a marketing bot
- Be specific about technical details (tools, languages, what you built)
- Keep it casual but informative
- Use 0-2 hashtags max, only if they add value
- No excessive emojis (0-1 is fine)
- Don't start every tweet the same way — vary your openings
- Show genuine excitement or frustration when appropriate
- If there's a visual aspect (UI change, architecture diagram, terminal output), suggest a screenshot

Respond with valid JSON only, no markdown fences:
{"text": "the tweet text", "suggestScreenshot": true/false}`;

export async function generateTweet(
  snapshot: ContextSnapshot,
  topic: string
): Promise<GeneratedTweet> {
  const recentTweets = getRecentTweets(10);
  const recentTweetTexts = recentTweets.length > 0
    ? recentTweets.map((t) => `- ${t.text}`).join("\n")
    : "No recent tweets.";

  const userPrompt = `Topic to tweet about: ${topic}

Activity details:
${snapshot.summary}

${snapshot.gitActivity.length > 0 ? `Git commits:\n${snapshot.gitActivity.map((g) => `- ${g.commitMessage} (${g.repo}, +${g.additions}/-${g.deletions})`).join("\n")}` : ""}
${snapshot.claudeActivity.length > 0 ? `Claude interactions:\n${snapshot.claudeActivity.map((c) => `- ${c.userMessage || "interaction"}${c.filesModified?.length ? ` (modified: ${c.filesModified.join(", ")})` : ""}`).join("\n")}` : ""}

Recent tweets (avoid similar style/content):
${recentTweetTexts}

Generate a tweet about this activity.`;

  try {
    log.info("Generating tweet", { topic });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 256,
      messages: [
        { role: "user", content: userPrompt },
      ],
      system: SYSTEM_PROMPT,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const result = JSON.parse(text) as GeneratedTweet;

    if (result.text.length > 280) {
      log.warn("Generated tweet exceeds 280 chars, truncating", { length: result.text.length });
      result.text = result.text.slice(0, 277) + "...";
    }

    log.info("Tweet generated", {
      length: result.text.length,
      suggestScreenshot: result.suggestScreenshot,
    });

    return result;
  } catch (err) {
    log.error("Failed to generate tweet", err);
    return { text: "", suggestScreenshot: false };
  }
}
