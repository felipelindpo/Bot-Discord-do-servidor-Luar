import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";

import {
  Client,
  AttachmentBuilder,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  PermissionFlagsBits,
  Partials,
  TextChannel,
  ButtonBuilder,
  ButtonStyle,
  Role,
  StringSelectMenuBuilder,
  ActionRowBuilder
} from "discord.js";

import {
  setLogChannel,
  getLogChannel,
  LogEvent
} from "./config/guildConfig";

import {
  saveRegistrationChoice,
  RegistrationField
} from "./services/registrationService";
import {
  getRegistrationPanel,
  saveRegistrationPanel
} from "./services/registrationPanelService";
import { getModerationConfig } from "./services/moderationConfigService";
import { inspectMessage } from "./moderation/antiSpam";

import {
  adoptMascot,
  getMascot,
  getMascots,
  feedMascot,
  playWithMascot,
  sleepMascot,
  resetMascot
} from "./services/mascotService";

import { handleMusicCommand } from "./services/musicService";

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error("DISCORD_TOKEN não foi definido no .env");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// CONFIGURAÇÕES DOS CARGOS

const ageRoles = [
  "Menor de 18",
  "18 ou mais"
];

const colorRoles: Record<string, string> = {
  red: "Cor | Vermelho",
  orange: "Cor | Laranja",
  yellow: "Cor | Amarelo",
  green: "Cor | Verde",
  cyan: "Cor | Ciano",
  blue: "Cor | Azul",
  purple: "Cor | Roxo",
  pink: "Cor | Rosa",
  white: "Cor | Branco",
  black: "Cor | Preto"
};

const colorRoleNames = Object.values(colorRoles);

const genderOptions: Record<string, string> = {
  man: "Homem",
  woman: "Mulher",
  nonbinary: "Não binário",
  other: "Outra identidade",
  skip: ""
};

const sexualityOptions: Record<string, string> = {
  heterosexual: "Heterossexual",
  homosexual: "Homossexual",
  bisexual: "Bissexual",
  pansexual: "Pansexual",
  asexual: "Assexual",
  other: "Outra",
  skip: ""
};

// PAINEL PRIVADO DE REGISTRO

function createRegistrationRows() {
  const ageMenu = new StringSelectMenuBuilder()
    .setCustomId("registro:age")
    .setPlaceholder("Selecione sua faixa etária")
    .addOptions(
      { label: "Menor de 18", value: "under18", emoji: "🟣" },
      { label: "18 ou mais", value: "18plus", emoji: "🟣" }
    );

  const genderMenu = new StringSelectMenuBuilder()
    .setCustomId("registro:gender")
    .setPlaceholder("Gênero (opcional)")
    .addOptions(
      { label: "Homem", value: "man" },
      { label: "Mulher", value: "woman" },
      { label: "Não binário", value: "nonbinary" },
      { label: "Outra identidade", value: "other" },
      { label: "Prefiro não informar", value: "skip" }
    );

  const sexualityMenu = new StringSelectMenuBuilder()
    .setCustomId("registro:sexuality")
    .setPlaceholder("Sexualidade (opcional)")
    .addOptions(
      { label: "Heterossexual", value: "heterosexual" },
      { label: "Homossexual", value: "homosexual" },
      { label: "Bissexual", value: "bisexual" },
      { label: "Pansexual", value: "pansexual" },
      { label: "Assexual", value: "asexual" },
      { label: "Outra", value: "other" },
      { label: "Prefiro não informar", value: "skip" }
    );

  const colorMenu = new StringSelectMenuBuilder()
    .setCustomId("registro:color")
    .setPlaceholder("Escolha a cor do seu nickname")
    .addOptions(
      { label: "Vermelho", value: "red", emoji: "🔴" },
      { label: "Laranja", value: "orange", emoji: "🟠" },
      { label: "Amarelo", value: "yellow", emoji: "🟡" },
      { label: "Verde", value: "green", emoji: "🟢" },
      { label: "Ciano", value: "cyan", emoji: "🔵" },
      { label: "Azul", value: "blue", emoji: "🔵" },
      { label: "Roxo", value: "purple", emoji: "🟣" },
      { label: "Rosa", value: "pink", emoji: "🌸" },
      { label: "Branco", value: "white", emoji: "⚪" },
      { label: "Preto", value: "black", emoji: "⚫" }
    );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(ageMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(genderMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sexualityMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(colorMenu)
  ];
}

// ATRIBUIR UM CARGO E REMOVER OS ANTERIORES DA MESMA CATEGORIA

async function assignExclusiveRole(
  guild: import("discord.js").Guild,
  userId: string,
  targetRoleName: string,
  groupRoleNames: string[]
): Promise<void> {
  const roles = await guild.roles.fetch();
  const targetRole = roles.find(role => role.name === targetRoleName);

  if (!targetRole) {
    throw new Error(`Cargo não encontrado: ${targetRoleName}`);
  }

  const member = await guild.members.fetch(userId);

  // Adiciona primeiro o novo cargo para evitar remover o antigo
  // caso a atribuição falhe.
  await member.roles.add(targetRole);

  const oldRoles = groupRoleNames
    .filter(name => name !== targetRoleName)
    .map(name => roles.find(role => role.name === name))
    .filter((role): role is Role =>
      role !== undefined && member.roles.cache.has(role.id)
    );

  if (oldRoles.length > 0) {
    await member.roles.remove(oldRoles);
  }
}

// SISTEMA DE LOGS

async function sendLog(
  guildId: string,
  event: LogEvent,
  embed: EmbedBuilder
): Promise<void> {
  const channelId = getLogChannel(guildId, event);

  if (!channelId) {
    console.log(`[LOG] Evento ${event} sem canal configurado.`);
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);

    if (channel?.isTextBased() && "send" in channel) {
      await (channel as TextChannel).send({ embeds: [embed] });
    }
  } catch (error) {
    console.error(`[LOG] Erro ao enviar ${event}:`, error);
  }
}

