import { eventBus, ActivityEvent, ScreenActivity, VoiceActivity, ClaudeActivity, GitActivity } from "../eventBus";
import { config } from "../config";
import { createLogger } from "../utils/logger";

const log = createLogger("context-accumulator");

export type ContextSnapshot = {
  timestamp: Date;
  screenActivity: ScreenActivity[];
  voiceActivity: VoiceActivity[];
  claudeActivity: ClaudeActivity[];
  gitActivity: GitActivity[];
  summary: string;
};

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 1000;

function buildSummary(
  screen: ScreenActivity[],
  voice: VoiceActivity[],
  claude: ClaudeActivity[],
  git: GitActivity[]
): string {
  const parts: string[] = [];

  if (screen.length > 0) {
    const apps = [...new Set(screen.map((s) => s.appName).filter(Boolean))];
    parts.push(`Screen: ${screen.length} captures across ${apps.length > 0 ? apps.join(", ") : "unknown apps"}`);
  }

  if (voice.length > 0) {
    parts.push(`Voice: ${voice.length} transcriptions`);
  }

  if (claude.length > 0) {
    const files = [...new Set(claude.flatMap((c) => c.filesModified || []))];
    const tools = [...new Set(claude.flatMap((c) => c.toolsUsed || []))];
    parts.push(
      `Claude: ${claude.length} interactions` +
        (files.length > 0 ? `, modified ${files.join(", ")}` : "") +
        (tools.length > 0 ? `, used ${tools.join(", ")}` : "")
    );
  }

  if (git.length > 0) {
    const repos = [...new Set(git.map((g) => g.repo))];
    const messages = git.map((g) => g.commitMessage);
    parts.push(
      `Git: ${git.length} commits in ${repos.join(", ")} — ${messages.join("; ")}`
    );
  }

  if (parts.length === 0) return "No notable activity in the current window.";

  return parts.join(". ") + ".";
}

function partitionEvents(events: ActivityEvent[]) {
  const screen: ScreenActivity[] = [];
  const voice: VoiceActivity[] = [];
  const claude: ClaudeActivity[] = [];
  const git: GitActivity[] = [];

  for (const event of events) {
    switch (event.type) {
      case "screen-activity":
        screen.push(event);
        break;
      case "voice-activity":
        voice.push(event);
        break;
      case "claude-activity":
        claude.push(event);
        break;
      case "git-activity":
        git.push(event);
        break;
    }
  }

  return { screen, voice, claude, git };
}

export function startContextAccumulator(
  onSnapshot: (snapshot: ContextSnapshot) => void
): () => void {
  const events: ActivityEvent[] = [];
  const windowMs = config.contextWindowMinutes * 60 * 1000;

  const handleActivity = (event: ActivityEvent) => {
    events.push(event);
    log.debug("Event added", { type: event.type, totalEvents: events.length });
  };

  eventBus.on("activity", handleActivity);

  const prune = () => {
    const cutoff = new Date(Date.now() - windowMs);
    let pruned = 0;
    while (events.length > 0 && events[0].timestamp < cutoff) {
      events.shift();
      pruned++;
    }
    if (pruned > 0) {
      log.debug(`Pruned ${pruned} old events, ${events.length} remaining`);
    }
  };

  const emitSnapshot = () => {
    prune();

    if (events.length === 0) {
      log.debug("No events in window, skipping snapshot");
      return;
    }

    const { screen, voice, claude, git } = partitionEvents(events);
    const snapshot: ContextSnapshot = {
      timestamp: new Date(),
      screenActivity: screen,
      voiceActivity: voice,
      claudeActivity: claude,
      gitActivity: git,
      summary: buildSummary(screen, voice, claude, git),
    };

    log.info("Emitting context snapshot", {
      eventCount: events.length,
      screen: screen.length,
      voice: voice.length,
      claude: claude.length,
      git: git.length,
    });

    onSnapshot(snapshot);
  };

  const pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);
  const snapshotTimer = setInterval(emitSnapshot, SNAPSHOT_INTERVAL_MS);

  log.info("Context accumulator started", {
    windowMinutes: config.contextWindowMinutes,
    snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
  });

  return () => {
    eventBus.off("activity", handleActivity);
    clearInterval(pruneTimer);
    clearInterval(snapshotTimer);
    log.info("Context accumulator stopped");
  };
}
