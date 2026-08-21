import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Start a private roleplay position application.'),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the status of your latest application.'),
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the application panel in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('questions')
    .setDescription('Manage application questions from Discord.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure positions, roles, application category, and transcripts.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('message')
    .setDescription('Send a private bot DM to the applicant for this application channel.')
    .addStringOption((option) => option
      .setName('message')
      .setDescription('Message to send to the applicant.')
      .setMaxLength(1900)
      .setRequired(true)),
  new SlashCommandBuilder()
    .setName('bar')
    .setDescription('Manage application bars.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName('add')
      .setDescription('Temporarily or permanently bar a user from applying.')
      .addUserOption((option) => option.setName('user').setDescription('User to bar.').setRequired(true))
      .addStringOption((option) => option.setName('duration').setDescription('Examples: 30m, 12h, 7d, 3mo, 1y, or permanent.').setMaxLength(50).setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason shown to staff and the user.').setMaxLength(500)))
    .addSubcommand((subcommand) => subcommand
      .setName('remove')
      .setDescription('Remove an application bar.')
      .addUserOption((option) => option.setName('user').setDescription('User whose bar should be removed.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List active application bars.')),
  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Create and manage reaction-role messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => {
      subcommand
        .setName('create')
        .setDescription('Create a reaction-role panel with up to five roles.')
        .addChannelOption((option) => option.setName('channel').setDescription('Where to post the panel.').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addRoleOption((option) => option.setName('role').setDescription('First role granted by a reaction.').setRequired(true))
        .addStringOption((option) => option.setName('emoji').setDescription('Emoji for the first role.').setRequired(true))
        .addStringOption((option) => option.setName('title').setDescription('Panel title.').setMaxLength(100).setRequired(true))
        .addStringOption((option) => option.setName('description').setDescription('Panel instructions.').setMaxLength(1000));
      for (let index = 2; index <= 5; index += 1) {
        subcommand
          .addRoleOption((option) => option.setName(`role-${index}`).setDescription(`Optional role ${index}.`))
          .addStringOption((option) => option.setName(`emoji-${index}`).setDescription(`Emoji for role ${index}.`));
      }
      return subcommand;
    })
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
