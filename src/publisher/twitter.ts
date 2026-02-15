import fs from "fs";
import { TwitterApi } from "twitter-api-v2";
import { config } from "../config";
import { loadState, saveState, appendTweetHistory } from "../utils/state";
import { createLogger } from "../utils/logger";

const log = createLogger("twitter");

export function createTwitterPublisher() {
  const client = new TwitterApi({
    appKey: config.twitter.apiKey,
    appSecret: config.twitter.apiSecret,
    accessToken: config.twitter.accessToken,
    accessSecret: config.twitter.accessSecret,
  });

  const rwClient = client.readWrite;

  async function uploadMedia(mediaPath: string): Promise<string> {
    const mediaBuffer = fs.readFileSync(mediaPath);
    const mediaId = await rwClient.v1.uploadMedia(mediaBuffer, { mimeType: "image/png" });
    log.info("Media uploaded", { mediaId, path: mediaPath });
    return mediaId;
  }

  return {
    async postTweet(
      text: string,
      options?: { mediaPath?: string; asThread?: boolean }
    ): Promise<{ id: string; text: string }> {
      if (config.tweet.dryRun) {
        const fakeId = `dry-run-${Date.now()}`;
        log.info("Dry run tweet", { id: fakeId, text, options });

        appendTweetHistory({
          id: fakeId,
          text,
          timestamp: new Date().toISOString(),
          topic: "dry-run",
        });

        return { id: fakeId, text };
      }

      try {
        const tweetPayload: Record<string, unknown> = { text };

        if (options?.mediaPath) {
          const mediaId = await uploadMedia(options.mediaPath);
          tweetPayload.media = { media_ids: [mediaId] };
        }

        const state = loadState();
        if (options?.asThread && state.currentThreadId) {
          tweetPayload.reply = { in_reply_to_tweet_id: state.currentThreadId };
        }

        const result = await rwClient.v2.tweet(tweetPayload as any);
        const tweetId = result.data.id;
        const tweetText = result.data.text;

        log.info("Tweet posted", { id: tweetId });

        if (options?.asThread) {
          state.currentThreadId = tweetId;
          saveState(state);
        }

        appendTweetHistory({
          id: tweetId,
          text: tweetText,
          timestamp: new Date().toISOString(),
          topic: "",
          ...(options?.asThread ? { threadId: state.currentThreadId ?? undefined } : {}),
          ...(options?.mediaPath ? { mediaUrl: options.mediaPath } : {}),
        });

        return { id: tweetId, text: tweetText };
      } catch (err) {
        log.error("Failed to post tweet", err);
        throw err;
      }
    },
  };
}