// BOT ONLINE

client.once(Events.ClientReady, bot => {
  console.log("-----------------------------------");
  console.log(`Santaninha conectado como ${bot.user.tag}`);
  console.log(`Servidores: ${bot.guilds.cache.size}`);
  console.log("-----------------------------------");
});

// INTERAÇÕES E COMANDOS

client.on(Events.InteractionCreate, async interaction => {
  console.log(
    `[INTERACTION] Recebida: ${interaction.type}`,
    interaction.isChatInputCommand() ? interaction.commandName : ""
  );

  // COMANDOS SLASH

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "limpar") {
      try {
        await interaction.deferReply({ ephemeral: true });
        if (!interaction.guild) {
          await interaction.editReply({ content: "Este comando so pode ser usado dentro de um servidor." });
          return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
          await interaction.editReply({ content: "Voce precisa da permissao Gerenciar mensagens para usar este comando." });
          return;
        }

        const targetChannel = interaction.options.getChannel(
          "canal",
          true
        ) as TextChannel;

        const amount = interaction.options.getInteger("quantidade", true);

        const botMember = await interaction.guild.members.fetchMe();
        const botPermissions = targetChannel.permissionsFor(botMember);

        if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
          await interaction.editReply({ content: "Nao tenho permissao para gerenciar mensagens nesse canal." });
          return;
        }


        const deletedMessages = await targetChannel.bulkDelete(amount, true);
        const deletedCount = deletedMessages.size;
        const skippedCount = amount - deletedCount;

        let response = `Foram apagadas ${deletedCount} mensagem(ns) em ${targetChannel}.`;

        if (deletedCount === 0) {
          response = `Nenhuma mensagem recente foi encontrada em ${targetChannel}.`;
        }

        if (skippedCount > 0) {
          response += ` ${skippedCount} mensagem(ns) nao foram apagadas, possivelmente por terem mais de 14 dias.`;
        }

        await interaction.editReply({ content: response });
      } catch (error) {
        console.error("[LIMPAR] Erro:", error);

        const response = {
          content: "Ocorreu um erro ao tentar apagar as mensagens. Verifique as permissoes do bot e tente novamente."
        };

        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(response).catch(console.error);
        } else {
          await interaction.reply({
            ...response,
            ephemeral: true
          }).catch(console.error);
        }
      }

      return;
    }

    if (interaction.commandName === "configurar") {
      try {
        await interaction.deferReply({ ephemeral: true });
        if (!interaction.guildId) {
          await interaction.editReply({ content: "Este comando só pode ser usado dentro de um servidor." });
          return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.editReply({ content: "Você não tem permissão para configurar o bot." });
          return;
        }


        const event = interaction.options.getString("evento", true) as LogEvent;
        const channel = interaction.options.getChannel("canal", true);

        setLogChannel(interaction.guildId, event, channel.id);

        await interaction.editReply({
          content: `✅ Configuração salva! Os registros de **${event}** serão enviados em <#${channel.id}>.`
        });

        console.log(`[CONFIGURAR] ${event} configurado.`);
      } catch (error) {
        console.error("[CONFIGURAR] Erro:", error);

        const message = "Ocorreu um erro ao salvar a configuração.";

        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: message }).catch(console.error);
        } else {
          await interaction.reply({
            content: message,
            ephemeral: true
          }).catch(console.error);
        }
      }

      return;
    }

    if (interaction.commandName === "publicar-registro") {
      try {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.guildId) {
          await interaction.editReply({ content: "Este comando só pode ser usado dentro de um servidor." });
          return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.editReply({ content: "Você precisa da permissão Gerenciar servidor para publicar o painel." });
          return;
        }

        if (!interaction.guild) {
          await interaction.editReply("Este comando só pode ser usado dentro de um servidor.");
          return;
        }

        const selectedChannel = interaction.options.getChannel("canal", true);

        if (selectedChannel.type !== 0) {
          await interaction.editReply("Selecione um canal de texto válido.");
          return;
        }

        const channel = await interaction.guild.channels.fetch(selectedChannel.id);

        if (!channel || channel.type !== 0) {
          await interaction.editReply("Não foi possível acessar esse canal.");
          return;
        }

        const embed = new EmbedBuilder()
          .setColor("#8B5CF6")
          .setAuthor({
            name: "LUAR COMMUNITY"
          })
          .setTitle("🌙  Bem-vindo ao Luar")
          .setDescription(
            [
              "### Seu cantinho na comunidade começa aqui.",
              "Estamos felizes por ter você conosco! Antes de explorar o servidor, complete seu registro para desbloquear sua experiência no Luar.",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "### ✦ COMO FUNCIONA?",
              "",
              "🌙 **01. Escolha sua faixa etária**",
              "Informe se você tem menos de 18 anos ou 18 anos ou mais.",
              "",
              "🎭 **02. Personalize seu perfil**",
              "Escolha sua cor de nickname e, se desejar, informe gênero e sexualidade.",
              "",
              "✨ **03. Finalize seu registro**",
              "Suas escolhas serão salvas e os cargos correspondentes serão atribuídos.",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "🔒 **PRIVACIDADE EM PRIMEIRO LUGAR**",
              "Gênero e sexualidade são opcionais e suas escolhas não serão exibidas publicamente.",
              "",
              "👇 Clique no botão abaixo e venha fazer parte do Luar!"
            ].join("\n")
          )
          .addFields(
            {
              name: "📝  REGISTRO",
              value: "Processo rápido e realizado diretamente pelo Discord.",
              inline: true
            },
            {
              name: "🎨  PERSONALIZAÇÃO",
              value: "Dez opções de cores para seu nickname.",
              inline: true
            }
          )
          .setFooter({
            text: "Santaninha.bot • Feito com carinho para o Luar"
          })
          .setTimestamp();
        const button = new ButtonBuilder()
          .setCustomId("registro:open")
          .setLabel("Começar meu registro")
          .setEmoji("📝")
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(button);

        const previousPanel = getRegistrationPanel(interaction.guildId);
        let publishedMessage = null;

        if (previousPanel && previousPanel.channelId === channel.id) {
          try {
            publishedMessage = await channel.messages.fetch(
              previousPanel.messageId
            );

            await publishedMessage.edit({
              embeds: [embed],
              components: [row]
            });
          } catch {
            publishedMessage = null;
          }
        }

        if (!publishedMessage) {
          publishedMessage = await channel.send({
            embeds: [embed],
            components: [row]
          });
        }

        saveRegistrationPanel(interaction.guildId, {
          channelId: channel.id,
          messageId: publishedMessage.id
        });

        await interaction.editReply(
          `✅ Painel de registro publicado ou atualizado em ${channel}.`
        );

        console.log(
          `[REGISTRO] Painel publicado no canal ${channel.id}.`
        );
      } catch (error) {
        console.error("[REGISTRO] Erro ao publicar painel:", error);

        await interaction.editReply(
          "Não foi possível publicar o painel. Confira se o bot tem permissão para visualizar o canal, enviar mensagens e incorporar links."
        ).catch(console.error);
      }

      return;
    }
    if (interaction.commandName === "publicar-regras") {
      try {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.guild) {
          await interaction.editReply({
            content: "Este comando só pode ser usado dentro de um servidor."
          });
          return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.editReply({
            content: "Você precisa da permissão Gerenciar servidor para publicar as regras."
          });
          return;
        }

        const selectedChannel = interaction.options.getChannel("canal", true);

        if (selectedChannel.type !== 0) {
          await interaction.editReply({
            content: "Selecione um canal de texto válido."
          });
          return;
        }

        const channel = await interaction.guild.channels.fetch(selectedChannel.id);

        if (!channel || channel.type !== 0) {
          await interaction.editReply({
            content: "Não foi possível acessar esse canal."
          });
          return;
        }

        const botMember = await interaction.guild.members.fetchMe();
        const permissions = channel.permissionsFor(botMember);

        if (
          !permissions?.has(PermissionFlagsBits.ViewChannel) ||
          !permissions?.has(PermissionFlagsBits.SendMessages) ||
          !permissions?.has(PermissionFlagsBits.EmbedLinks)
        ) {
          await interaction.editReply({
            content: "Preciso das permissões Ver canal, Enviar mensagens e Incorporar links no canal escolhido."
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setColor("#8B5CF6")
          .setAuthor({ name: "LUAR COMMUNITY" })
          .setTitle("🌙 Código de convivência do Luar")
          .setDescription(
            [
              "Seja bem-vindo ao Luar! Nosso servidor é um espaço para fazer amizades, conversar, jogar e compartilhar momentos.",
              "",
              "Para manter uma comunidade segura, acolhedora e organizada, todos os membros devem respeitar as regras abaixo.",
              "",
              "✨ **Ao permanecer no servidor, você concorda com este regulamento.**"
            ].join("\n")
          )
          .addFields(
            {
              name: "01 · Respeito e convivência",
              value: [
                "• Respeite todos os membros, independentemente de suas diferenças.",
                "• Não são permitidos racismo, homofobia, machismo, xenofobia ou discriminação.",
                "• Não pratique assédio, perseguição, ameaças ou intimidação.",
                "• Evite provocações e discussões ofensivas."
              ].join("\n")
            },
            {
              name: "02 · Comunicação",
              value: [
                "• Não faça spam, flood ou envio excessivo de mensagens.",
                "• Evite marcar membros e cargos repetidamente sem necessidade.",
                "• Não envie conteúdos perturbadores, explícitos ou inadequados.",
                "• Utilize os canais conforme suas respectivas finalidades."
              ].join("\n")
            },
            {
              name: "03 · Privacidade e segurança",
              value: [
                "• Não divulgue dados pessoais seus ou de terceiros sem autorização.",
                "• Não compartilhe conversas, imagens ou informações privadas sem consentimento.",
                "• Não envie links suspeitos, arquivos maliciosos ou tentativas de golpe.",
                "• Nunca solicite senhas ou códigos de acesso."
              ].join("\n")
            },
            {
              name: "04 · Canais de voz",
              value: [
                "• Respeite todos os participantes das conversas.",
                "• Não utilize sons ou microfones para atrapalhar os demais.",
                "• Evite gritos, ruídos excessivos e interrupções constantes.",
                "• Não grave conversas sem o consentimento dos participantes."
              ].join("\n")
            },
            {
              name: "05 · Divulgação e publicidade",
              value: [
                "• Não divulgue servidores, redes sociais, lojas ou serviços sem autorização da equipe.",
                "• Não envie publicidade em canais inadequados.",
                "• Não utilize mensagens privadas para fazer propaganda indesejada."
              ].join("\n")
            },
            {
              name: "06 · Conteúdo e comportamento",
              value: [
                "• Respeite as diretrizes do Discord e as leis aplicáveis.",
                "• Não compartilhe conteúdo ilegal ou que coloque pessoas em risco.",
                "• Não incentive comportamentos perigosos ou prejudiciais.",
                "• Respeite os limites e o conforto dos demais membros."
              ].join("\n")
            },
            {
              name: "07 · Organização e equipe",
              value: [
                "• Respeite as orientações da equipe de moderação.",
                "• Não abuse de comandos, bots ou permissões.",
                "• Não tente explorar falhas ou prejudicar o servidor.",
                "• Encaminhe problemas e denúncias à equipe responsável."
              ].join("\n")
            },
            {
              name: "08 · Penalidades",
              value: [
                "• Infrações podem resultar em advertência, silenciamento, expulsão ou banimento.",
                "• A reincidência poderá aumentar a penalidade.",
                "• Infrações graves podem resultar em banimento imediato.",
                "• A equipe avaliará cada situação considerando seu contexto e gravidade."
              ].join("\n")
            },
            {
              name: "🌙 Nosso compromisso",
              value: "O Luar é uma comunidade construída por pessoas. Queremos que todos possam se sentir seguros, respeitados e livres para aproveitar esse espaço.\n\n**Com carinho, equipe Luar.**"
            }
          )
          .setFooter({ text: "LUAR COMMUNITY • Respeito, amizade e boas conexões." })
          .setTimestamp();

        await channel.send({ embeds: [embed] });

        await interaction.editReply({
          content: `🌙 Regras do Luar publicadas com sucesso em ${channel}.`
        });

        console.log(`[REGRAS] Publicadas por ${interaction.user.tag} em #${channel.name}.`);
      } catch (error) {
        console.error("[PUBLICAR REGRAS] Erro:", error);

        const response = {
          content: "Não foi possível publicar as regras. Confira as permissões do bot no canal."
        };

        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(response).catch(console.error);
        } else {
          await interaction.reply({
            ...response,
            ephemeral: true
          }).catch(console.error);
        }
      }

      return;
    }
    if (interaction.commandName === "registro") {
      try {
        if (!interaction.guildId) {
          await interaction.reply({
            content: "O registro só pode ser usado dentro de um servidor.",
            ephemeral: true
          });
          return;
        }

        await interaction.reply({
          content:
            "## 🟣 Registro do servidor\n" +
            "Escolha suas opções abaixo.\n\n" +
            "• **Faixa etária:** escolha uma opção.\n" +
            "• **Gênero e sexualidade:** são opcionais e privados.\n" +
            "• **Cor:** escolha a cor do seu nickname.\n\n" +
            "Suas escolhas de gênero e sexualidade não serão exibidas publicamente.",
          components: createRegistrationRows(),
          ephemeral: true
        });
      } catch (error) {
        console.error("[REGISTRO] Erro ao abrir painel:", error);

        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "Não foi possível abrir o painel de registro.",
            ephemeral: true
          }).catch(console.error);
        } else {
          await interaction.reply({
            content: "Não foi possível abrir o painel de registro.",
            ephemeral: true
          }).catch(console.error);
        }
      }

      return;
    }

    const mascotCommandNames = [
      "adotar",
      "resetar-mascote",
      "mascote",
      "alimentar",
      "brincar",
      "dormir",
      "mascotes"
    ];

    if (mascotCommandNames.includes(interaction.commandName)) {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "Os mascotes só podem ser utilizados dentro de um servidor.",
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply();

      try {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const command = interaction.commandName;


const getMascotImageName = (
  mascot: NonNullable<ReturnType<typeof getMascot>>
): string => {
  const normalizedName = mascot.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const images: Record<string, string> = {
    luninho: "luninho.png",
    estrelinha: "estrelinha.png",
    nebula: "nebula.png",
    astro: "astro.png",
    celeste: "celeste.png",
    eclipse: "eclipse.png"
  };

  const filename = images[normalizedName];

  if (!filename) {
    throw new Error(`Imagem não cadastrada para ${mascot.name}.`);
  }

  return filename;
};

const createMascotImage = (
  mascot: NonNullable<ReturnType<typeof getMascot>>
): AttachmentBuilder => {
  const filename = getMascotImageName(mascot);
  const imagePath = path.join(
    process.cwd(),
    "assets",
    "mascotes",
    filename
  );

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Imagem não encontrada: ${imagePath}`);
  }

  return new AttachmentBuilder(imagePath, {
    name: filename
  });
};
        const rarityColors: Record<string, number> = {
          "Comum": 0xA3A3A3,
          "Incomum": 0x22C55E,
          "Raro": 0x3B82F6,
          "Épico": 0xA855F7,
          "Lendário": 0xEAB308,
          "Secreto": 0xEC4899
        };

        const createMascotEmbed = (mascot: ReturnType<typeof getMascot>) => {
          if (!mascot) return null;

          const progress = mascot.experience % 100;
          const imageName = getMascotImageName(mascot);

          return new EmbedBuilder()
            .setColor(rarityColors[mascot.rarity] ?? 0x8B5CF6)
            .setAuthor({
              name: "LUAR COMMUNITY • MASCOTES LUNARES"
            })
            .setTitle(`${mascot.emoji} ${mascot.name}`)
            .setDescription(
              `**${mascot.species}**\n` +
              `Raridade: **${mascot.rarity}**\n` +
              `🔄 Chances de reset: **${mascot.resetsRemaining ?? 3}/3**`
            )
            .addFields(
              {
                name: "⭐ Nível",
                value: `**${mascot.level}** • ${progress}/100 XP`,
                inline: true
              },
              {
                name: "🍖 Fome",
                value: `${mascot.hunger}/100`,
                inline: true
              },
              {
                name: "⚡ Energia",
                value: `${mascot.energy}/100`,
                inline: true
              },
              {
                name: "💖 Felicidade",
                value: `${mascot.happiness}/100`,
                inline: true
              },
              {
                name: "⚔️ Ataque",
                value: `${mascot.attack}`,
                inline: true
              },
              {
                name: "🛡️ Defesa",
                value: `${mascot.defense}`,
                inline: true
              },
              {
                name: "💨 Velocidade",
                value: `${mascot.speed}`,
                inline: true
              }
            )
            .setFooter({
              text: "Santaninha.bot • Cuide bem do seu companheiro lunar"
            })
            .setImage(`attachment://${imageName}`)
            .setTimestamp();
        };

        if (command === "adotar") {
          const mascot = adoptMascot(guildId, userId);

          const embed = createMascotEmbed(mascot)!;

          embed.setTitle(`🌙 Uma nova amizade começou!`);
          embed.setDescription(
            `${mascot.emoji} **${mascot.name}** apareceu!\n\n` +
            `Você adotou um(a) **${mascot.species}** de raridade **${mascot.rarity}**.\n` +
            `Cuide bem do seu novo companheiro!`
          );

          await interaction.editReply({
            embeds: [embed],
            files: [createMascotImage(mascot)]
          });

          console.log(
            `[MASCOTES] ${interaction.user.tag} adotou ${mascot.name}.`
          );
          return;
        }

        if (command === "mascote") {
          const mascot = getMascot(guildId, userId);

          if (!mascot) {
            await interaction.editReply({
              content: "🌙 Você ainda não adotou um mascote. Use **/adotar** para começar!"
            });
            return;
          }

          await interaction.editReply({
            embeds: [createMascotEmbed(mascot)!],
            files: [createMascotImage(mascot)]
          });
          return;
        }

        if (command === "resetar-mascote") {
          const result = resetMascot(guildId, userId);
          const mascot = result.mascot;

          const embed = createMascotEmbed(mascot)!;

          embed
            .setTitle("🔄 Seu mascote foi renovado!")
            .setDescription(
              `${mascot.emoji} **${mascot.name}** apareceu!` +
              `\n\nSeu novo companheiro é um(a) **${mascot.species}**.` +
              `\nRaridade: **${mascot.rarity}**.` +
              `\n\n🎟️ Você ainda possui **${result.remaining}/3** chances de reset.`
            );

          await interaction.editReply({
            embeds: [embed],
            files: [createMascotImage(mascot)]
          });

          console.log(
            `[MASCOTES] ${interaction.user.tag} resetou o mascote. Restam ${result.remaining} chances.`
          );
          return;
        }
        if (command === "alimentar") {
          const mascot = feedMascot(guildId, userId);

          const embed = createMascotEmbed(mascot)!;
          embed.setTitle(`🍖 ${mascot.name} foi alimentado!`);
          embed.setDescription(
            `Seu companheiro recuperou um pouco de fome e ganhou **5 XP**.`
          );

          await interaction.editReply({
            embeds: [embed],
            files: [createMascotImage(mascot)]
          });
          return;
        }

        if (command === "brincar") {
          const mascot = playWithMascot(guildId, userId);

          const embed = createMascotEmbed(mascot)!;
          embed.setTitle(`🎾 Hora da diversão!`);
          embed.setDescription(
            `${mascot.name} se divertiu muito e ganhou **10 XP**!`
          );

          await interaction.editReply({
            embeds: [embed],
            files: [createMascotImage(mascot)]
          });
          return;
        }

        if (command === "dormir") {
          const mascot = sleepMascot(guildId, userId);

          const embed = createMascotEmbed(mascot)!;
          embed.setTitle(`🌙 ${mascot.name} descansou!`);
          embed.setDescription(
            "Seu mascote recuperou toda a energia."
          );

          await interaction.editReply({
            embeds: [embed],
            files: [createMascotImage(mascot)]
          });
          return;
        }

        if (command === "mascotes") {
          const mascots = getMascots(guildId)
            .sort((a, b) => b.level - a.level);

          if (mascots.length === 0) {
            await interaction.editReply({
              content: "🌙 Ainda não existem mascotes neste servidor. Seja o primeiro a usar **/adotar**!"
            });
            return;
          }

          const description = mascots
            .slice(0, 15)
            .map((mascot, index) =>
              `**${index + 1}.** ${mascot.emoji} **${mascot.name}**` +
              ` • ${mascot.rarity} • Nível ${mascot.level}` +
              `\nDono: <@${mascot.userId}>`
            )
            .join("\n\n");

          const embed = new EmbedBuilder()
            .setColor(0x8B5CF6)
            .setTitle("🌙 Coleção de Mascotes do Luar")
            .setDescription(description)
            .setFooter({
              text: `${mascots.length} mascote(s) adotado(s) neste servidor`
            })
            .setTimestamp();

          await interaction.editReply({
            embeds: [embed]
          });
          return;
        }
      } catch (error) {
        console.error("[MASCOTES] Erro:", error);

        const message = error instanceof Error
          ? error.message
          : "Ocorreu um erro ao executar essa ação.";

        await interaction.editReply({
          content: `🌙 ${message}`
        }).catch(console.error);
      }

      return;
    }

    return;
  }

  // BOTÃO DO PAINEL PÚBLICO: ABRE O REGISTRO PRIVADO

  if (interaction.isButton() && interaction.customId === "registro:open") {
    try {
      await interaction.deferReply({ ephemeral: true });

      await interaction.editReply({
        content:
          "## 🟣 Seu registro\n" +
          "Selecione suas opções abaixo. Gênero e sexualidade são opcionais e privados.",
        components: createRegistrationRows()
      });
    } catch (error) {
      console.error("[REGISTRO] Erro ao abrir painel privado:", error);
    }

    return;
  }
  // SELETORES DO REGISTRO

  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.customId.startsWith("registro:")) return;

  try {
    const guild = interaction.guild;
    const guildId = interaction.guildId;

    if (!guild || !guildId) {
      await interaction.reply({
        content: "Este registro só funciona dentro de um servidor.",
        ephemeral: true
      });
      return;
    }

    const field = interaction.customId.split(":")[1] as RegistrationField;
    const selected = interaction.values[0];

    if (!selected) {
      await interaction.reply({
        content: "Nenhuma opção foi selecionada.",
        ephemeral: true
      });
      return;
    }

    let confirmation = "Sua escolha foi salva.";

    if (field === "age") {
      const roleName = selected === "under18"
        ? "Menor de 18"
        : selected === "18plus"
          ? "18 ou mais"
          : null;

      if (!roleName) {
        throw new Error("Faixa etária inválida.");
      }

      await assignExclusiveRole(
        guild,
        interaction.user.id,
        roleName,
        ageRoles
      );

      saveRegistrationChoice(
        guildId,
        interaction.user.id,
        "age",
        roleName
      );

      confirmation = `Faixa etária registrada: **${roleName}**.`;
    }

    if (field === "color") {
      const roleName = colorRoles[selected];

      if (!roleName) {
        throw new Error("Cor inválida.");
      }

      await assignExclusiveRole(
        guild,
        interaction.user.id,
        roleName,
        colorRoleNames
      );

      saveRegistrationChoice(
        guildId,
        interaction.user.id,
        "color",
        roleName
      );

      confirmation = `Cor do nickname atualizada para **${roleName.replace("Cor | ", "")}**.`;
    }

    if (field === "gender") {
      if (!(selected in genderOptions)) {
        throw new Error("Opção de gênero inválida.");
      }

      const value = genderOptions[selected];

      saveRegistrationChoice(
        guildId,
        interaction.user.id,
        "gender",
        value
      );

      confirmation = value
        ? "Sua escolha de gênero foi salva privadamente."
        : "Você optou por não informar seu gênero.";
    }

    if (field === "sexuality") {
      if (!(selected in sexualityOptions)) {
        throw new Error("Opção de sexualidade inválida.");
      }

      const value = sexualityOptions[selected];

      saveRegistrationChoice(
        guildId,
        interaction.user.id,
        "sexuality",
        value
      );

      confirmation = value
        ? "Sua escolha de sexualidade foi salva privadamente."
        : "Você optou por não informar sua sexualidade.";
    }

    await interaction.reply({
      content: `✅ ${confirmation}`,
      ephemeral: true
    });
  } catch (error) {
    console.error("[REGISTRO] Erro ao processar escolha:", error);

    const message =
      "Não foi possível salvar sua escolha. Verifique se o bot tem permissão para gerenciar cargos e se o cargo dele está acima dos cargos do registro.";

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: message,
        ephemeral: true
      }).catch(console.error);
    } else {
      await interaction.reply({
        content: message,
        ephemeral: true
      }).catch(console.error);
    }
  }
});

