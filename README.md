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
- Live config reload: changes apply the next time somebody interacts with the bot
- Docker Compose and systemd deployment options

## 1. Create the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. On **Bot**, create the bot and reset/copy its token.
3. You do not need to enable privileged gateway intents.
4. Copy `.env.example` to `.env` and add the token, application ID, and server ID.

Never commit or share `.env`. If a token is exposed, reset it in the Developer Portal immediately.

## 2. Configure applications

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

## 4. Deploy to a VPS

### Docker Compose (recommended)

```bash
git clone YOUR_GITHUB_REPOSITORY_URL roleplay-applications
cd roleplay-applications
cp .env.example .env
# Edit .env and config/applications.json
docker compose up -d --build
docker compose logs -f
```

Updates:

```bash
git pull
docker compose up -d --build
```

The `data` directory is mounted from the host, so application history survives container rebuilds.

### systemd

Install Node.js 20+, clone to `/opt/roleplay-applications`, create a dedicated `discordbot` user, run `npm ci --omit=dev`, and copy `deploy/roleplay-applications.service` to `/etc/systemd/system/`. Then run:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now roleplay-applications
sudo journalctl -u roleplay-applications -f
```

## Commands

- `/apply` — choose a position and start an application
- `/application-status` — view the latest application status
- `/application-panel` — post the permanent Apply button (Manage Server required)

## Data and privacy

Answers are posted only in each position's configured review channel and saved locally in `data/applications.json`. Restrict that channel to reviewers and back up the data directory if the history matters to you.
