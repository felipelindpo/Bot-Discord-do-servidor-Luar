import "dotenv/config";

import {
  Client,
  GatewayIntentBits
} from "discord.js";

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;

if (!token || !guildId) {
  throw new Error("DISCORD_TOKEN ou GUILD_ID não configurado no .env");
}

const rolesToCreate: { name: string; color?: number }[] = [
  { name: "Menor de 18" },
  { name: "18 ou mais" },

  { name: "Cor | Vermelho", color: 0xEF4444 },
  { name: "Cor | Laranja", color: 0xF97316 },
  { name: "Cor | Amarelo", color: 0xEAB308 },
  { name: "Cor | Verde", color: 0x22C55E },
  { name: "Cor | Ciano", color: 0x06B6D4 },
  { name: "Cor | Azul", color: 0x3B82F6 },
  { name: "Cor | Roxo", color: 0xA855F7 },
  { name: "Cor | Rosa", color: 0xEC4899 },
  { name: "Cor | Branco", color: 0xF8FAFC },
  { name: "Cor | Preto", color: 0x1F2937 }
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function createRoles() {
  try {
    console.log("Conectando ao Discord...");

    await client.login(token);

    const guild = await client.guilds.fetch(guildId!);

    console.log(`Servidor encontrado: ${guild.name}`);

    await guild.roles.fetch();

    let created = 0;
    let existing = 0;

    for (const roleData of rolesToCreate) {
      const found = guild.roles.cache.find(
        role => role.name === roleData.name
      );

      if (found) {
        console.log(`[EXISTENTE] ${roleData.name}`);
        existing++;
        continue;
      }

      await guild.roles.create({
        name: roleData.name,
        ...(roleData.color !== undefined ? { color: roleData.color } : {}),
        reason: "Criação automática dos cargos do sistema de registro Santaninha"
      });

      console.log(`[CRIADO] ${roleData.name}`);
      created++;
    }

    console.log("");
    console.log("==================================");
    console.log("CRIAÇÃO DE CARGOS CONCLUÍDA");
    console.log(`Criados: ${created}`);
    console.log(`Já existentes: ${existing}`);
    console.log(`Total: ${rolesToCreate.length}`);
    console.log("==================================");
  } catch (error) {
    console.error("Erro ao criar cargos:", error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
}

createRoles();


