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

  async listForMessage(guildId, messageId) {
    await this.load();
    return this.records.filter((item) => item.guildId === guildId && item.messageId === messageId);
  }
}

async function fetchTargetMessage(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  if (!channel.isTextBased()) throw new Error('The selected channel must be a text channel.');
  const messageId = interaction.options.getString('message-id', true);
  return { channel, message: await channel.messages.fetch(messageId) };
}

function assertManageableRole(interaction, role) {
  if (role.managed) throw new Error(`${role.name} is managed by an integration and cannot be assigned.`);
  const botHighestRole = interaction.guild.members.me?.roles.highest;
  if (botHighestRole && role.comparePositionTo(botHighestRole) >= 0) {
    throw new Error(`${role.name} must be below the bot's highest role.`);
  }
}

function mappingFields(records) {
  if (!records.length) return [{ name: 'Available roles', value: '_No roles are currently configured._' }];
  const fields = [];
  let lines = [];
  let length = 0;
  for (const record of records) {
    const line = `${record.emoji}  →  <@&${record.roleId}>`;
    if (length + line.length + 1 > 1024 && lines.length) {
      fields.push({ name: fields.length ? 'Available roles (continued)' : 'Available roles', value: lines.join('\n') });
      lines = [];
      length = 0;
    }
    lines.push(line);
    length += line.length + 1;
  }
  if (lines.length) fields.push({ name: fields.length ? 'Available roles (continued)' : 'Available roles', value: lines.join('\n') });
  return fields;
}

export function buildReactionRoleEmbed({ title, description, color = '#8B1A1A' }, records) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title || 'Reaction Roles')
    .setDescription(description || 'Choose the reactions for the roles you want.')
    .addFields(mappingFields(records))
    .setFooter({ text: 'Add a reaction to receive a role • Remove it to remove the role' });
}

async function refreshReactionRolePanel(message, records) {
  if (message.author?.id !== message.client.user.id) return;
  const existing = message.embeds[0];
  const embed = buildReactionRoleEmbed({
    title: existing?.title,
    description: existing?.description,
    color: existing?.hexColor ?? '#8B1A1A',
  }, records);
  await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
}

function createMappingsFromOptions(interaction) {
  const mappings = [];
  for (let index = 1; index <= 5; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`;
    const role = interaction.options.getRole(`role${suffix}`, index === 1);
    const emoji = interaction.options.getString(`emoji${suffix}`, index === 1)?.trim();
    if (!role && !emoji) continue;
    if (!role || !emoji) throw new Error(`Role ${index} and emoji ${index} must be provided together.`);
    assertManageableRole(interaction, role);
    mappings.push({ role, emoji, emojiKey: emojiKeyFromInput(emoji) });
  }
  if (new Set(mappings.map((mapping) => mapping.emojiKey)).size !== mappings.length) {
    throw new Error('Each role on a panel must use a different emoji.');
  }
  if (new Set(mappings.map((mapping) => mapping.role.id)).size !== mappings.length) {
    throw new Error('Each role can appear only once on a panel.');
  }
  return mappings;
}

export async function handleReactionRoleCommand(interaction, store) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'create') {
    const channel = interaction.options.getChannel('channel', true);
    const mappings = createMappingsFromOptions(interaction);
    const title = interaction.options.getString('title', true);
    const description = interaction.options.getString('description') ?? 'Choose the reactions for the roles you want.';
    if (!channel.isTextBased()) throw new Error('The selected channel must be a text channel.');
    const records = mappings.map((mapping) => ({
      guildId: interaction.guildId,
      channelId: channel.id,
      roleId: mapping.role.id,
      emoji: mapping.emoji,
      emojiKey: mapping.emojiKey,
      createdAt: new Date().toISOString(),
    }));
    const embed = buildReactionRoleEmbed({ title, description }, records);
    const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    try {
      for (const record of records) {
        await message.react(record.emoji);
        await store.add({ ...record, messageId: message.id });
      }
    } catch (error) {
      await message.delete().catch(() => {});
      for (const record of records) await store.remove(interaction.guildId, message.id, record.emojiKey);
      throw error;
    }
    await interaction.reply({ content: `Reaction-role panel created: ${message.url}`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === 'add') {
    const { channel, message } = await fetchTargetMessage(interaction);
    const role = interaction.options.getRole('role', true);
    const emoji = interaction.options.getString('emoji', true).trim();
    assertManageableRole(interaction, role);
    const existing = await store.listForMessage(interaction.guildId, message.id);
    if (existing.length >= 20) throw new Error('Discord supports at most 20 different reactions on one message.');
    if (existing.some((record) => record.emojiKey === emojiKeyFromInput(emoji))) {
      throw new Error('That emoji is already configured on this panel. Remove it first if you want to change its role.');
    }
    if (existing.some((record) => record.roleId === role.id)) {
      throw new Error('That role is already configured on this panel. Each role should use one reaction.');
    }
    await message.react(emoji);
    const record = await store.add({
      guildId: interaction.guildId,
      channelId: channel.id,
      messageId: message.id,
      roleId: role.id,
      emoji,
      emojiKey: emojiKeyFromInput(emoji),
      createdAt: new Date().toISOString(),
    });
    await refreshReactionRolePanel(message, [...existing, record]);
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
    await refreshReactionRolePanel(message, await store.listForMessage(interaction.guildId, message.id));
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
