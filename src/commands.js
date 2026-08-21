import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Start a private roleplay position application.'),
  new SlashCommandBuilder()
    .setName('application-status')
    .setDescription('Check the status of your latest application.'),
  new SlashCommandBuilder()
    .setName('application-panel')
    .setDescription('Post the application panel in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('application-config')
    .setDescription('Manage application questions from Discord.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('application-setup')
    .setDescription('Configure positions, roles, and review channels from Discord.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('reaction-role')
    .setDescription('Create and manage reaction-role messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName('create')
      .setDescription('Create a new reaction-role panel.')
      .addChannelOption((option) => option.setName('channel').setDescription('Where to post the panel.').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addRoleOption((option) => option.setName('role').setDescription('Role granted by the reaction.').setRequired(true))
      .addStringOption((option) => option.setName('emoji').setDescription('A Unicode or custom server emoji.').setRequired(true))
      .addStringOption((option) => option.setName('title').setDescription('Panel title.').setMaxLength(100).setRequired(true))
      .addStringOption((option) => option.setName('description').setDescription('Panel instructions.').setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName('add')
      .setDescription('Add another emoji and role to an existing message.')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel containing the message.').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption((option) => option.setName('message-id').setDescription('Discord message ID.').setRequired(true))
      .addRoleOption((option) => option.setName('role').setDescription('Role granted by the reaction.').setRequired(true))
      .addStringOption((option) => option.setName('emoji').setDescription('A Unicode or custom server emoji.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('remove')
      .setDescription('Remove a reaction-role mapping.')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel containing the message.').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption((option) => option.setName('message-id').setDescription('Discord message ID.').setRequired(true))
      .addStringOption((option) => option.setName('emoji').setDescription('The configured emoji.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List configured reaction roles.')),
].map((command) => command.toJSON());
