import {
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  type TextBasedChannel
} from "discord.js";
import { type AppConfig, resolveQuality } from "../config.js";
import { RadarrClient, type RadarrSearchResult } from "../arr/radarr.js";
import { SonarrClient, type SonarrSearchResult, type SonarrSearchScope } from "../arr/sonarr.js";
import { parseMovieRequest, parseShowRequest } from "../parsing/requests.js";

type BotServices = {
  config: AppConfig;
  radarr: RadarrClient;
  sonarr: SonarrClient;
};

export function createDiscordClient(services: BotServices): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleMessage(message, services);
    } catch (error) {
      console.error("Failed to handle message", error);
      if (!message.author.bot) {
        await safeReply(message, "Something went wrong while processing that request.");
      }
    }
  });

  return client;
}

async function handleMessage(message: Message, services: BotServices): Promise<void> {
  if (message.author.bot || !message.guildId) return;
  if (message.guildId !== services.config.discord.guildId) return;

  if (message.channelId === services.config.discord.moviesChannelId) {
    await handleMovieRequest(message, services);
    return;
  }

  if (message.channelId === services.config.discord.showsChannelId) {
    await handleShowRequest(message, services);
  }
}

async function handleMovieRequest(message: Message, services: BotServices): Promise<void> {
  const parsed = parseMovieRequest(message.content);
  if (!parsed.ok) {
    await safeReply(message, parsed.error);
    return;
  }

  const quality = resolveQuality(
    parsed.value.qualityToken,
    services.config.radarr.qualityMap,
    services.config.radarr.defaultQuality
  );
  const status = await message.reply(`Searching for ${parsed.value.title}...`);
  const result = await services.radarr.addAndSearch(parsed.value.title, parsed.value.year, quality);

  await status.edit(formatRadarrResult(result));
}

async function handleShowRequest(message: Message, services: BotServices): Promise<void> {
  const parsed = parseShowRequest(message.content);
  if (!parsed.ok) {
    await safeReply(message, parsed.error);
    return;
  }

  const quality = resolveQuality(
    parsed.value.qualityToken,
    services.config.sonarr.qualityMap,
    services.config.sonarr.defaultQuality
  );
  const status = await message.reply(`Searching for ${parsed.value.title}...`);
  const searchScope: SonarrSearchScope =
    parsed.value.scope === "full"
      ? { scope: "full", monitorWholeShow: true }
      : {
          scope: "season",
          seasonNumber: parsed.value.seasonNumber || 1,
          monitorWholeShow: parsed.value.monitorWholeShow
        };
  const result = await services.sonarr.addAndSearch(
    parsed.value.title,
    parsed.value.year,
    quality,
    searchScope
  );

  await status.edit(formatSonarrResult(result));
}

function formatRadarrResult(result: RadarrSearchResult): string {
  if (result.status === "already_exists") {
    return `${result.title} is already on the server!`;
  }

  if (result.status === "found") {
    return `${result.title} found!`;
  }

  return `Unable to find ${result.title} download`;
}

function formatSonarrResult(result: SonarrSearchResult): string {
  if (result.status === "already_exists") {
    return `${result.title} is already on the server!`;
  }

  const title = result.seasonNumber
    ? `${result.title} - Season ${result.seasonNumber}`
    : result.title;

  if (result.status === "found") {
    return `${title} found!`;
  }

  return `Unable to find ${title} download`;
}

async function safeReply(message: Message, content: string): Promise<void> {
  const channel = message.channel as TextBasedChannel;
  if (!channel.isSendable()) return;
  await message.reply(content);
}
