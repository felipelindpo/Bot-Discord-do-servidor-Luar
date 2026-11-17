
import fs from "node:fs";
import path from "node:path";

export type LogEvent =
  | "welcome"
  | "goodbye"
  | "voiceJoin"
  | "voiceLeave"
  | "voiceMove"
  | "voiceMute"
  | "voiceDeaf"
  | "voiceStream"
  | "messages"
  | "messageUpdate"
  | "messageDelete"
  | "moderation";

type GuildConfig = Record<string, Partial<Record<LogEvent, string>>>;

const filePath = path.join(process.cwd(), "data", "guild-config.json");

function readConfig(): GuildConfig {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{}");
  }

  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function setLogChannel(
  guildId: string,
  event: LogEvent,
  channelId: string
): void {
  const config = readConfig();

  config[guildId] ??= {};
  config[guildId][event] = channelId;

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
}

export function getLogChannel(
  guildId: string,
  event: LogEvent
): string | undefined {
  return readConfig()[guildId]?.[event];
}

