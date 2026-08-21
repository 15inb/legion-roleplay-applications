# Legion Roleplay Applications

A configurable Discord bot for collecting roleplay applications, sending them to staff for review, and automatically granting the appropriate Discord role when an application is approved.

## Features

- Private application flow using slash commands, select menus, and paged modals
- Any number of questions (Discord displays them in pages of five)
- Multiple independently configured positions
- Staff-only Approve and Deny controls
- Automatic Discord role assignment on approval
- A private channel for every submitted application
- Staff-to-applicant DM messaging with applicant replies relayed back to staff
- Decision transcripts archived to a configured channel
- Persistent reaction-role panels
- Required denial reasons and optional applicant DMs
- Persistent application history stored in `data/applications.json`
- `/status` for applicants
- `/panel` for server managers
- `/setup` role, channel, and position manager
- `/questions` question manager for server managers
- Live config reload: changes apply the next time somebody interacts with the bot
- PM2 production deployment with crash recovery and automatic reboot startup

## 1. Create the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. On **Bot**, create the bot and reset/copy its token.
3. Enable **Message Content Intent** on the Bot page. It is required to include staff/applicant conversation in transcripts.
4. Copy `.env.example` to `.env` and add the token, application ID, and server ID.

Never commit or share `.env`. If a token is exposed, reset it in the Developer Portal immediately.

## 2. Configure everything from Discord

You do not need to edit `config/applications.json`. Start the bot, then run `/setup` as a member with **Manage Server**. The private setup panel lets you:

- Select one or more staff/reviewer roles
- Select the category where private application channels are created
- Select the channel where decision transcripts are archived
- Select the Discord role granted for each position
- Add, rename, or delete application positions

Then run `/questions` to add, edit, reorder, or delete questions. All selections are saved automatically and apply immediately. Until a reviewer role and at least one complete position are selected, applicants receive a friendly setup-incomplete message instead of an error.

The included starting configuration has one **Legionnaire Application** with eight Legion questions. You can add more application positions later from `/setup`.

The bot's Discord role must appear above every role it needs to grant in **Server Settings → Roles**. Members with **Manage Server** can review applications even if they do not have a configured reviewer role.

## 3. Run locally

Requires Node.js 20.12 or newer.

```bash
npm install
npm test
npm start
```

The bot registers its guild slash commands at startup. Use `/panel` in the desired public channel, or let members use `/apply` directly.

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
- `/status` — view the latest application status
- `/panel` — post the permanent Apply button (Manage Server required)
- `/setup` — configure reviewer roles, positions, granted roles, application category, and transcript channel (Manage Server required)
- `/message` — DM the applicant from inside their open application channel (reviewers only)
- `/questions` — add, edit, reorder, or delete questions using a private Discord control panel (Manage Server required)
- `/roles create` — post a new reaction-role panel
- `/roles add` — add another emoji/role mapping to a message
- `/roles remove` — remove a mapping
- `/roles list` — list configured mappings

## Managing questions from Discord

Run `/questions`, then choose a position. The private manager lets you:

- Add a question with a Discord modal
- Edit its wording, answer type, required status, limits, and placeholder
- Move it up or down
- Delete it after a confirmation step
- Navigate large question lists in pages

Changes are saved to the bot's private `data/settings.json` runtime file and apply immediately to newly started applications. In-progress applications keep the question version they started with. A position must always retain at least one question.

## Private channels and transcripts

After the final form page is submitted, the bot creates a channel under the category selected in `/setup`. Only reviewer roles and the bot can see it; the applicant never receives channel access or a channel link. The original questions and answers are posted as numbered embeds with the staff review controls.

To contact the applicant, a reviewer runs this inside the application channel:

```text
/message message:Your message here
```

The bot sends the message by DM without exposing the staff member's identity. When the applicant replies to the bot's DM, their message and attachment links are relayed into the open application channel and the applicant receives a delivery confirmation. Applicants with no open application receive a clear response instead.

When staff approve or deny the application, the bot:

1. Saves the decision.
2. Generates a timestamped text transcript of up to 1,000 channel messages, embeds, and attachment links.
3. Uploads it to the transcript channel selected in `/setup`.
4. Locks the application channel and renames it with a `closed-` prefix.

The bot needs **View Channels**, **Send Messages**, **Embed Links**, **Attach Files**, **Read Message History**, **Add Reactions**, **Manage Channels**, **Manage Messages**, and **Manage Roles**. Its role must remain above every role it grants.

## Reaction roles

Create a panel entirely from Discord:

```text
/roles create channel:#roles role:@Legion emoji:🛡️ title:Join the Legion
```

Removing a reaction removes the role. Custom server emoji mentions are supported. Reaction-role mappings persist in `data/reaction-roles.json`, so they continue working after restarts. Use `/roles add` to attach additional mappings to an existing message; enable Discord Developer Mode to copy that message's ID.

## Data and privacy

Answers are posted only in private application channels and saved locally in `data/applications.json`. Transcripts are sent to the configured archive channel. Restrict the application category and transcript channel to appropriate staff, and back up the data directory if the history matters to you.
