import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { config } from "../config";
import { eventBus, ClaudeActivity } from "../eventBus";
import { createLogger } from "../utils/logger";
import { loadState, saveState } from "../utils/state";

const log = createLogger("claude-collector");

type JsonlEntry = {
  type?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  toolName?: string;
  tool_name?: string;
  filePath?: string;
};

function parseContent(
  content: string | Array<{ type: string; text?: string }> | undefined
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");
}

function extractToolsAndFiles(entries: JsonlEntry[]): {
  toolsUsed: string[];
  filesModified: string[];
} {
  const tools = new Set<string>();
  const files = new Set<string>();

  for (const entry of entries) {
    const toolName = entry.toolName || entry.tool_name;
    if (toolName) tools.add(toolName);
    if (entry.filePath) files.add(entry.filePath);
  }

  return {
    toolsUsed: [...tools],
    filesModified: [...files],
  };
}

function processNewLines(filePath: string, offset: number): {
  activities: ClaudeActivity[];
  newOffset: number;
} {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    log.warn("Failed to read JSONL file", { filePath, error: String(err) });
    return { activities: [], newOffset: offset };
  }

  const allLines = content.split("\n").filter(Boolean);
  if (offset >= allLines.length) {
    return { activities: [], newOffset: allLines.length };
  }

  const newLines = allLines.slice(offset);
  const activities: ClaudeActivity[] = [];
  const sessionId = path.basename(filePath, ".jsonl");
  const pendingEntries: JsonlEntry[] = [];
  let currentUserMessage: string | undefined;

  for (const line of newLines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "human" && entry.message?.role === "user") {
      if (currentUserMessage) {
        const { toolsUsed, filesModified } =
          extractToolsAndFiles(pendingEntries);
        activities.push({
          type: "claude-activity",
          timestamp: new Date(),
          sessionId,
          userMessage: currentUserMessage,
          toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
          filesModified: filesModified.length > 0 ? filesModified : undefined,
        });
        pendingEntries.length = 0;
      }
      currentUserMessage = parseContent(entry.message.content);
    } else if (entry.type === "assistant") {
      pendingEntries.push(entry);
      const assistantText = entry.message
        ? parseContent(entry.message.content)
        : undefined;

      if (assistantText && currentUserMessage) {
        const { toolsUsed, filesModified } =
          extractToolsAndFiles(pendingEntries);
        activities.push({
          type: "claude-activity",
          timestamp: new Date(),
          sessionId,
          userMessage: currentUserMessage,
          assistantMessage:
            assistantText.length > 500
              ? assistantText.slice(0, 500) + "..."
              : assistantText,
          toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
          filesModified: filesModified.length > 0 ? filesModified : undefined,
        });
        currentUserMessage = undefined;
        pendingEntries.length = 0;
      }
    } else {
      pendingEntries.push(entry);
    }
  }

  if (currentUserMessage) {
    const { toolsUsed, filesModified } = extractToolsAndFiles(pendingEntries);
    activities.push({
      type: "claude-activity",
      timestamp: new Date(),
      sessionId,
      userMessage: currentUserMessage,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
      filesModified: filesModified.length > 0 ? filesModified : undefined,
    });
  }

  return { activities, newOffset: allLines.length };
}

export function startClaudeCodeCollector(): () => void {
  const projectsPath = path.join(config.claudeHistoryPath, "projects");

  if (!fs.existsSync(projectsPath)) {
    log.info("Claude projects path not found, skipping", { projectsPath });
    return () => {};
  }

  log.info("Starting Claude Code collector", { projectsPath });

  const watcher = chokidar.watch(path.join(projectsPath, "**/*.jsonl"), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher.on("change", (filePath) => {
    try {
      const currentState = loadState();
      const offset = currentState.lastClaudeEventOffset[filePath] || 0;
      const { activities, newOffset } = processNewLines(filePath, offset);

      for (const activity of activities) {
        eventBus.emitActivity("claude-activity", activity);
        log.info("Claude activity detected", {
          sessionId: activity.sessionId,
          userMessage: activity.userMessage?.slice(0, 100),
          toolsUsed: activity.toolsUsed,
        });
      }

      if (newOffset > offset) {
        currentState.lastClaudeEventOffset[filePath] = newOffset;
        saveState(currentState);
      }
    } catch (err) {
      log.error("Error processing Claude Code changes", {
        filePath,
        error: String(err),
      });
    }
  });

  watcher.on("add", (filePath) => {
    try {
      const currentState = loadState();
      if (currentState.lastClaudeEventOffset[filePath] === undefined) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lineCount = content.split("\n").filter(Boolean).length;
        currentState.lastClaudeEventOffset[filePath] = lineCount;
        saveState(currentState);
        log.debug("Initialized offset for new JSONL file", {
          filePath,
          offset: lineCount,
        });
      }
    } catch (err) {
      log.warn("Error initializing new JSONL file", {
        filePath,
        error: String(err),
      });
    }
  });

  watcher.on("error", (err) => {
    log.error("Watcher error", { error: String(err) });
  });

  return () => {
    watcher.close().catch((err) => {
      log.error("Error closing watcher", { error: String(err) });
    });
    log.info("Claude Code collector stopped");
  };
}
