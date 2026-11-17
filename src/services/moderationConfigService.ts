import fs from "node:fs";
import path from "node:path";

export interface ModerationConfig {
  enabled: boolean;
  antiSpamEnabled: boolean;
  antiFloodEnabled: boolean;
  antiLinksEnabled: boolean;
  maxMessages: number;
  messageWindowSeconds: number;
  duplicateLimit: number;
  duplicateWindowSeconds: number;
  timeoutMinutes: number;
  logChannelId: string | null;
  exemptRoleIds: string[];
  allowedDomains: string[];
  blockedDomains: string[];
}

const defaultConfig: ModerationConfig = {
  enabled: false,
  antiSpamEnabled: false,
  antiFloodEnabled: false,
  antiLinksEnabled: false,
  maxMessages: 6,
  messageWindowSeconds: 5,
  duplicateLimit: 3,
  duplicateWindowSeconds: 15,
  timeoutMinutes: 1,
  logChannelId: null,
  exemptRoleIds: [],
  allowedDomains: [],
  blockedDomains: []
};

type ConfigDatabase = Record<string, Partial<ModerationConfig>>;

const filePath = path.join(
  process.cwd(),
  "data",
  "moderation-config.json"
);

function readDatabase(): ConfigDatabase {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{}", "utf-8");
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content) as ConfigDatabase;
}

function writeDatabase(database: ConfigDatabase): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.tmp`;

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(database, null, 2),
    "utf-8"
  );

  fs.renameSync(temporaryPath, filePath);
}

export function getModerationConfig(
  guildId: string
): ModerationConfig {
  const database = readDatabase();

  return {
    ...defaultConfig,
    ...database[guildId]
  };
}

export function updateModerationConfig(
  guildId: string,
  changes: Partial<ModerationConfig>
): ModerationConfig {
  const database = readDatabase();

  const current = {
    ...defaultConfig,
    ...database[guildId]
  };

  const updated: ModerationConfig = {
    ...current,
    ...changes
  };

  database[guildId] = updated;
  writeDatabase(database);

  return updated;
}

export function setModerationLogChannel(
  guildId: string,
  channelId: string | null
): ModerationConfig {
  return updateModerationConfig(guildId, {
    logChannelId: channelId
  });
}