// BOAS-VINDAS E CARGO AUTOMÁTICO DE MEMBRO

client.on(Events.GuildMemberAdd, async member => {
  const MEMBER_ROLE_ID = "1571952252749480128";

  // Atribuição automática do cargo para membros humanos
  if (!member.user.bot) {
    try {
      const memberRole = await member.guild.roles.fetch(MEMBER_ROLE_ID);

      if (!memberRole) {
        console.error("[MEMBER ROLE] Cargo Membro não encontrado.");
      } else {
        await member.roles.add(
          memberRole,
          "Atribuição automática ao entrar no servidor"
        );

        console.log(
          `[MEMBER ROLE] Cargo Membro atribuído a ${member.user.tag}.`
        );
      }
    } catch (error) {
      console.error(
        `[MEMBER ROLE] Erro ao atribuir cargo a ${member.user.tag}:`,
        error
      );
    }
  }

  // Registro de boas-vindas
  const embed = new EmbedBuilder()
    .setColor("#A78BFA")
    .setTitle("👋 Seja bem-vindo!")
    .setDescription(
      `Olá ${member}, seja bem-vindo(a) ao **${member.guild.name}**!`
    )
    .setThumbnail(member.user.displayAvatarURL())
    .addFields({
      name: "Membro número",
      value: `${member.guild.memberCount}`,
      inline: true
    })
    .setTimestamp();

  await sendLog(member.guild.id, "welcome", embed);
});

