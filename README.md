# Legion Roleplay Applications

A configurable Discord bot for collecting roleplay applications, sending them to staff for review, and automatically applying the appropriate Discord role changes when an application is approved.

## Features

- Private application interviews conducted one question at a time through bot DMs
- Restart-safe unfinished interviews that resume at the saved question
- Any number of questions without Discord's five-input modal limit
- Multiple independently configured positions
- Staff-only Approve and Deny controls
- Automatic multi-role grants and removals on approval
- A private channel for every submitted application
- Staff-to-applicant DM messaging with applicant replies relayed back to staff
- Decision transcripts archived to a configured channel
- Persistent reaction-role panels
- Customizable private ticket panels with selectable destination categories
- Required denial reasons and applicant decision DMs
- Automatic 24-hour reapplication cooldown after denial
- Timed or permanent application bars managed from Discord
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
3. Enable **Message Content Intent** on the Bot page. It is required to receive application answers and staff/applicant conversations through DMs.
4. Copy `.env.example` to `.env` and add the token, application ID, and server ID.

Never commit or share `.env`. If a token is exposed, reset it in the Developer Portal immediately.

## 2. Configure everything from Discord

You do not need to edit `config/applications.json`. Start the bot, then run `/setup` as a member with **Manage Server**. The private setup panel lets you:

- Select one or more staff/reviewer roles
- Select the category where private application channels are created
- Select the channel where decision transcripts are archived
- Select one or more roles granted and any roles removed for each position
- Add, rename, or delete application positions

Then run `/questions` to add, edit, reorder, or delete questions. All selections are saved automatically and apply immediately. Until a reviewer role and at least one complete position are selected, applicants receive a friendly setup-incomplete message instead of an error.

The included starting configuration has one **Legionnaire Application** with eight Legion questions. You can add more application positions later from `/setup`.

Each position has separate multi-select menus for roles to grant and roles to remove. Existing single-role position settings migrate automatically. The bot's Discord role must appear above every role it needs to grant or remove in **Server Settings → Roles**. Members with **Manage Server** can review applications even if they do not have a configured reviewer role.

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

- `/apply` — choose a position and start its private DM interview
- `/status` — view the latest application status
- `/panel` — choose one or more applications and post a direct button for each one (Manage Server required)
- `/setup` — configure reviewer roles, positions, approval role grants/removals, application category, and transcript channel (Manage Server required)
- `/message` — DM the applicant from inside their open application channel (reviewers only)
- `/bar add` — bar a user from applying for a duration or permanently (Manage Server required)
- `/bar remove` — remove a user's application bar (Manage Server required)
- `/bar list` — list active application bars (Manage Server required)
- `/questions` — add, edit, reorder, or delete questions using a private Discord control panel (Manage Server required)
- `/roles create` — post a new reaction-role panel with up to five roles at once
- `/roles add` — add another emoji/role mapping to a message
- `/roles remove` — remove a mapping
- `/roles list` — list configured mappings
- `/tickets create` — post a customizable ticket button and choose its destination category (Manage Server required)
- `/tickets close` — close the current ticket after confirmation

## Managing questions from Discord

Run `/questions`, then choose a position. The private manager lets you:

- Add a question with a Discord modal
- Edit its wording, answer type, required status, limits, and placeholder
- Move it up or down
- Delete it after a confirmation step
- Navigate large question lists in pages

Changes are saved to the bot's private `data/settings.json` runtime file and apply immediately to newly started applications. In-progress applications keep the question version they started with. A position must always retain at least one question.

## Private channels and transcripts

Pressing an application button starts a private DM interview with the bot. Questions are sent one at a time, and each DM reply automatically advances to the next question. Applicants can type `back` to revise their previous answer or `cancel` to discard the unfinished interview. Answers are checked against the required and character-limit settings configured through `/questions`. Progress is saved after every accepted answer in `data/application-sessions.json`, so an unfinished interview resumes at the same question after a bot or VPS restart. Interviews still expire after 24 hours of inactivity.

After an application is denied, that user must wait 24 hours from the decision before starting another application. Staff can also restrict application access from Discord:

```text
/bar add user:@Member duration:7d reason:Wait before reapplying
/bar add user:@Member duration:permanent reason:Application access revoked
/bar remove user:@Member
/bar list
```

