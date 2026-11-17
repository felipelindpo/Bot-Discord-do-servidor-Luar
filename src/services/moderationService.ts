import {
  Message,
  PermissionFlagsBits
} from "discord.js";

export type ModerationViolation = {
  rule: "antiSpam" | "repeated";
  reason: string;
  count: number;
};

const SPAM_LIMIT = 6;
const SPAM_WINDOW_MS = 8_000;

const REPEAT_LIMIT = 3;
const REPEAT_WINDOW_MS = 20_000;

const PUNISHMENT_COOLDOWN_MS = 60_000;

const messageHistory = new Map<string, number[]>();

const repeatedHistory = new Map<
  string,
  { content: string; timestamps: number[] }
>();

const punishmentCooldown = new Map<string, number>();

export function checkMessageModeration(
  message: Message
): ModerationViolation | null {
  if (!message.guildId || !message.member || message.author.bot) {
    return null;
  }

  const member = message.member;

  // Não moderar administradores ou membros com permissão de moderação.
  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    return null;
  }

  const now = Date.now();
  const userKey = `${message.guildId}:${message.author.id}`;

  // Evita aplicar várias punições consecutivas ao mesmo usuário.
  const lastPunishment = punishmentCooldown.get(userKey);

  if (
    lastPunishment &&
    now - lastPunishment < PUNISHMENT_COOLDOWN_MS
  ) {
    return null;
  }

  // ANTI-FLOOD
  const recentMessages = (messageHistory.get(userKey) ?? [])
    .filter(timestamp => now - timestamp <= SPAM_WINDOW_MS);

  recentMessages.push(now);
  messageHistory.set(userKey, recentMessages);

  if (recentMessages.length >= SPAM_LIMIT) {
    punishmentCooldown.set(userKey, now);

    return {
      rule: "antiSpam",
      reason: `Enviou ${recentMessages.length} mensagens em menos de 8 segundos.`,
      count: recentMessages.length
    };
  }

  // ANTI-MENSAGENS REPETIDAS
  const normalizedContent = message.content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (normalizedContent.length >= 4) {
    const previous = repeatedHistory.get(userKey);

    const timestamps =
      previous?.content === normalizedContent
        ? previous.timestamps.filter(
            timestamp => now - timestamp <= REPEAT_WINDOW_MS
          )
        : [];

    timestamps.push(now);

    repeatedHistory.set(userKey, {
      content: normalizedContent,
      timestamps
    });

    if (timestamps.length >= REPEAT_LIMIT) {
      punishmentCooldown.set(userKey, now);

      return {
        rule: "repeated",
        reason: "Enviou a mesma mensagem repetidamente.",
        count: timestamps.length
      };
    }
  }

  return null;
}