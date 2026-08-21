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
- `/application-config` question manager for server managers
- Live config reload: changes apply the next time somebody interacts with the bot
- PM2 production deployment with crash recovery and automatic reboot startup

## 1. Create the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. On **Bot**, create the bot and reset/copy its token.
3. You do not need to enable privileged gateway intents.
4. Copy `.env.example` to `.env` and add the token, application ID, and server ID.

Never commit or share `.env`. If a token is exposed, reset it in the Developer Portal immediately.

## 2. Configure positions

Edit `config/applications.json`. Replace every `PUT_..._HERE` value with a real Discord ID. Enable Discord Developer Mode under **User Settings → Advanced**, then right-click a server, channel, or role and choose **Copy ID**.

Each position has this shape:

```json
{
  "id": "mechanic",
  "name": "Mechanic",
  "description": "Apply for the mechanic team.",
  "roleId": "123456789012345678",
  "reviewChannelId": "123456789012345678",
  "questions": [
    {
      "id": "character-name",
      "label": "What is your character's name?",
      "style": "short",
      "required": true,
      "maxLength": 100,
      "placeholder": "First and last name"
    }
  ]
}
```

The JSON file is primarily needed for the initial position, role, and review-channel setup. After the bot is running, use `/application-config` in Discord to manage questions without editing this file.

Question options:

| Property | Meaning |
| --- | --- |
| `id` | Unique lowercase ID within this position. Do not change it while someone is filling out a form. |
| `label` | Question text, up to 45 characters. |
| `style` | `short` for one line or `paragraph` for longer answers. |
| `required` | Whether an answer is required. |
| `minLength` / `maxLength` | Optional answer limits, from 0 to 4000 characters. |
| `placeholder` | Optional example text, up to 100 characters. |

`reviewerRoleIds` controls who may approve or deny. Members with **Manage Server** may also review. The bot's role must appear above every role it needs to grant in **Server Settings → Roles**.

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

Fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`. Set the initial position, channel, and role IDs in `config/applications.json`, then validate it:

```bash
python3 -m json.tool config/applications.json >/dev/null
```

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
