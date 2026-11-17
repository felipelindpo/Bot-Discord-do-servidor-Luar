import fs from "node:fs";
import path from "node:path";

type RegistrationPanel = {
  channelId: string;
  messageId: string;
};

type PanelDatabase = Record<string, RegistrationPanel>;

const filePath = path.join(
  process.cwd(),
  "data",
  "registration-panels.json"
);

function readDatabase(): PanelDatabase {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "{}", "utf-8");
  }

  return JSON.parse(
    fs.readFileSync(filePath, "utf-8")
  ) as PanelDatabase;
}

export function getRegistrationPanel(
  guildId: string
): RegistrationPanel | undefined {
  return readDatabase()[guildId];
}

export function saveRegistrationPanel(
  guildId: string,
  panel: RegistrationPanel
): void {
  const database = readDatabase();
  database[guildId] = panel;

  fs.writeFileSync(
    filePath,
    JSON.stringify(database, null, 2),
    "utf-8"
  );
}
