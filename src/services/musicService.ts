import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import path from "node:path";
import {
  PermissionFlagsBits,
  type Message,
  type TextChannel
} from "discord.js";
import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type VoiceConnection
} from "@discordjs/voice";
import ffmpegPath from "ffmpeg-static";

interface Track {
  title: string;
  url: string;
  duration: number;
  requestedBy: string;
  thumbnail?: string;
}

interface YtEntry {
  id?: string;
  title?: string;
  webpage_url?: string;
  original_url?: string;
  url?: string;
  duration?: number;
  thumbnail?: string;
}

interface YtResult extends YtEntry {
  entries?: YtEntry[];
}

interface MusicQueue {
  guildId: string;
  voiceChannelId: string;
  textChannel: TextChannel;
  connection: VoiceConnection;
  player: ReturnType<typeof createAudioPlayer>;
  tracks: Track[];
  current: Track | null;
  volume: number;
  processes: {
    yt: ChildProcessByStdio<null, Readable, Readable>;
    ffmpeg: ChildProcessByStdio<Writable, Readable, Readable>;
  } | null;
  closed: boolean;
}

const queues = new Map<string, MusicQueue>();

const YTDLP_PATH = path.resolve(
  process.cwd(),
  "node_modules",
  "youtube-dl-exec",
  "bin",
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"
);

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Ao vivo";

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function runYtDlp(args: string[]): Promise<YtResult> {
  return new Promise((resolve, reject) => {
    const process = spawn(YTDLP_PATH, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");

    process.stdout.on("data", chunk => {
      stdout += chunk;

      if (stdout.length > 10_000_000) {
        process.kill();
        reject(new Error("A resposta do YouTube excedeu o limite."));
      }
    });

    process.stderr.on("data", chunk => {
      stderr += chunk;
    });

    process.once("error", reject);

    process.once("close", code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp encerrou com código ${code}.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as YtResult);
      } catch {
        reject(new Error("Não foi possível interpretar os dados retornados pelo YouTube."));
      }
    });
  });
}

async function findTrack(query: string, requestedBy: string): Promise<Track> {
  const isUrl = /^https?:\/\//i.test(query);

  const target = isUrl ? query : `ytsearch1:${query}`;

  const result = await runYtDlp([
    "--dump-single-json",
    "--flat-playlist",
    "--skip-download",
    "--no-warnings",
    "--no-playlist",
    target
  ]);

  const entry = result.entries?.[0] ?? result;

  const url =
    entry.webpage_url ??
    entry.original_url ??
    (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : undefined) ??
    (isUrl ? query : undefined);

  if (!url || !entry.title) {
    throw new Error("Não encontrei uma música válida para essa pesquisa.");
  }

  return {
    title: entry.title,
    url,
    duration: Number(entry.duration ?? 0),
    requestedBy,
    thumbnail: entry.thumbnail
  };
}

async function reply(message: Message, content: string): Promise<void> {
  await message.reply({ content }).catch(error => {
    console.error("[MUSIC] Não foi possível enviar mensagem:", error);
  });
}

function stopProcesses(queue: MusicQueue): void {
  if (!queue.processes) return;

  const { yt, ffmpeg } = queue.processes;
  queue.processes = null;

  try {
    yt.stdout.unpipe(ffmpeg.stdin);
    yt.kill();
    ffmpeg.kill();
  } catch {
    // Os processos podem já ter encerrado.
  }
}

async function playNext(queue: MusicQueue): Promise<void> {
  if (queue.closed) return;

  const track = queue.tracks.shift();

  if (!track) {
    queue.current = null;
    await queue.textChannel.send("A fila terminou. Estou aguardando a próxima música.").catch(() => {});
    return;
  }

  if (!ffmpegPath) {
    await queue.textChannel.send("FFmpeg não está disponível neste sistema.").catch(() => {});
    return;
  }

  queue.current = track;

  try {
    const yt = spawn(YTDLP_PATH, [
      "--no-warnings",
      "--no-playlist",
      "--no-progress",
      "--quiet",
      "--format",
      "bestaudio",
      "--output",
      "-",
      track.url
    ], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const ffmpeg = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-vn",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "pipe:1"
    ], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    queue.processes = { yt, ffmpeg };

    yt.stdout.pipe(ffmpeg.stdin);

    yt.once("error", error => {
      console.error("[MUSIC] Erro no yt-dlp:", error);
      stopProcesses(queue);
      queue.player.stop(true);
    });

    ffmpeg.once("error", error => {
      console.error("[MUSIC] Erro no FFmpeg:", error);
      stopProcesses(queue);
      queue.player.stop(true);
    });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true
    });

    resource.volume?.setVolume(queue.volume / 100);

    queue.player.play(resource);

    await queue.textChannel.send(
      `🎶 **Tocando agora:** [${track.title}](${track.url})\n` +
      `⏱️ Duração: ${formatDuration(track.duration)}\n` +
      `👤 Pedido por: ${track.requestedBy}`
    ).catch(() => {});
  } catch (error) {
    console.error("[MUSIC] Erro ao iniciar reprodução:", error);
    stopProcesses(queue);
    queue.current = null;
    await queue.textChannel.send("Não consegui iniciar essa música. Vou tentar a próxima.").catch(() => {});
    await playNext(queue);
  }
}

