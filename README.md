# Legion Roleplay Applications

A configurable Discord bot for collecting roleplay applications, sending them to staff for review, and automatically granting the appropriate Discord role when an application is approved.

## Features

- Private application flow using slash commands, select menus, and paged modals
- Any number of questions (Discord displays them in pages of five)
- Multiple independently configured positions
- Staff-only Approve and Deny controls
- Automatic Discord role assignment on approval
- Required denial reasons and optional applicant DMs
- Persistent application history stored in `data/applications.json`
- `/application-status` for applicants
- `/application-panel` for server managers
- `/application-setup` role, channel, and position manager
- `/application-config` question manager for server managers
- Live config reload: changes apply the next time somebody interacts with the bot
- PM2 production deployment with crash recovery and automatic reboot startup

## 1. Create the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. On **Bot**, create the bot and reset/copy its token.
3. You do not need to enable privileged gateway intents.
4. Copy `.env.example` to `.env` and add the token, application ID, and server ID.

Never commit or share `.env`. If a token is exposed, reset it in the Developer Portal immediately.

## 2. Configure everything from Discord

You do not need to edit `config/applications.json`. Start the bot, then run `/application-setup` as a member with **Manage Server**. The private setup panel lets you:

- Select one or more staff/reviewer roles
- Select the Discord role granted for each position
- Select each position's private staff review channel
- Add, rename, or delete application positions

Then run `/application-config` to add, edit, reorder, or delete questions. All selections are saved automatically and apply immediately. Until a reviewer role and at least one complete position are selected, applicants receive a friendly setup-incomplete message instead of an error.

The bot's Discord role must appear above every role it needs to grant in **Server Settings → Roles**. Members with **Manage Server** can review applications even if they do not have a configured reviewer role.

## 3. Run locally

Requires Node.js 20.12 or newer.

```bash
npm install
npm test
npm start
```

The bot registers its guild slash commands at startup. Use `/application-panel` in the desired public channel, or let members use `/apply` directly.

## 4. Deploy to an Ubuntu VPS with PM2

Install Git and Node.js 20.12 or newer. Node.js 22 LTS is recommended. Verify the installation before continuing:

```bash
node --version
npm --version
```

Clone the repository and install production dependencies as the non-root user that will own the bot process:

```bash
cd /opt
sudo git clone https://github.com/15inb/legion-roleplay-applications.git
sudo chown -R "$USER":"$USER" /opt/legion-roleplay-applications
cd /opt/legion-roleplay-applications
npm ci --omit=dev
```

Create and protect the environment file:

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`. Role IDs, channel IDs, positions, and questions are configured later from Discord commands.

Install PM2 globally and start the bot from the included ecosystem file:

```bash
sudo npm install -g pm2@latest
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs legion-roleplay-applications --lines 100
```

Press `Ctrl+C` to leave the live log view; the bot continues running. The ecosystem configuration uses one process because multiple Discord bot processes would race while writing the local application and question data.

Enable automatic startup after a VPS reboot:

```bash
pm2 startup
```

PM2 prints a command beginning with `sudo env PATH=...`. Copy and run that exact generated command, then save the current process list:

```bash
pm2 save
```

### Updating the bot

```bash
cd /opt/legion-roleplay-applications
git pull
npm ci --omit=dev
pm2 restart ecosystem.config.cjs --update-env
pm2 save
pm2 logs legion-roleplay-applications --lines 100
```

### PM2 management commands

```bash
pm2 status
pm2 logs legion-roleplay-applications
pm2 restart legion-roleplay-applications
pm2 stop legion-roleplay-applications
pm2 start ecosystem.config.cjs
pm2 monit
```

Application history remains in `data/applications.json`. Back up the `data` and `config` directories before major updates.

## Commands

- `/apply` — choose a position and start an application
- `/application-status` — view the latest application status
- `/application-panel` — post the permanent Apply button (Manage Server required)
- `/application-setup` — configure reviewer roles, positions, granted roles, and review channels with Discord selectors (Manage Server required)
- `/application-config` — add, edit, reorder, or delete questions using a private Discord control panel (Manage Server required)

## Managing questions from Discord

Run `/application-config`, then choose a position. The private manager lets you:

- Add a question with a Discord modal
- Edit its wording, answer type, required status, limits, and placeholder
- Move it up or down
- Delete it after a confirmation step
- Navigate large question lists in pages

Changes are saved to `config/applications.json` and apply immediately to newly started applications. In-progress applications keep the question version they started with. A position must always retain at least one question.

## Data and privacy

Answers are posted only in each position's configured review channel and saved locally in `data/applications.json`. Restrict that channel to reviewers and back up the data directory if the history matters to you.
