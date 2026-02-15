import EventEmitter from "eventemitter3";

export type ScreenActivity = {
  type: "screen-activity";
  timestamp: Date;
  ocrText: string;
  appName?: string;
  windowTitle?: string;
};

export type VoiceActivity = {
  type: "voice-activity";
  timestamp: Date;
  transcript: string;
};

export type ClaudeActivity = {
  type: "claude-activity";
  timestamp: Date;
  sessionId: string;
  userMessage?: string;
  assistantMessage?: string;
  toolsUsed?: string[];
  filesModified?: string[];
};

export type GitActivity = {
  type: "git-activity";
  timestamp: Date;
  repo: string;
  commitHash: string;
  commitMessage: string;
  filesChanged: string[];
  additions: number;
  deletions: number;
  branch: string;
};

export type ActivityEvent =
  | ScreenActivity
  | VoiceActivity
  | ClaudeActivity
  | GitActivity;

type EventMap = {
  "screen-activity": [ScreenActivity];
  "voice-activity": [VoiceActivity];
  "claude-activity": [ClaudeActivity];
  "git-activity": [GitActivity];
  activity: [ActivityEvent];
};

const _bus = new EventEmitter<EventMap>();

export const eventBus = {
  on: _bus.on.bind(_bus) as EventEmitter<EventMap>["on"],
  off: _bus.off.bind(_bus) as EventEmitter<EventMap>["off"],
  emitActivity(event: keyof EventMap, data: ActivityEvent): void {
    if (event !== "activity") {
      _bus.emit("activity", data);
    }
    (_bus as any).emit(event, data);
  },
};