// DESPEDIDAS

client.on(Events.GuildMemberRemove, async member => {
  const embed = new EmbedBuilder()
    .setColor("#EF4444")
    .setTitle("👋 Membro saiu")
    .setDescription(
      `**${member.user.tag}** saiu do servidor **${member.guild.name}**.`
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  await sendLog(member.guild.id, "goodbye", embed);
});

// MONITORAMENTO DE VOZ

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guildId = newState.guild.id;
  const member = newState.member ?? oldState.member;

  if (!member || member.user.bot) return;

  const user = member.user;
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;

  const makeEmbed = (
    title: string,
    description: string,
    color: number
  ) =>
    new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .setThumbnail(user.displayAvatarURL())
      .setTimestamp();

  if (!oldChannel && newChannel) {
    await sendLog(
      guildId,
      "voiceJoin",
      makeEmbed(
        "🔊 Entrada em call",
        `**${user.tag}** entrou em ${newChannel}.`,
        0x22C55E
      )
    );
  }

  if (oldChannel && !newChannel) {
    await sendLog(
      guildId,
      "voiceLeave",
      makeEmbed(
        "🔇 Saída da call",
        `**${user.tag}** saiu de ${oldChannel}.`,
        0xEF4444
      )
    );
  }

  if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
    await sendLog(
      guildId,
      "voiceMove",
      makeEmbed(
        "🔄 Mudança de call",
        `**${user.tag}** mudou de ${oldChannel} para ${newChannel}.`,
        0xA78BFA
      )
    );
  }

  if (
    oldState.selfMute !== newState.selfMute ||
    oldState.serverMute !== newState.serverMute
  ) {
    const muted = newState.selfMute || newState.serverMute;

    await sendLog(
      guildId,
      "voiceMute",
      makeEmbed(
        muted ? "🎙️ Microfone mutado" : "🎙️ Microfone ativado",
        `**${user.tag}** ${muted ? "mutou" : "desmutou"} o microfone.`,
        muted ? 0xF59E0B : 0x22C55E
      )
    );
  }

  if (
    oldState.selfDeaf !== newState.selfDeaf ||
    oldState.serverDeaf !== newState.serverDeaf
  ) {
    const deafened = newState.selfDeaf || newState.serverDeaf;

    await sendLog(
      guildId,
      "voiceDeaf",
      makeEmbed(
        deafened ? "🔇 Áudio desativado" : "🔊 Áudio ativado",
        `**${user.tag}** ${deafened ? "desativou" : "reativou"} o áudio.`,
        0xA78BFA
      )
    );
  }

  if (oldState.streaming !== newState.streaming) {
    await sendLog(
      guildId,
      "voiceStream",
      makeEmbed(
        newState.streaming
          ? "📺 Iniciou transmissão"
          : "📺 Encerrou transmissão",
        `**${user.tag}** ${
          newState.streaming ? "começou" : "encerrou"
        } o compartilhamento.`,
        0xA78BFA
      )
    );
  }
});


