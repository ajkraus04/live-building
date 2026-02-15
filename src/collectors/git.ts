import { execSync } from "child_process";
import path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { config } from "../config";
import { eventBus, GitActivity } from "../eventBus";
import { createLogger } from "../utils/logger";
import { loadState, saveState } from "../utils/state";

const log = createLogger("git-collector");

function getCurrentBranch(repoPath: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: repoPath,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function getNewCommits(
  repoPath: string,
  sinceCommit: string | undefined
): GitActivity[] {
  const branch = getCurrentBranch(repoPath);
  const range = sinceCommit ? `${sinceCommit}..HEAD` : "-5";

  let output: string;
  try {
    output = execSync(
      `git log ${range} --oneline --stat --format="%H %s"`,
      { cwd: repoPath, encoding: "utf-8" }
    ).trim();
  } catch (err) {
    log.warn("Failed to get git log", { repoPath, error: String(err) });
    return [];
  }

  if (!output) return [];

  const activities: GitActivity[] = [];
  const commitBlocks = output.split(/(?=^[a-f0-9]{40} )/m);

  for (const block of commitBlocks) {
    if (!block.trim()) continue;

    const lines = block.trim().split("\n");
    const headerMatch = lines[0].match(/^([a-f0-9]{40})\s+(.+)$/);
    if (!headerMatch) continue;

    const [, commitHash, commitMessage] = headerMatch;
    const filesChanged: string[] = [];
    let additions = 0;
    let deletions = 0;

    for (let i = 1; i < lines.length; i++) {
      const fileLine = lines[i].trim();
      if (!fileLine) continue;

      const summaryMatch = fileLine.match(
        /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/
      );
      if (summaryMatch) {
        additions = parseInt(summaryMatch[2] || "0", 10);
        deletions = parseInt(summaryMatch[3] || "0", 10);
        continue;
      }

      const fileMatch = fileLine.match(/^\s*(.+?)\s+\|\s+\d+/);
      if (fileMatch) {
        filesChanged.push(fileMatch[1].trim());
      }
    }

    activities.push({
      type: "git-activity",
      timestamp: new Date(),
      repo: path.basename(repoPath),
      commitHash,
      commitMessage,
      filesChanged,
      additions,
      deletions,
      branch,
    });
  }

  return activities;
}

export function startGitCollector(): () => void {
  const state = loadState();
  const repos = config.watchedRepos;

  if (repos.length === 0) {
    log.info("No repos configured to watch");
    return () => {};
  }

  log.info("Starting git collector", { repos });

  const watchers: FSWatcher[] = [];

  for (const repoPath of repos) {
    const gitHeadLog = path.join(repoPath, ".git", "logs", "HEAD");

    const watcher = chokidar.watch(gitHeadLog, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });

    watcher.on("change", () => {
      try {
        const currentState = loadState();
        const lastCommit = currentState.lastGitCommit[repoPath];
        const activities = getNewCommits(repoPath, lastCommit);

        for (const activity of activities) {
          eventBus.emitActivity("git-activity", activity);
          log.info("Git activity detected", {
            repo: activity.repo,
            commit: activity.commitHash.slice(0, 7),
            message: activity.commitMessage,
          });
        }

        if (activities.length > 0) {
          currentState.lastGitCommit[repoPath] =
            activities[activities.length - 1].commitHash;
          saveState(currentState);
        }
      } catch (err) {
        log.error("Error processing git changes", {
          repoPath,
          error: String(err),
        });
      }
    });

    watcher.on("error", (err) => {
      log.error("Watcher error", { repoPath, error: String(err) });
    });

    watchers.push(watcher);
    log.info("Watching git repo", { repoPath });
  }

  return () => {
    for (const watcher of watchers) {
      watcher.close().catch((err: unknown) => {
        log.error("Error closing watcher", { error: String(err) });
      });
    }
    log.info("Git collector stopped");
  };
}
