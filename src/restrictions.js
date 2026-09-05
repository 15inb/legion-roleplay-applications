import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EmbedBuilder, MessageFlags } from 'discord.js';

const DURATION_UNITS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  mo: 30 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

export function parseRestrictionDuration(input, now = Date.now()) {
  const normalized = input.trim().toLowerCase();
  if (['permanent', 'perm', 'forever'].includes(normalized)) return { expiresAt: null, permanent: true };
  const compact = normalized.replace(/[\s,]+/g, '');
  const matches = [...compact.matchAll(/(\d+)(mo|[smhdwy])/g)];
  if (!matches.length || matches.map((match) => match[0]).join('') !== compact) {
    throw new Error('Duration must look like `30s`, `30m`, `12h`, `7d`, `3w`, `6mo`, `1y`, or `permanent`. Durations can be combined, such as `1d12h`.');
  }
  const duration = matches.reduce((total, match) => total + Number(match[1]) * DURATION_UNITS[match[2]], 0);
  if (!Number.isSafeInteger(duration) || duration < DURATION_UNITS.s) throw new Error('The restriction duration must be at least one second.');
  const expires = now + duration;
  if (!Number.isFinite(expires) || expires > 8_640_000_000_000_000) throw new Error('That duration is too large. Use `permanent` instead.');
  return { expiresAt: new Date(expires).toISOString(), permanent: false };
}

export class ApplicationRestrictionStore {
  constructor(filePath = path.resolve('data/application-bars.json')) {
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
      if (!Array.isArray(parsed)) throw new Error('Application restriction data must be an array.');
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

  isActive(record, now = Date.now()) {
    return record.expiresAt === null || Date.parse(record.expiresAt) > now;
  }

  async upsert(record) {
    await this.load();
    const index = this.records.findIndex((item) => item.guildId === record.guildId && item.userId === record.userId);
    if (index === -1) this.records.push(record);
    else this.records[index] = record;
    await this.save();
    return record;
  }

  async getActive(guildId, userId, now = Date.now()) {
    await this.load();
    const index = this.records.findIndex((item) => item.guildId === guildId && item.userId === userId);
    if (index === -1) return null;
    if (this.isActive(this.records[index], now)) return this.records[index];
    this.records.splice(index, 1);
    await this.save();
    return null;
  }

  async remove(guildId, userId) {
    await this.load();
    const index = this.records.findIndex((item) => item.guildId === guildId && item.userId === userId);
    if (index === -1) return null;
    const [removed] = this.records.splice(index, 1);
    await this.save();
    return removed;
  }

  async listActive(guildId, now = Date.now()) {
    await this.load();
    const before = this.records.length;
    this.records = this.records.filter((record) => record.guildId !== guildId || this.isActive(record, now));
    if (this.records.length !== before) await this.save();
    return this.records.filter((record) => record.guildId === guildId);
  }
}

function restrictionTiming(record) {
  if (record.expiresAt === null) return '**Permanent**';
  const timestamp = Math.floor(Date.parse(record.expiresAt) / 1000);
  return `<t:${timestamp}:F> (<t:${timestamp}:R>)`;
}

export async function handleApplicationBarCommand(interaction, store) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'add') {
    const user = interaction.options.getUser('user', true);
    if (user.bot) throw new Error('Bots cannot submit applications and do not need to be barred.');
    const duration = parseRestrictionDuration(interaction.options.getString('duration', true));
    const reason = interaction.options.getString('reason')?.trim() || 'No reason provided.';
    const record = await store.upsert({
      guildId: interaction.guildId,
      userId: user.id,
      reason,
      expiresAt: duration.expiresAt,
      createdAt: new Date().toISOString(),
      createdBy: interaction.user.id,
    });
    await user.send({
      embeds: [new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('Application Access Restricted')
        .setDescription(`You cannot submit applications in **${interaction.guild.name}**.`)
        .addFields({ name: 'Duration', value: restrictionTiming(record) }, { name: 'Reason', value: reason })],
    }).catch(() => {});
    await interaction.reply({
      content: `Barred <@${user.id}> from applying ${record.expiresAt === null ? 'permanently' : `until ${restrictionTiming(record)}`}.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === 'remove') {
    const user = interaction.options.getUser('user', true);
    const removed = await store.remove(interaction.guildId, user.id);
    if (!removed) throw new Error('That user does not have an application bar in this server.');
    await user.send({
      embeds: [new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('Application Access Restored')
        .setDescription(`Your application bar in **${interaction.guild.name}** was removed. You may apply again, subject to any automatic denial cooldown.`)],
    }).catch(() => {});
    await interaction.reply({ content: `Removed the application bar from <@${user.id}>.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }

  const records = await store.listActive(interaction.guildId);
  const description = records.length
    ? records.map((record) => `<@${record.userId}> • ${restrictionTiming(record)}\n> ${record.reason}\n> Set by <@${record.createdBy}>`).join('\n\n').slice(0, 4000)
    : 'No users are currently barred from applying.';
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor('#8B1A1A').setTitle('Application Bars').setDescription(description)],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}
