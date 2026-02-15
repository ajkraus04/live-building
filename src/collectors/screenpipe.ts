import crypto from "crypto";
import { config } from "../config";
import { eventBus, ScreenActivity, VoiceActivity } from "../eventBus";
import { createLogger } from "../utils/logger";
import { loadState, saveState } from "../utils/state";

const log = createLogger("screenpipe-collector");

type ScreenpipeOcrResult = {
  type: "OCR";
  content: {
    text: string;
    app_name?: string;
    window_name?: string;
    timestamp?: string;
  };
};

type ScreenpipeAudioResult = {
  type: "Audio";
  content: {
    transcription: string;
    timestamp?: string;
  };
};

type ScreenpipeSearchResponse = {
  data: Array<ScreenpipeOcrResult | ScreenpipeAudioResult>;
  pagination?: { total: number };
};

const seenHashes = new Set<string>();
const MAX_SEEN_HASHES = 10000;

function contentHash(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex");
}

function pruneSeenHashes() {
  if (seenHashes.size > MAX_SEEN_HASHES) {
    const toRemove = seenHashes.size - MAX_SEEN_HASHES / 2;
    const iter = seenHashes.values();
    for (let i = 0; i < toRemove; i++) {
      seenHashes.delete(iter.next().value!);
    }
  }
}

async function fetchScreenpipe(
  contentType: "ocr" | "audio",
  since: string
): Promise<ScreenpipeSearchResponse> {
  const url = new URL(`${config.screenpipe.apiUrl}/search`);
  url.searchParams.set("content_type", contentType);
  url.searchParams.set("start_time", since);
  url.searchParams.set("limit", "50");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Screenpipe API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<ScreenpipeSearchResponse>;
}

async function pollOcr(since: string): Promise<void> {
  const data = await fetchScreenpipe("ocr", since);
  if (!data.data?.length) return;

  for (const item of data.data) {
    if (item.type !== "OCR") continue;

    const text = item.content.text?.trim();
    if (!text) continue;

    const hash = contentHash(text);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    const activity: ScreenActivity = {
      type: "screen-activity",
      timestamp: item.content.timestamp
        ? new Date(item.content.timestamp)
        : new Date(),
      ocrText: text,
      appName: item.content.app_name,
      windowTitle: item.content.window_name,
    };

    eventBus.emitActivity("screen-activity", activity);
    log.debug("Screen activity detected", {
      appName: activity.appName,
      textLength: text.length,
    });
  }
}

async function pollAudio(since: string): Promise<void> {
  const data = await fetchScreenpipe("audio", since);
  if (!data.data?.length) return;

  for (const item of data.data) {
    if (item.type !== "Audio") continue;

    const transcript = item.content.transcription?.trim();
    if (!transcript) continue;

    const hash = contentHash(transcript);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    const activity: VoiceActivity = {
      type: "voice-activity",
      timestamp: item.content.timestamp
        ? new Date(item.content.timestamp)
        : new Date(),
      transcript,
    };

    eventBus.emitActivity("voice-activity", activity);
    log.debug("Voice activity detected", {
      transcriptLength: transcript.length,
    });
  }
}

export function startScreenpipeCollector(): () => void {
  log.info("Starting Screenpipe collector", {
    apiUrl: config.screenpipe.apiUrl,
    pollInterval: config.pollIntervalSeconds,
  });

  let running = true;

  const poll = async () => {
    if (!running) return;

    const currentState = loadState();
    const since =
      currentState.lastScreenpipePoll || new Date().toISOString();

    try {
      await Promise.all([pollOcr(since), pollAudio(since)]);
      pruneSeenHashes();
    } catch (err) {
      log.error("Error polling Screenpipe", { error: String(err) });
    }

    currentState.lastScreenpipePoll = new Date().toISOString();
    saveState(currentState);
  };

  const intervalId = setInterval(poll, config.pollIntervalSeconds * 1000);
  poll();

  return () => {
    running = false;
    clearInterval(intervalId);
    log.info("Screenpipe collector stopped");
  };
}
