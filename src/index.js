import 'dotenv/config';
import { ActivityType, Client, GatewayIntentBits, Partials, PermissionFlagsBits, REST, Routes } from 'discord.js';
import { attachBotHandlers } from './bot.js';
import { commands } from './commands.js';
import { ConfigService } from './config.js';
import { attachReactionRoleHandlers, ReactionRoleStore } from './reaction-roles.js';
import { ApplicationStore } from './store.js';

const requiredEnvironment = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID'];
const missing = requiredEnvironment.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

const configService = new ConfigService();
await configService.get({ allowPlaceholders: true });

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID), { body: commands });
console.log(`Registered ${commands.length} commands in guild ${process.env.DISCORD_GUILD_ID}.`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});
const reactionRoleStore = new ReactionRoleStore();
attachBotHandlers(client, { configService, store: new ApplicationStore(), reactionRoleStore });
attachReactionRoleHandlers(client, reactionRoleStore);

client.once('clientReady', (readyClient) => {
  readyClient.user.setActivity(process.env.BOT_ACTIVITY || 'Roleplay Applications', { type: ActivityType.Watching });
  const permissions = PermissionFlagsBits.ViewChannel
    | PermissionFlagsBits.SendMessages
    | PermissionFlagsBits.SendMessagesInThreads
    | PermissionFlagsBits.CreatePublicThreads
    | PermissionFlagsBits.EmbedLinks
    | PermissionFlagsBits.AttachFiles
    | PermissionFlagsBits.ReadMessageHistory
    | PermissionFlagsBits.AddReactions
    | PermissionFlagsBits.ManageChannels
    | PermissionFlagsBits.ManageMessages
    | PermissionFlagsBits.ManageRoles;
  const invite = `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=${permissions}&scope=bot%20applications.commands`;
  console.log(`Logged in as ${readyClient.user.tag}.`);
  console.log(`Invite the bot: ${invite}`);
});

process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
process.on('SIGINT', () => client.destroy());
process.on('SIGTERM', () => client.destroy());

await client.login(process.env.DISCORD_TOKEN);
