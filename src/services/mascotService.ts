import fs from "node:fs";
import path from "node:path";

export type MascotRarity =
  | "Comum"
  | "Incomum"
  | "Raro"
  | "Épico"
  | "Lendário"
  | "Secreto";

export interface Mascot {
  guildId: string;
  userId: string;
  name: string;
  species: string;
  emoji: string;
  rarity: MascotRarity;
  level: number;
  experience: number;
  hunger: number;
  energy: number;
  happiness: number;
  attack: number;
  defense: number;
  speed: number;
  adoptedAt: string;
  lastInteraction: string;
  resetsRemaining?: number;
}

type MascotDatabase = Record<string, Mascot>;

const filePath = path.join(
  process.cwd(),
  "data",
  "mascotes.json"
);

const creatures = [
  {
    name: "Luninho",
    species: "Coelho Lunar",
    emoji: "🐰",
    rarity: "Comum" as const,
    weight: 50
  },
  {
    name: "Estrelinha",
    species: "Gatinho Celestial",
    emoji: "🐱",
    rarity: "Incomum" as const,
    weight: 25
  },
  {
    name: "Nébula",
    species: "Raposa Estelar",
    emoji: "🦊",
    rarity: "Raro" as const,
    weight: 15
  },
  {
    name: "Astro",
    species: "Dragão Cósmico",
    emoji: "🐉",
    rarity: "Épico" as const,
    weight: 7
  },
  {
    name: "Celeste",
    species: "Fênix Lunar",
    emoji: "🪽",
    rarity: "Lendário" as const,
    weight: 2.5
  },
  {
    name: "Eclipse",
    species: "Guardião do Vazio",
    emoji: "🌌",
    rarity: "Secreto" as const,
    weight: 0.5
  }
];

function readDatabase(): MascotDatabase {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), {
      recursive: true
    });

    fs.writeFileSync(filePath, "{}", "utf-8");
  }

  return JSON.parse(
    fs.readFileSync(filePath, "utf-8")
  ) as MascotDatabase;
}

function writeDatabase(database: MascotDatabase): void {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true
  });

  const temporaryPath = `${filePath}.tmp`;

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(database, null, 2),
    "utf-8"
  );

  fs.renameSync(temporaryPath, filePath);
}

function getKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function randomCreature() {
  const total = creatures.reduce(
    (sum, creature) => sum + creature.weight,
    0
  );

  let roll = Math.random() * total;

  for (const creature of creatures) {
    roll -= creature.weight;

    if (roll < 0) {
      return creature;
    }
  }

  return creatures[0];
}

function updateMascot(
  guildId: string,
  userId: string,
  update: (mascot: Mascot) => void
): Mascot {
  const database = readDatabase();
  const key = getKey(guildId, userId);
  const mascot = database[key];

  if (!mascot) {
    throw new Error("Você ainda não adotou um mascote.");
  }

  update(mascot);

  mascot.hunger = Math.max(0, Math.min(100, mascot.hunger));
  mascot.energy = Math.max(0, Math.min(100, mascot.energy));
  mascot.happiness = Math.max(0, Math.min(100, mascot.happiness));

  mascot.lastInteraction = new Date().toISOString();

  const previousLevel = mascot.level;
  mascot.level = calculateLevel(mascot);

  const levelsGained = mascot.level - previousLevel;

  if (levelsGained > 0) {
    mascot.attack += levelsGained * 2;
    mascot.defense += levelsGained * 2;
    mascot.speed += levelsGained * 2;
  }

  writeDatabase(database);

  return mascot;
}

export function adoptMascot(
  guildId: string,
  userId: string
): Mascot {
  const database = readDatabase();
  const key = getKey(guildId, userId);

  if (database[key]) {
    throw new Error("Você já possui um mascote! Use /mascote para vê-lo.");
  }

  const creature = randomCreature();
  const now = new Date().toISOString();

  const mascot: Mascot = {
    guildId,
    userId,
    name: creature.name,
    species: creature.species,
    emoji: creature.emoji,
    rarity: creature.rarity,
    level: 1,
    experience: 0,
    hunger: 100,
    energy: 100,
    happiness: 100,
    attack: 10,
    defense: 10,
    speed: 10,
    adoptedAt: now,
    lastInteraction: now,
    resetsRemaining: 3
  };

  database[key] = mascot;
  writeDatabase(database);

  return mascot;
}

export function getMascot(
  guildId: string,
  userId: string
): Mascot | null {
  return readDatabase()[getKey(guildId, userId)] ?? null;
}

export function getMascots(
  guildId: string
): Mascot[] {
  return Object.values(readDatabase()).filter(
    mascot => mascot.guildId === guildId
  );
}

export function feedMascot(
  guildId: string,
  userId: string
): Mascot {
  return updateMascot(guildId, userId, mascot => {
    if (mascot.hunger >= 100) {
      throw new Error("Seu mascote já está completamente alimentado!");
    }

    mascot.hunger += 30;
    mascot.experience += 5;
  });
}

export function playWithMascot(
  guildId: string,
  userId: string
): Mascot {
  return updateMascot(guildId, userId, mascot => {
    if (mascot.energy < 20) {
      throw new Error("Seu mascote está cansado! Deixe-o descansar.");
    }

    mascot.happiness += 25;
    mascot.energy -= 20;
    mascot.experience += 10;
  });
}

export function sleepMascot(
  guildId: string,
  userId: string
): Mascot {
  return updateMascot(guildId, userId, mascot => {
    if (mascot.energy >= 100) {
      throw new Error("Seu mascote já está descansado!");
    }

    mascot.energy = 100;
  });
}

export function calculateLevel(mascot: Mascot): number {
  return Math.floor(mascot.experience / 100) + 1;
}
export function resetMascot(
  guildId: string,
  userId: string
): { mascot: Mascot; remaining: number } {
  const database = readDatabase();
  const key = getKey(guildId, userId);
  const currentMascot = database[key];

  if (!currentMascot) {
    throw new Error("Você ainda não possui um mascote para resetar.");
  }

  const remaining = currentMascot.resetsRemaining ?? 3;

  if (remaining <= 0) {
    throw new Error("Você já utilizou suas 3 chances de reset. Não há mais tentativas disponíveis.");
  }

  const creature = randomCreature();
  const now = new Date().toISOString();

  const mascot: Mascot = {
    ...currentMascot,
    name: creature.name,
    species: creature.species,
    emoji: creature.emoji,
    rarity: creature.rarity,
    level: 1,
    experience: 0,
    hunger: 100,
    energy: 100,
    happiness: 100,
    attack: 10,
    defense: 10,
    speed: 10,
    adoptedAt: now,
    lastInteraction: now,
    resetsRemaining: remaining - 1
  };

  database[key] = mascot;
  writeDatabase(database);

  return {
    mascot,
    remaining: remaining - 1
  };
}