function createQueue(
  message: Message,
  voiceChannelId: string
): MusicQueue {
  const guild = message.guild!;

  const connection = joinVoiceChannel({
    channelId: voiceChannelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true
  });

  const player = createAudioPlayer();

  connection.subscribe(player);

  const queue: MusicQueue = {
    guildId: guild.id,
    voiceChannelId,
    textChannel: message.channel as TextChannel,
    connection,
    player,
    tracks: [],
    current: null,
    volume: 50,
    processes: null,
    closed: false
  };

  player.on(AudioPlayerStatus.Idle, () => {
    stopProcesses(queue);
    queue.current = null;

    if (!queue.closed) {
      void playNext(queue);
    }
  });

  player.on("error", error => {
    console.error("[MUSIC] Erro no player:", error);
    stopProcesses(queue);
    queue.player.stop(true);
  });

  connection.on("error", error => {
    console.error("[MUSIC] Erro na conexão de voz:", error);
  });

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    if (!queue.closed) {
      queue.closed = true;
      stopProcesses(queue);
      queue.player.stop(true);
      connection.destroy();
      queues.delete(queue.guildId);
    }
  });

  queues.set(guild.id, queue);

  return queue;
}

async function getQueue(
  message: Message
): Promise<MusicQueue | null> {
  const guild = message.guild;
  const member = message.member;
  const voiceChannel = member?.voice.channel;

  if (!guild || !voiceChannel) {
    await reply(message, "Você precisa entrar em um canal de voz primeiro.");
    return null;
  }

  const me = guild.members.me ?? await guild.members.fetchMe();

  const permissions = voiceChannel.permissionsFor(me);

  if (
    !permissions?.has(PermissionFlagsBits.Connect) ||
    !permissions.has(PermissionFlagsBits.Speak)
  ) {
    await reply(message, "Não tenho permissão para entrar e falar nesse canal.");
    return null;
  }

  let queue = queues.get(guild.id);

  if (queue && queue.voiceChannelId !== voiceChannel.id) {
    await reply(message, "Já estou tocando música em outro canal de voz deste servidor.");
    return null;
  }

  if (!queue) {
    queue = createQueue(message, voiceChannel.id);

    try {
      await entersState(queue.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      queue.closed = true;
      queue.connection.destroy();
      queues.delete(guild.id);
      await reply(message, "Não consegui conectar ao canal de voz.");
      return null;
    }
  }

  return queue;
}

export async function handleMusicCommand(message: Message): Promise<boolean> {
  if (!message.guild || message.author.bot) return false;

  const content = message.content.trim();
  const [command, ...args] = content.split(/\s+/);
  const cmd = command.toLowerCase();

  const commands = [
    "!mplay",
    "!mpause",
    "!mresume",
    "!mskip",
    "!mstop",
    "!mfila",
    "!mtocando",
    "!mvolume",
    "!mremove",
    "!mlimpar",
    "!mhelp"
  ];

  if (!commands.includes(cmd)) return false;

  const guildId = message.guild.id;
  let queue: MusicQueue | null | undefined = queues.get(guildId);

  if (cmd === "!mhelp") {
    await reply(message,
      "**🎵 Santaninha Music**\n" +
      "`!mplay <nome ou link>` Adiciona uma música\n" +
      "`!mpause` Pausa a reprodução\n" +
      "`!mresume` Retoma a reprodução\n" +
      "`!mskip` Pula a música atual\n" +
      "`!mstop` Para e desconecta\n" +
      "`!mfila` Mostra a fila\n" +
      "`!mtocando` Mostra a música atual\n" +
      "`!mvolume <0-100>` Altera o volume\n" +
      "`!mremove <posição>` Remove uma música da fila\n" +
      "`!mlimpar` Limpa as próximas músicas"
    );
    return true;
  }

  if (cmd === "!mplay") {
    const query = args.join(" ");

    if (!query) {
      await reply(message, "Use `!mplay nome da música` ou `!mplay link do YouTube`.");
      return true;
    }

    const voiceChannel = message.member?.voice.channel;

    if (!voiceChannel) {
      await reply(message, "Entre em um canal de voz antes de pedir uma música.");
      return true;
    }

    try {
      await reply(message, "🔎 Procurando sua música...");

      const track = await findTrack(query, message.author.username);

      queue = await getQueue(message);

      if (!queue) return true;

      const alreadyPlaying = Boolean(queue.current);

      queue.tracks.push(track);

      if (!alreadyPlaying && queue.player.state.status === AudioPlayerStatus.Idle) {
        await playNext(queue);
      } else {
        await reply(message, `➕ **${track.title}** foi adicionada à fila. Posição: ${queue.tracks.length}.`);
      }
    } catch (error) {
      console.error("[MUSIC] Erro na pesquisa:", error);
      await reply(message, "Não consegui encontrar essa música. Verifique o nome ou o link.");
    }

    return true;
  }

  if (cmd === "!mstop") {
    if (!queue) {
      await reply(message, "Não há música tocando neste servidor.");
      return true;
    }

    queue.closed = true;
    queue.tracks = [];
    stopProcesses(queue);
    queue.player.stop(true);
    queue.connection.destroy();
    queues.delete(guildId);

    await reply(message, "⏹️ Reprodução encerrada e desconectada.");
    return true;
  }

  if (!queue) {
    await reply(message, "Não existe uma fila de música neste servidor.");
    return true;
  }

  if (cmd === "!mpause") {
    if (queue.player.pause()) {
      await reply(message, "⏸️ Música pausada.");
    } else {
      await reply(message, "Não há música tocando para pausar.");
    }
    return true;
  }

  if (cmd === "!mresume") {
    if (queue.player.unpause()) {
      await reply(message, "▶️ Reprodução retomada.");
    } else {
      await reply(message, "Não há música pausada.");
    }
    return true;
  }

  if (cmd === "!mskip") {
    if (!queue.current) {
      await reply(message, "Não há música tocando.");
    } else {
      await reply(message, "⏭️ Pulando música...");
      queue.player.stop(true);
    }
    return true;
  }

  if (cmd === "!mfila") {
    if (!queue.current && queue.tracks.length === 0) {
      await reply(message, "A fila está vazia.");
      return true;
    }

    const current = queue.current
      ? `🎶 **Tocando:** ${queue.current.title}\n`
      : "";

    const upcoming = queue.tracks.slice(0, 15)
      .map((track, index) =>
        `**${index + 1}.** ${track.title} (${formatDuration(track.duration)})`
      )
      .join("\n");

    await reply(message,
      `**📃 Fila de músicas**\n${current}` +
      `${upcoming || "Nenhuma próxima música."}\n\n` +
      `Total aguardando: ${queue.tracks.length}`
    );
    return true;
  }

  if (cmd === "!mtocando") {
    if (!queue.current) {
      await reply(message, "Não há música tocando agora.");
    } else {
      await reply(message,
        `🎶 **Tocando:** [${queue.current.title}](${queue.current.url})\n` +
        `⏱️ Duração: ${formatDuration(queue.current.duration)}`
      );
    }
    return true;
  }

  if (cmd === "!mvolume") {
    const volume = Number(args[0]);

    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      await reply(message, "Informe um volume entre 0 e 100. Exemplo: `!mvolume 70`.");
      return true;
    }

    queue.volume = volume;

    const resource = queue.player.state.status === AudioPlayerStatus.Playing
      ? queue.player.state.resource
      : null;

    resource?.volume?.setVolume(volume / 100);

    await reply(message, `🔊 Volume ajustado para **${volume}%**.`);
    return true;
  }

  if (cmd === "!mremove") {
    const position = Number(args[0]);

    if (!Number.isInteger(position) || position < 1 || position > queue.tracks.length) {
      await reply(message, "Informe uma posição válida da fila. Exemplo: `!mremove 2`.");
      return true;
    }

    const [removed] = queue.tracks.splice(position - 1, 1);
    await reply(message, `🗑️ Removida da fila: **${removed.title}**.`);
    return true;
  }

  if (cmd === "!mlimpar") {
    const amount = queue.tracks.length;
    queue.tracks = [];
    await reply(message, `🧹 Fila limpa. ${amount} música(s) removida(s).`);
    return true;
  }

  return true;
}