// AUDITORIA DE MENSAGENS

function clipMessageText(value: string, limit = 1000): string {
  if (!value) return "Não disponível.";
  return value.length > limit
    ? value.slice(0, limit - 3) + "..."
    : value;
}

function describeMessage(message: import("discord.js").Message) {
  const content = message.content?.trim() || "Mensagem sem texto.";

  const media: string[] = [];

  for (const attachment of message.attachments.values()) {
    media.push(
      `Arquivo: ${attachment.name ?? "Sem nome"} | ` +
      `Tipo: ${attachment.contentType ?? "Desconhecido"} | ` +
      `URL: ${attachment.url}`
    );
  }

  for (const sticker of message.stickers.values()) {
    media.push(`Sticker: ${sticker.name}`);
  }

  for (const embed of message.embeds) {
    media.push(
      `Embed: ${embed.title ?? "Sem título"}`
    );
  }

  if (message.components.length > 0) {
    media.push(`Componentes interativos: ${message.components.length}`);
  }

  return {
    content: clipMessageText(content, 1000),
    media: clipMessageText(media.join("\n") || "Nenhum anexo ou mídia.", 1000)
  };
}

// MENSAGENS ENVIADAS
client.on(Events.MessageCreate, async message => {
  try {
    if (!message.guildId) return;
    if (message.author.id === client.user?.id) return;
    
    // INSPEÇÃO AUTOMÁTICA DE MODERAÇÃO
    if (message.member && !message.author.bot) {
      const moderationConfig = getModerationConfig(message.guildId);

      const member = message.member;

      const isExemptByRole = member.roles.cache.some(role =>
        moderationConfig.exemptRoleIds.includes(role.id)
      );

      const isModerator =
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.permissions.has(PermissionFlagsBits.ManageMessages) ||
        member.permissions.has(PermissionFlagsBits.ManageGuild);

      if (
        moderationConfig.enabled &&
        !isExemptByRole &&
        !isModerator
      ) {
        const result = inspectMessage(
          message.guildId,
          message.author.id,
          message.content,
          moderationConfig
        );

        if (result.triggered) {
          let actions = "Nenhuma ação aplicada.";

          if (message.deletable) {
            try {
              await message.delete();
              actions = "Mensagem excluída.";
            } catch (error) {
              console.error("[AUTOMOD] Erro ao excluir mensagem:", error);
              actions = "Não foi possível excluir a mensagem.";
            }
          }

          if (member.moderatable) {
            try {
              const timeoutMinutes = Math.min(
                40320,
                Math.max(1, moderationConfig.timeoutMinutes)
              );

              await member.timeout(
                timeoutMinutes * 60_000,
                `Santaninha AutoMod: ${result.reason ?? "Infração automática"}`
              );

              actions += ` Timeout de ${timeoutMinutes} minuto(s) aplicado.`;
            } catch (error) {
              console.error("[AUTOMOD] Erro ao aplicar timeout:", error);
              actions += " Timeout não aplicado.";
            }
          } else {
            actions += " Membro não moderável pelo bot.";
          }

          const moderationEmbed = new EmbedBuilder()
            .setColor("#EF4444")
            .setTitle("🛡️ Moderação automática")
            .setDescription("Uma infração foi identificada pelo Santaninha.")
            .addFields(
              {
                name: "Membro",
                value: `${message.author.tag} (\`${message.author.id}\`)`
              },
              {
                name: "Canal",
                value: `<#${message.channelId}>`,
                inline: true
              },
              {
                name: "Regra",
                value: result.rule === "flood"
                  ? "Anti-flood"
                  : "Mensagens repetidas",
                inline: true
              },
              {
                name: "Motivo",
                value: result.reason ?? "Infração identificada."
              },
              {
                name: "Ações",
                value: actions
              }
            )
            .setTimestamp();

          await sendLog(
            message.guildId,
            "moderation",
            moderationEmbed
          );

          console.log(
            `[AUTOMOD] ${message.author.tag}: ${result.reason}`
          );

          return;
        }
      }
    }

    if (await handleMusicCommand(message)) return;

    const details = describeMessage(message);

    const embed = new EmbedBuilder()
      .setColor("#3B82F6")
      .setTitle("💬 Nova mensagem")
      .setDescription(`Canal: <#${message.channelId}>`)
      .addFields(
        {
          name: "Autor",
          value: `${message.author.tag} (\`${message.author.id}\`)`
        },
        {
          name: "Conteúdo",
          value: details.content
        },
        {
          name: "Mídias e anexos",
          value: details.media
        },
        {
          name: "Identificação",
          value: `Mensagem: \`${message.id}\``
        }
      )
      .setTimestamp();

    embed.setThumbnail(message.author.displayAvatarURL());

    await sendLog(message.guildId, "messages", embed);
  } catch (error) {
    console.error("[MESSAGE CREATE] Erro:", error);
  }
});

