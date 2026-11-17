import type { ModerationConfig } from "../services/moderationConfigService";

export type ModerationRule = "flood" | "duplicate";

export interface ModerationCheckResult {
  triggered: boolean;
  rule: ModerationRule | null;
  reason: string | null;
}

interface UserMessageState {
  timestamps: number[];
  recentContents: Array<{
    content: string;
    timestamp: number;
  }>;
}

const messageStates = new Map<string, UserMessageState>();

function normalizeContent(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getStateKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export function inspectMessage(
  guildId: string,
  userId: string,
  content: string,
  config: ModerationConfig,
  now = Date.now()
): ModerationCheckResult {
  const key = getStateKey(guildId, userId);

  const state = messageStates.get(key) ?? {
    timestamps: [],
    recentContents: []
  };

  const windowMs = Math.max(1, config.messageWindowSeconds) * 1000;
  const duplicateWindowMs =
    Math.max(1, config.duplicateWindowSeconds) * 1000;

  state.timestamps = state.timestamps.filter(
    timestamp => now - timestamp < windowMs
  );

  state.recentContents = state.recentContents.filter(
    item => now - item.timestamp < duplicateWindowMs
  );

  state.timestamps.push(now);

  const normalized = normalizeContent(content);

  if (normalized.length > 0) {
    state.recentContents.push({
      content: normalized,
      timestamp: now
    });
  }

  let result: ModerationCheckResult = {
    triggered: false,
    rule: null,
    reason: null
  };

  if (
    config.enabled &&
    config.antiSpamEnabled &&
    normalized.length > 0
  ) {
    const duplicateCount = state.recentContents.filter(
      item => item.content === normalized
    ).length;

    if (duplicateCount >= config.duplicateLimit) {
      result = {
        triggered: true,
        rule: "duplicate",
        reason: `Mensagem repetida ${duplicateCount} vezes em ${config.duplicateWindowSeconds} segundos.`
      };
    }
  }

  if (
    !result.triggered &&
    config.enabled &&
    config.antiFloodEnabled &&
    state.timestamps.length >= config.maxMessages
  ) {
    result = {
      triggered: true,
      rule: "flood",
      reason: `${state.timestamps.length} mensagens enviadas em ${config.messageWindowSeconds} segundos.`
    };
  }

  if (result.triggered) {
    state.timestamps = [];
    state.recentContents = [];
  }

  messageStates.set(key, state);

  return result;
}

export function clearMessageState(
  guildId: string,
  userId: string
): void {
  messageStates.delete(getStateKey(guildId, userId));
}