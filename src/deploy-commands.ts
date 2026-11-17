import "dotenv/config";

import {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} from "discord.js";

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("Configure DISCORD_TOKEN, CLIENT_ID e GUILD_ID no .env");
}

const configurarCommand = new SlashCommandBuilder()
  .setName("configurar")
  .setDescription("Configura os canais de registros do Santaninha")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(option =>
    option
      .setName("evento")
      .setDescription("Qual evento deseja configurar?")
      .setRequired(true)
      .addChoices(
        { name: "Boas-vindas", value: "welcome" },
        { name: "Despedidas", value: "goodbye" },
        { name: "Entrada na call", value: "voiceJoin" },
        { name: "Saída da call", value: "voiceLeave" },
        { name: "Mudança de call", value: "voiceMove" },
        { name: "Mute e desmute", value: "voiceMute" },
        { name: "Áudio e surdez", value: "voiceDeaf" },
        { name: "Compartilhamento de tela", value: "voiceStream" },
        { name: "Mensagens enviadas", value: "messages" },
        { name: "Mensagens editadas", value: "messageUpdate" },
        { name: "Mensagens excluídas", value: "messageDelete" },
        { name: "Moderação", value: "moderation" }
      )
  )
  .addChannelOption(option =>
    option
      .setName("canal")
      .setDescription("Canal onde os registros serão enviados")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  );

const registroCommand = new SlashCommandBuilder()
  .setName("registro")
  .setDescription("Abre seu painel privado de registro");

const publicarRegistroCommand = new SlashCommandBuilder()
  .setName("publicar-registro")
  .setDescription("Publica ou atualiza o painel de registro do servidor")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(option =>
    option
      .setName("canal")
      .setDescription("Canal onde o painel será publicado")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  );

const limparCommand = new SlashCommandBuilder()
  .setName("limpar")
  .setDescription("Apaga mensagens de um canal escolhido")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addChannelOption(option =>
    option
      .setName("canal")
      .setDescription("Canal onde as mensagens serao apagadas")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .addIntegerOption(option =>
    option
      .setName("quantidade")
      .setDescription("Quantidade de mensagens para apagar (1 a 100)")
      .setMinValue(1)
      .setMaxValue(100)
      .setRequired(true)
  );
const adotarCommand = new SlashCommandBuilder()
  .setName("adotar")
  .setDescription("Adote seu primeiro mascote lunar");

const mascoteCommand = new SlashCommandBuilder()
  .setName("mascote")
  .setDescription("Veja o perfil e os atributos do seu mascote");

const alimentarCommand = new SlashCommandBuilder()
  .setName("alimentar")
  .setDescription("Alimente seu mascote");

const brincarCommand = new SlashCommandBuilder()
  .setName("brincar")
  .setDescription("Brinque com seu mascote");

const dormirCommand = new SlashCommandBuilder()
  .setName("dormir")
  .setDescription("Faça seu mascote descansar");

const mascotesCommand = new SlashCommandBuilder()
  .setName("mascotes")
  .setDescription("Veja a coleção de mascotes do servidor");

const resetarMascoteCommand = new SlashCommandBuilder()
  .setName("resetar-mascote")
  .setDescription("Troque seu mascote usando uma das suas 3 chances");

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

async function deploy() {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID!, GUILD_ID!),
    {
      body: [
        configurarCommand.toJSON(),
        registroCommand.toJSON(),
        publicarRegistroCommand.toJSON(),
        limparCommand.toJSON(),
        adotarCommand.toJSON(),
        mascoteCommand.toJSON(),
        alimentarCommand.toJSON(),
        brincarCommand.toJSON(),
        dormirCommand.toJSON(),
        mascotesCommand.toJSON(),
        resetarMascoteCommand.toJSON()
      ]
    }
  );

  console.log(
    "Comandos administrativos, registro e mascotes lunares registrados com sucesso!"
  );
}

deploy().catch(error => {
  console.error("Erro ao registrar comandos:", error);
  process.exitCode = 1;
});

