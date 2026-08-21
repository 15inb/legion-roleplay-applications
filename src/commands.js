import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

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
].map((command) => command.toJSON());
