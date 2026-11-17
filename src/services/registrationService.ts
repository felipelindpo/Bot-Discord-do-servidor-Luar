import fs from "node:fs";
import path from "node:path";

export type RegistrationField = "age" | "gender" | "sexuality" | "color";

type UserRegistration = {
  age?: string;
  gender?: string;
  sexuality?: string;
  color?: string;
  updatedAt?: string;
};

type RegistrationDatabase = Record<
  string,
  Record<string, UserRegistration>
>;

const filePath = path.join(process.cwd(), "data", "registrations.json");

function readDatabase(): RegistrationDatabase {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{}", "utf-8");
  }

  try {
    return JSON.parse(
      fs.readFileSync(filePath, "utf-8")
    ) as RegistrationDatabase;
  } catch {
    throw new Error("O arquivo de registros está inválido.");
  }
}

export function saveRegistrationChoice(
  guildId: string,
  userId: string,
  field: RegistrationField,
  value: string
): void {
  const database = readDatabase();

  database[guildId] ??= {};
  database[guildId][userId] ??= {};

  database[guildId][userId][field] = value;
  database[guildId][userId].updatedAt = new Date().toISOString();

  fs.writeFileSync(
    filePath,
    JSON.stringify(database, null, 2),
    "utf-8"
  );
}