Durations support seconds (`30s`), minutes (`30m`), hours (`12h`), days (`7d`), weeks (`3w`), 30-day months (`6mo`), years (`1y`), combined values such as `1d12h`, and `permanent`. Bars are saved in `data/application-bars.json`, survive restarts, automatically expire, and are checked again during an unfinished DM interview. Removing a manual bar does not bypass an active automatic denial cooldown.

After the final DM answer is submitted, the bot creates a channel under the category selected in `/setup`. Only reviewer roles and the bot can see it; the applicant never receives channel access or a channel link. The original questions and answers are posted as numbered embeds with the staff review controls.

To contact the applicant, a reviewer runs this inside the application channel:

```text
/message message:Your message here
```

The bot sends the message by DM without exposing the staff member's identity. When the applicant replies to the bot's DM, their message and attachment links are relayed into the open application channel and the applicant receives a delivery confirmation. Applicants with no open application receive a clear response instead.

When staff approve or deny the application, the bot:

1. On approval, grants and removes every role configured for that position, then saves the decision. If a role change fails, the application remains pending and completed changes are rolled back where possible.
2. Generates a Discord-native transcript of up to 1,000 channel messages, embeds, and attachment links.
3. Posts the transcript as readable embed pages in a dedicated thread under the transcript channel selected in `/setup`. If threads are unavailable, the pages are posted directly in that channel.
4. Attaches a polished, self-contained HTML copy with image previews as an optional backup/export.
5. Permanently deletes the private application channel.

The Discord transcript and backup archive are saved before deletion. Staff can open the transcript thread and read it without downloading anything. If transcript generation or posting fails, the bot keeps the application channel and tells the reviewer to check the logs, preventing the conversation from being lost. If an unusually large HTML backup exceeds Discord's upload limit, the oldest messages are omitted in safe chunks and the transcript clearly records how many were omitted.

The bot needs **View Channels**, **Send Messages**, **Send Messages in Threads**, **Create Public Threads**, **Embed Links**, **Attach Files**, **Read Message History**, **Add Reactions**, **Manage Channels**, **Manage Messages**, and **Manage Roles**. Its role must remain above every role it grants or removes. Without thread permissions, readable transcript pages fall back to the configured transcript channel.

## Reaction roles

Create a panel entirely from Discord:

```text
/roles create channel:#roles role:@Legion emoji:🛡️ title:Choose your roles role-2:@Officer emoji-2:⚔️
```

The create command supports up to five role/emoji pairs, and the panel embed clearly lists every mapping. Removing a reaction removes its role. Custom server emoji mentions are supported. Reaction-role mappings persist in `data/reaction-roles.json`, so they continue working after restarts. Use `/roles add` to attach more mappings to the same panel later; the displayed list updates automatically. Enable Discord Developer Mode to copy that message's ID.

## Tickets

Create a ticket panel entirely from Discord:

```text
/tickets create panel-channel:#roleplay-tickets ticket-category:Active-RP-Tickets transcript-channel:#ticket-transcripts name:Roleplay Ticket description:Open a private channel for a roleplay scene or situation. question:What is this roleplay ticket about? access-role:@GameMaster button-name:Open RP Ticket
```

The command lets you choose where the panel is posted, the category where its private tickets are created, the channel where closed-ticket transcripts are archived, the panel name and description, the question shown when a ticket is opened, the button label, and the role allowed to participate in tickets from that panel. This role is configured independently from application reviewers. Discord allows up to 45 characters for the custom modal question.

When someone presses the button, the bot opens a modal asking the panel's custom question. Their response is saved and displayed in the new channel's topic and opening embed. Each user can have one open ticket per panel. Only the ticket opener, the configured roleplay access role, and the bot can see its channel. The welcome embed includes a **Close Ticket** button, and `/tickets close` provides the same confirmation flow. On close, the bot posts a summary and Discord-readable transcript pages in a thread under the panel's transcript channel, then permanently deletes the ticket channel. If archiving fails, the ticket remains open. Panel and ticket state is saved in `data/tickets.json`, so buttons and duplicate-ticket protection continue working after restarts.

## Data and privacy

Answers are posted only in private application channels and saved locally in `data/applications.json`. Unfinished interview progress is saved in `data/application-sessions.json`, ticket state is saved in `data/tickets.json`, and manual application bars are saved in `data/application-bars.json`. After an application decision, its channel is permanently deleted and a Discord-readable transcript plus an HTML backup are sent to the configured archive channel. Restrict application, ticket, and transcript categories to appropriate staff, and back up the data directory if the history matters to you.
