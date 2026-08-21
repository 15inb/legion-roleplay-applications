import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EmbedBuilder, MessageFlags } from 'discord.js';

export function emojiKeyFromInput(input) {
  const trimmed = input.trim();
  const custom = /^<a?:[a-zA-Z0-9_]+:(\d{17,20})>$/.exec(trimmed);
  return custom ? custom[1] : trimmed;
}

export function emojiKeyFromReaction(reaction) {
  return reaction.emoji.id ?? reaction.emoji.name;
}

export class ReactionRoleStore {
  constructor(filePath = path.resolve('data/reaction-roles.json')) {
    this.filePath = filePath;
    this.loaded = false;
    this.records = [];
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('Reaction-role data must be an array.');
      this.records = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  async save() {
    const operation = async () => {
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.records, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
    };
    this.writeQueue = this.writeQueue.then(operation, operation);
    await this.writeQueue;
  }

  async add(record) {
    await this.load();
    const index = this.records.findIndex((item) => item.guildId === record.guildId
      && item.messageId === record.messageId && item.emojiKey === record.emojiKey);
    if (index === -1) this.records.push(record);
    else this.records[index] = record;
    await this.save();
    return record;
  }

  async remove(guildId, messageId, emojiKey) {
    await this.load();
    const index = this.records.findIndex((item) => item.guildId === guildId
      && item.messageId === messageId && item.emojiKey === emojiKey);
    if (index === -1) return null;
    const [removed] = this.records.splice(index, 1);
    await this.save();
    return removed;
  }

  async find(guildId, messageId, emojiKey) {
    await this.load();
    return this.records.find((item) => item.guildId === guildId
      && item.messageId === messageId && item.emojiKey === emojiKey) ?? null;
  }

  async list(guildId) {
    await this.load();
    return this.records.filter((item) => item.guildId === guildId);
  }
}

async function fetchTargetMessage(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  if (!channel.isTextBased()) throw new Error('The selected channel must be a text channel.');
  const messageId = interaction.options.getString('message-id', true);
  return { channel, message: await channel.messages.fetch(messageId) };
}

export async function handleReactionRoleCommand(interaction, store) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'create') {
    const channel = interaction.options.getChannel('channel', true);
    const role = interaction.options.getRole('role', true);
    const emoji = interaction.options.getString('emoji', true).trim();
    const title = interaction.options.getString('title', true);
    const description = interaction.options.getString('description') ?? 'React below to add or remove the role.';
    if (!channel.isTextBased()) throw new Error('The selected channel must be a text channel.');
    const embed = new EmbedBuilder()
      .setColor('#8B1A1A')
      .setTitle(title)
      .setDescription(description)
      .addFields({ name: 'Role', value: `<@&${role.id}>` })
      .setFooter({ text: 'Remove your reaction to remove the role.' });
    const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    await message.react(emoji);
    await store.add({
      guildId: interaction.guildId,
      channelId: channel.id,
      messageId: message.id,
      roleId: role.id,
      emoji,
      emojiKey: emojiKeyFromInput(emoji),
      createdAt: new Date().toISOString(),
    });
    await interaction.reply({ content: `Reaction-role panel created: ${message.url}`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'add') {
    const { channel, message } = await fetchTargetMessage(interaction);
    const role = interaction.options.getRole('role', true);
    const emoji = interaction.options.getString('emoji', true).trim();
    await message.react(emoji);
    await store.add({
      guildId: interaction.guildId,
      channelId: channel.id,
      messageId: message.id,
      roleId: role.id,
      emoji,
      emojiKey: emojiKeyFromInput(emoji),
      createdAt: new Date().toISOString(),
    });
    await interaction.reply({ content: `Added ${emoji} → <@&${role.id}> to ${message.url}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'remove') {
    const { message } = await fetchTargetMessage(interaction);
    const emoji = interaction.options.getString('emoji', true).trim();
    const emojiKey = emojiKeyFromInput(emoji);
    const removed = await store.remove(interaction.guildId, message.id, emojiKey);
    if (!removed) throw new Error('No reaction-role mapping was found for that message and emoji.');
    const reaction = message.reactions.cache.find((item) => emojiKeyFromReaction(item) === emojiKey);
    await reaction?.users.remove(interaction.client.user.id).catch(() => {});
    await interaction.reply({ content: `Removed the ${emoji} reaction-role mapping.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const records = await store.list(interaction.guildId);
  const content = records.length
    ? records.map((record) => `${record.emoji} → <@&${record.roleId}> • <#${record.channelId}> • message \`${record.messageId}\``).join('\n')
    : 'No reaction roles are configured.';
  await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

export function attachReactionRoleHandlers(client, store, logger = console) {
  async function changeRole(reaction, user, add) {
    if (user.bot) return;
    try {
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
      const guild = reaction.message.guild;
      if (!guild) return;
      const mapping = await store.find(guild.id, reaction.message.id, emojiKeyFromReaction(reaction));
      if (!mapping) return;
      const member = await guild.members.fetch(user.id);
      if (add) await member.roles.add(mapping.roleId, 'Reaction role added');
      else await member.roles.remove(mapping.roleId, 'Reaction role removed');
    } catch (error) {
      logger.error(`Could not ${add ? 'add' : 'remove'} reaction role:`, error);
    }
  }
  client.on('messageReactionAdd', (reaction, user) => changeRole(reaction, user, true));
  client.on('messageReactionRemove', (reaction, user) => changeRole(reaction, user, false));
}
