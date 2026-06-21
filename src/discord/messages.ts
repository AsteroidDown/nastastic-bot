import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type TextBasedChannel,
  type User
} from "discord.js";
import { type AppConfig, resolveQuality } from "../config.js";
import { RadarrClient, type RadarrMovieLookup, type RadarrSearchResult } from "../arr/radarr.js";
import {
  SonarrClient,
  type SonarrSearchResult,
  type SonarrSearchScope,
  type SonarrSeriesLookup
} from "../arr/sonarr.js";
import { parseMovieRequest, parseShowRequest } from "../parsing/requests.js";

type BotServices = {
  config: AppConfig;
  radarr: RadarrClient;
  sonarr: SonarrClient;
};

type PendingSelection =
  | {
      kind: "movie";
      requesterId: string;
      matches: RadarrMovieLookup[];
      quality: string;
      timeout: NodeJS.Timeout;
    }
  | {
      kind: "show";
      requesterId: string;
      matches: SonarrSeriesLookup[];
      quality: string;
      searchScope: SonarrSearchScope;
      timeout: NodeJS.Timeout;
    };

const NUMBER_REACTIONS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const MAX_SELECTIONS = NUMBER_REACTIONS.length;
const SELECTION_TTL_MS = 15 * 60 * 1000;

export function createDiscordClient(services: BotServices): Client {
  const pendingSelections = new Map<string, PendingSelection>();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User]
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleMessage(message, services, pendingSelections);
    } catch (error) {
      console.error("Failed to handle message", error);
      if (!message.author.bot) {
        await safeReply(message, "Something went wrong while processing that request.");
      }
    }
  });

  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      await handleSelectionReaction(reaction, user, services, pendingSelections);
    } catch (error) {
      console.error("Failed to handle selection reaction", error);
    }
  });

  return client;
}

async function handleMessage(
  message: Message,
  services: BotServices,
  pendingSelections: Map<string, PendingSelection>
): Promise<void> {
  if (message.author.bot || !message.guildId) return;
  if (message.guildId !== services.config.discord.guildId) return;

  if (message.channelId === services.config.discord.moviesChannelId) {
    await handleMovieRequest(message, services, pendingSelections);
    return;
  }

  if (message.channelId === services.config.discord.showsChannelId) {
    await handleShowRequest(message, services, pendingSelections);
  }
}

async function handleMovieRequest(
  message: Message,
  services: BotServices,
  pendingSelections: Map<string, PendingSelection>
): Promise<void> {
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
  const matches = await services.radarr.lookupMovies(parsed.value.title, parsed.value.year);

  if (matches.length > 1 || (matches.length > 0 && parsed.value.year === undefined)) {
    await promptForMovieSelection(status, message.author.id, matches, quality, pendingSelections);
    return;
  }

  const match = matches[0];
  if (!match) {
    await status.edit(`Unable to identify ${parsed.value.title}`);
    return;
  }

  const result = await services.radarr.addLookupAndSearch(match, quality);
  await status.edit(formatRadarrResult(result));
}

async function handleShowRequest(
  message: Message,
  services: BotServices,
  pendingSelections: Map<string, PendingSelection>
): Promise<void> {
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
  const matches = await services.sonarr.lookupSeries(parsed.value.title, parsed.value.year);

  if (matches.length > 1) {
    await promptForShowSelection(status, message.author.id, matches, quality, searchScope, pendingSelections);
    return;
  }

  const match = matches[0];
  if (!match) {
    await status.edit(`Unable to identify ${parsed.value.title}`);
    return;
  }

  const result = await services.sonarr.addLookupAndSearch(match, quality, searchScope);
  await status.edit(formatSonarrResult(result));
}

async function promptForMovieSelection(
  message: Message,
  requesterId: string,
  matches: RadarrMovieLookup[],
  quality: string,
  pendingSelections: Map<string, PendingSelection>
): Promise<void> {
  const choices = matches.slice(0, MAX_SELECTIONS);
  await message.edit(formatNearMatches(choices.map(formatMovieChoice)));
  storePendingSelection(message.id, pendingSelections, {
    kind: "movie",
    requesterId,
    matches: choices,
    quality,
    timeout: createSelectionTimeout(message.id, pendingSelections)
  });
  await reactWithChoices(message, choices.length);
}