// MENSAGENS EDITADAS
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  try {
    const before = oldMessage.partial
      ? await oldMessage.fetch().catch(() => null)
      : oldMessage;

    const after = newMessage.partial
      ? await newMessage.fetch().catch(() => null)
      : newMessage;

    const guildId = after?.guildId ?? oldMessage.guildId;

    if (!guildId) return;
    if (after?.author?.id === client.user?.id) return;

    const oldDetails = before
      ? describeMessage(before)
      : { content: "Conteúdo anterior indisponível.", media: "Indisponível." };

    const newDetails = after
      ? describeMessage(after)
      : { content: "Novo conteúdo indisponível.", media: "Indisponível." };

    const embed = new EmbedBuilder()
      .setColor("#EAB308")
      .setTitle("✏️ Mensagem editada")
      .setDescription(`Canal: <#${newMessage.channelId}>`)
      .addFields(
        {
          name: "Autor",
          value: after?.author
            ? `${after.author.tag} (\`${after.author.id}\`)`
            : "Autor indisponível."
        },
        {
          name: "Conteúdo anterior",
          value: oldDetails.content
        },
        {
          name: "Conteúdo atualizado",
          value: newDetails.content
        },
        {
          name: "Mídias atuais",
          value: newDetails.media
        },
        {
          name: "Identificação",
          value: `Mensagem: \`${newMessage.id}\``
        }
      )
      .setTimestamp();

    await sendLog(guildId, "messageUpdate", embed);
  } catch (error) {
    console.error("[MESSAGE UPDATE] Erro:", error);
  }
});