async function promptForShowSelection(
  message: Message,
  requesterId: string,
  matches: SonarrSeriesLookup[],
  quality: string,
  searchScope: SonarrSearchScope,
  pendingSelections: Map<string, PendingSelection>
): Promise<void> {
  const choices = matches.slice(0, MAX_SELECTIONS);
  await message.edit(formatNearMatches(choices.map(formatShowChoice)));
  storePendingSelection(message.id, pendingSelections, {
    kind: "show",
    requesterId,
    matches: choices,
    quality,
    searchScope,
    timeout: createSelectionTimeout(message.id, pendingSelections)
  });
  await reactWithChoices(message, choices.length);
}

async function handleSelectionReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  services: BotServices,
  pendingSelections: Map<string, PendingSelection>
): Promise<void> {
  if (user.bot) return;

  const fullReaction: MessageReaction = reaction.partial ? await reaction.fetch() : reaction;
  const pending = pendingSelections.get(fullReaction.message.id);
  if (!pending || user.id !== pending.requesterId) return;

  const selectedIndex = NUMBER_REACTIONS.indexOf(fullReaction.emoji.name || "");
  if (selectedIndex < 0 || selectedIndex >= pending.matches.length) return;

  clearTimeout(pending.timeout);
  pendingSelections.delete(fullReaction.message.id);

  if (pending.kind === "movie") {
    const match = pending.matches[selectedIndex];
    await fullReaction.message.edit(`Searching for ${formatMovieChoice(match)}...`);
    const result = await services.radarr.addLookupAndSearch(match, pending.quality);
    await fullReaction.message.edit(formatRadarrResult(result));
    return;
  }

  const match = pending.matches[selectedIndex];
  await fullReaction.message.edit(`Searching for ${formatShowChoice(match)}...`);
  const result = await services.sonarr.addLookupAndSearch(match, pending.quality, pending.searchScope);
  await fullReaction.message.edit(formatSonarrResult(result));
}

function storePendingSelection(
  messageId: string,
  pendingSelections: Map<string, PendingSelection>,
  pending: PendingSelection
): void {
  const previous = pendingSelections.get(messageId);
  if (previous) clearTimeout(previous.timeout);
  pendingSelections.set(messageId, pending);
}

function createSelectionTimeout(
  messageId: string,
  pendingSelections: Map<string, PendingSelection>
): NodeJS.Timeout {
  return setTimeout(() => pendingSelections.delete(messageId), SELECTION_TTL_MS);
}

async function reactWithChoices(message: Message, count: number): Promise<void> {
  for (const emoji of NUMBER_REACTIONS.slice(0, count)) {
    await message.react(emoji);
  }
}

function formatNearMatches(matches: string[]): string {
  const options = matches.map((match, index) => `${index + 1}. ${match}`).join("\n");
  return `I couldn't find exactly what you're looking for, is it one of these?\n${options}`;
}

function formatMovieChoice(movie: RadarrMovieLookup): string {
  return `${movie.title} (${movie.year})`;
}

function formatShowChoice(series: SonarrSeriesLookup): string {
  return `${series.title} (${series.year})`;
}

function formatRadarrResult(result: RadarrSearchResult): string {
  if (result.status === "already_exists") {
    return `${result.title} is already on the server!`;
  }

  if (result.status === "found") {
    return `${result.title} found!`;
  }

  if (result.status === "unreleased") {
    return `${result.title} hasn't released yet but it is being monitored!`;
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

  if (result.status === "unreleased") {
    return `${result.title} hasn't released yet but it is being monitored!`;
  }

  return `Unable to find ${title} download`;
}

async function safeReply(message: Message, content: string): Promise<void> {
  const channel = message.channel as TextBasedChannel;
  if (!channel.isSendable()) return;
  await message.reply(content);
}