// MENSAGENS EXCLUÍDAS
client.on(Events.MessageDelete, async message => {
  try {
    const fullMessage = message.partial
      ? await message.fetch().catch(() => null)
      : message;

    const guildId = fullMessage?.guildId ?? message.guildId;

    if (!guildId) return;
    if (fullMessage?.author?.id === client.user?.id) return;

    const details = fullMessage
      ? describeMessage(fullMessage)
      : {
          content: "Conteúdo indisponível: mensagem não estava em cache.",
          media: "Anexos indisponíveis."
        };

    const embed = new EmbedBuilder()
      .setColor("#EF4444")
      .setTitle("🗑️ Mensagem excluída")
      .setDescription(`Canal: <#${message.channelId}>`)
      .addFields(
        {
          name: "Autor",
          value: fullMessage?.author
            ? `${fullMessage.author.tag} (\`${fullMessage.author.id}\`)`
            : "Autor não identificado."
        },
        {
          name: "Conteúdo",
          value: details.content
        },
        {
          name: "Mídias e anexos",
          value: details.media
        },
        {
          name: "Identificação",
          value: `Mensagem: \`${message.id}\``
        }
      )
      .setTimestamp();

    await sendLog(guildId, "messageDelete", embed);
  } catch (error) {
    console.error("[MESSAGE DELETE] Erro:", error);
  }
});

// CONEXÃO COM O DISCORD


// SERVIDOR HTTP PARA O RENDER
const healthPort = Number(process.env.PORT || 10000);

const healthServer = createServer((request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405);
    response.end();
    return;
  }

  if (request.url !== "/" && request.url !== "/health") {
    response.writeHead(404);
    response.end();
    return;
  }

  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8"
  });

  response.end(JSON.stringify({
    status: "ok",
    service: "santaninha-bot",
    discordReady: client.isReady()
  }));
});

healthServer.listen(healthPort, "0.0.0.0", () => {
  console.log(`[HTTP] Servidor ativo na porta ${healthPort}.`);
});

client.login(token).catch(error => {
  console.error("[LOGIN] Erro ao conectar o bot:", error);
});






