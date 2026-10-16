# NotifyX

NotifyX watches YouTube channels and posts a Discord notification whenever they **upload a new
video**, **go live**, or **schedule an upcoming stream** — in as many Discord servers as you want,
each with its own destination channel, ping role, and message/embed design.

- **Slash commands only** — no prefix commands, no message-content permission needed.
- **Multi-server** — one bot, unlimited servers, unlimited followed channels per server (configurable cap).
- **Per-server, per-channel, per-event customization** — destination channel/category, role to ping,
  custom message & embed (title, description, color, image, footer, timestamp), custom buttons, on/off.
- **Reliable** — PostgreSQL-backed queue with automatic retries, duplicate protection, and full
  resume-after-restart (nothing is lost if the bot restarts or the host reboots).
- **Runs anywhere** — Pterodactyl-style game panels, generic Node hosting panels, Docker, a plain VPS,
  or Termux on Android. Always started the same way: `node index.js` (or `npm start`).
- **⚡ Instant delivery** — with one setting (`PUBLIC_URL`, see [How notifications
  work](#how-notifications-work)), YouTube pushes new uploads/streams to the bot the moment they
  happen, and NotifyX notifies within seconds — no waiting for a polling schedule.

---

## Contents

1. [Quick start](#quick-start)
2. [Discord bot setup](#discord-bot-setup)
3. [YouTube API setup](#youtube-api-setup)
4. [Database setup](#database-setup)
5. [Environment variables](#environment-variables)
6. [Running it](#running-it) — Docker, VPS, hosting panels, Termux
7. [Using the bot](#using-the-bot) — commands
8. [How notifications work](#how-notifications-work)
9. [Troubleshooting](#troubleshooting)
10. [Project layout](#project-layout)
11. [Adding another platform](#adding-another-platform)

---

## Quick start

```bash
git clone <your-repo-url> notifyx
cd notifyx
npm install
cp .env.example .env
# edit .env: at minimum set DISCORD_TOKEN, DISCORD_CLIENT_ID, and a database (see below)
npm run migrate          # creates the database tables
npm start                # or: node index.js
```

Then in Discord, run `/setup` in a server to pick a default channel, and `/youtube add
channel:<url>` to follow your first YouTube channel.

---

## Discord bot setup

1. Go to the **[Discord Developer Portal](https://discord.com/developers/applications)** → **New
   Application**. Name it (e.g. "NotifyX").
2. Open **Bot** in the sidebar → **Reset Token** → copy it → this is your `DISCORD_TOKEN`.
   Keep it secret — anyone with it fully controls your bot.
3. Still on the **Bot** page: no privileged intents are required. NotifyX is slash-command-only and
   never reads message content, so leave **Message Content Intent** off.
4. Open **OAuth2 → General** and copy **Application ID** → this is your `DISCORD_CLIENT_ID`.
5. Invite the bot to a server. The easiest way is to run, after configuring your `.env`:
   ```bash
   npm run invite
   ```
   This prints a ready-made invite URL with exactly the permissions NotifyX needs:
   - **View Channel**, **Send Messages**, **Send Messages in Threads**, **Embed Links** — to post notifications
   - **Mention @everyone, @here and All Roles** — so role pings work even for un-mentionable roles
   - **Use External Emojis** — so custom emoji from other servers can be used if you set them
   - **Manage Channels** — only needed if you use the "create a channel per YouTube channel in a category" feature; skip granting it if you never plan to use that.

   Open the printed URL, pick your server, and authorize.
6. **(Optional, recommended for development)** Set `DISCORD_DEV_GUILD_ID` to your test server's ID
   (enable Developer Mode in Discord → right-click your server → Copy Server ID). Commands then
   register instantly in that one server instead of taking up to an hour to propagate globally.
   Leave it empty in production so commands register for every server the bot is in.

---

## YouTube API setup

NotifyX uses the official **YouTube Data API v3** to look up channels and video/livestream details.

1. Go to the **[Google Cloud Console](https://console.cloud.google.com/)** → create a project (or
   pick an existing one).
2. **APIs & Services → Library** → search **"YouTube Data API v3"** → **Enable**.
3. **APIs & Services → Credentials** → **Create Credentials → API key**. Copy it → this is your
   `YOUTUBE_API_KEY`.
4. (Recommended) Click **Edit** on the key and, under **API restrictions**, restrict it to **YouTube
   Data API v3** only. Leave **Application restrictions** as "None" unless your server has a static
   outbound IP you can allow-list.

### About quota

The API gives every project **10,000 quota units/day** for free, which resets at **midnight Pacific
Time**. NotifyX is designed to use very little of it:

- **Discovering new uploads costs 0 quota** by default — it uses YouTube's public per-channel Atom
  feed (`YOUTUBE_DISCOVERY=auto`, the default). The official API is only used to fetch full details
  (title, live status, thumbnail, etc.) of videos that are actually new, and to look up a channel
  when you run `/youtube add`.
- A `/youtube add` costs **1 unit** (channel lookup) plus up to **1 unit** for the initial baseline
  check.
- Re-checking an in-progress livestream/upcoming stream costs **1 unit** per batch of up to 50 items
  (`YOUTUBE_LIVE_CHECK_INTERVAL_SECONDS`, default every 2 minutes, only while something is actually
  live/upcoming — otherwise this does nothing).

With defaults, a typical install following dozens of channels comfortably stays well under the daily
limit. If you ever do exhaust it, NotifyX detects this automatically, pauses new-item detection until
the reset, and resumes on its own — no restart needed, and no notifications are lost (only delayed).

If you'd rather never touch the feed (e.g. it's blocked on your network) and always use the official
API for discovery too, set `YOUTUBE_DISCOVERY=api` — this costs 1 extra unit per channel per poll.

---

## Database setup

NotifyX **requires PostgreSQL** (version 13+ recommended). It stores every server's configuration and
the notification queue there, so restarts never lose data or duplicate a notification.

Give it a database either as one connection string:

```env
DATABASE_URL=postgres://user:password@host:5432/notifyx
```

or as separate variables (used if `DATABASE_URL` is empty):

```env
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-password
DB_NAME=notifyx
```

If your provider requires SSL (most managed Postgres does — Neon, Supabase, Railway, RDS, etc.), set:

```env
DATABASE_SSL=true       # or: no-verify, if it uses a self-signed certificate
```

Tables are created automatically on first start (or via `npm run migrate`) — nothing to run by hand.

**Don't have a Postgres server?** The included `docker-compose.yml` runs one alongside the bot — see
[Running it → Docker](#running-it). Many hosting panels and cloud providers also offer a free/cheap
managed Postgres you can point `DATABASE_URL` at (Neon and Supabase both have generous free tiers).

---

## Environment variables

All variables are documented in **[`.env.example`](.env.example)** — copy it to `.env` and fill it
in. Quick reference of what's required vs optional:

| Variable | Required? | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | **Yes** | Your bot's token |
| `DISCORD_CLIENT_ID` | Yes (for command registration) | Your application's ID |
| `DISCORD_DEV_GUILD_ID` | No | Register commands to one server instantly, for development |
| `DATABASE_URL` or `DB_*` | **Yes** | PostgreSQL connection |
| `YOUTUBE_API_KEY` | **Yes** (to use `/youtube add`) | YouTube Data API v3 key |
| `PUBLIC_URL` | No | Enables push notifications (WebSub) instead of polling only |
| `PORT` | No (default 3000) | Health-check HTTP server port — most panels set this for you |
| everything else | No | Sensible defaults; see `.env.example` |

Hosting panels that inject environment variables through their dashboard (rather than a `.env` file)
work exactly the same way — NotifyX reads `process.env` either way, and `.env` values never override
variables the panel has already set.

---

## Running it

NotifyX always starts the same way — **`node index.js`** — on every platform below. No custom start
command, no build step.

### Docker / Docker Compose (recommended for a VPS)

```bash
cp .env.example .env    # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, YOUTUBE_API_KEY
docker compose up -d --build
```

This starts NotifyX **and** a PostgreSQL 16 container together, with a persisted volume, and waits
for the database to be healthy before starting the bot. To use your own external Postgres instead,
remove the `postgres` service from `docker-compose.yml` and set `DATABASE_URL` in `.env`.

The standalone `Dockerfile` also works on its own (e.g. for a platform that only accepts a
Dockerfile, not compose) — just make sure `DATABASE_URL` points at a reachable Postgres.

### Generic VPS (systemd, pm2, screen, tmux…)

```bash
npm install --omit=dev
npm run migrate
node index.js
```

Use your process manager of choice to keep it running and restart on crash/reboot (pm2, systemd, or
a supervisor). `start.sh` is included as a simple convenience launcher.

### Hosting panels (Pterodactyl and similar game/bot panels)

NotifyX needs no special egg or startup command beyond **`node index.js`** — the standard "Generic
Node.js" / "Application" egg works. Steps:

1. Create the application/server with a Node.js 18+ image.
2. Upload the project files (or point it at your Git repo).
3. Set the environment variables in the panel's **Startup/Variables** tab (`DISCORD_TOKEN`,
   `DATABASE_URL`, `YOUTUBE_API_KEY`, etc.) — no `.env` file is needed if the panel injects them.
4. Install command: `npm install --omit=dev`. Start command: `node index.js`.
5. Point `DATABASE_URL` at a Postgres instance reachable from the panel (many panels offer one, or
   use an external managed database).
6. If your panel assigns a port for a "web" process type, NotifyX's lightweight health server binds
   to `PORT` automatically — no configuration needed. If the panel doesn't need a health endpoint,
   set `HTTP_ENABLED=false`.

The same steps apply to NexCloud-style panels and any other generic Node.js application panel.

### Termux (Android)

```bash
pkg install nodejs-lts postgresql   # or point DATABASE_URL at a remote database instead
npm install
cp .env.example .env   # edit it
npm run migrate
node index.js
```

`start.sh` handles the `npm install` step automatically if you'd rather just run `./start.sh`.

---

## Using the bot

| Command | What it does |
|---|---|
| `/setup` | Set the server-wide default channel/category, ping role, and on/off switch |
| `/youtube add channel:<url\|@handle\|ID>` | Follow a YouTube channel. Optional: `discord_channel`, `category`, `role`, and per-event on/off |
| `/youtube remove channel:` | Stop following a channel |
| `/youtube list` | List followed channels |
| `/youtube channels` | Show where each channel's notifications are configured to post |
| `/youtube config channel: event:` | Opens an interactive panel: edit message/embed/buttons, change destination/role, **Preview**, **Send Test**, save/load as a **Template** |
| `/youtube test channel: event:` | Send a real test notification immediately |
| `/settings view` / `toggle` | View or pause/resume all notifications for the server |
| `/settings emoji set/reset/list` | Customize the emoji NotifyX uses (server emoji or Unicode) |
| `/notifications history` / `stats` / `retry` | Delivery history, a 24h summary, and re-queueing failed deliveries |
| `/help topic:` | In-Discord help, including the full list of `{placeholders}` for custom messages/embeds |

All configuration commands require the **Manage Server** Discord permission.

### Customizing messages & embeds

`/youtube config` opens a panel per notification type (new video / live / upcoming) with buttons to
edit the message text, embed (title, description, color, image, footer), and buttons — using
placeholders like `{channel}`, `{title}`, `{url}`, `{scheduled_relative}`, `{role}`, and more (full
list via `/help topic:placeholders`). Leaving a field blank keeps the default; typing `-` makes it
explicitly empty. **Save as Template** lets you design once and re-apply the exact same look to other
channels or servers with **Load Template**.

---

## How notifications work

NotifyX has two delivery paths, and it uses whichever is available automatically — you don't choose
between them per-channel, you just decide whether to set `PUBLIC_URL` (below).

### ⚡ The instant path (push) — recommended

When `PUBLIC_URL` is set, NotifyX subscribes each followed channel to YouTube's **PubSubHubbub /
WebSub** feed. The moment a video is published or a livestream's metadata changes, YouTube sends the
bot an HTTP push **containing the exact video ID** — no guessing, no re-scanning the channel. NotifyX:

1. Answers the push in milliseconds (so YouTube's hub doesn't retry).
2. Immediately fetches full details for **just that one video** (a single, cheap API call).
3. Enqueues the notification in PostgreSQL and wakes the delivery worker right away.

End-to-end, this is typically **single-digit seconds** from upload/publish to a message posted in
Discord — bounded mostly by YouTube's own push latency and Discord's API, not by anything NotifyX
waits on. This is the "we uploaded and the bot posted almost instantly" experience.

One caveat: YouTube's push reliably fires for **new uploads and metadata updates**, but doesn't
always fire for the exact moment a *scheduled* stream flips from "upcoming" to "live". That specific
transition is covered by the live-tracker below, which is why it runs on a short interval.

### The polling path (fallback / safety net)

This runs *always*, regardless of `PUBLIC_URL`, and is what you're relying on entirely if push isn't
configured:

1. A background worker checks each followed channel on a schedule (`YOUTUBE_POLL_INTERVAL_SECONDS`,
   default 5 minutes) for new uploads, using the zero-quota public feed by default. Once push is
   active for an account, this check happens far less often for it (push is doing the real work) —
   it stays as a backstop in case a push is ever missed.
2. A second, short-interval worker (`YOUTUBE_LIVE_CHECK_INTERVAL_SECONDS`, default 60s) re-checks
   only streams that are currently upcoming/live, catching the "went live" transition quickly even
   without push. It's cheap to run often because it only acts while something is actually
   upcoming/live.
3. New/changed items are fetched in full from the official API and stored.

### Either way

- A notification is **enqueued in PostgreSQL** — once per server, per event type, per item. A
  database-level uniqueness constraint makes it physically impossible to enqueue the same
  notification twice, whether it was found by push or by polling, even across a restart.
- A separate delivery worker sends queued notifications immediately (triggered the instant something
  is enqueued, not on a fixed schedule), retrying automatically on rate limits or transient
  Discord/network errors, and backing off longer on permission problems (so a missing "Send Messages"
  permission doesn't hammer Discord — fix it and `/notifications retry`, or wait for the automatic
  retry).
- If the bot restarts or the host reboots, nothing is lost: every followed channel's next check time,
  every push subscription, every stream currently being tracked, and every queued/failed notification
  are all stored in the database and simply pick up where they left off.
- When a channel is added for the first time, its **existing** recent uploads are recorded without
  notifying — only videos/streams published after that point are announced.

---

## Troubleshooting

**The bot won't start / crashes immediately.**
Check the logs — NotifyX logs a clear reason. Common causes: `DISCORD_TOKEN` missing/invalid, or the
database isn't reachable yet (NotifyX retries for about a minute before giving up; if your
Postgres container starts slower than that, increase its healthcheck's `start_period` or start it
first).

**Slash commands aren't showing up in Discord.**
Global commands can take up to **an hour** to appear after first registration (a Discord limitation).
Set `DISCORD_DEV_GUILD_ID` to a test server's ID while developing — guild commands update instantly.
If commands changed but don't seem to update, run `npm run deploy-commands` to force re-registration,
or set `COMMAND_SYNC=force` for one restart.

**`/youtube add` says monitoring isn't configured.**
`YOUTUBE_API_KEY` is missing, invalid, or the YouTube Data API v3 isn't enabled for that key's Google
Cloud project — see [YouTube API setup](#youtube-api-setup).

**I'm not getting notifications in a channel.**
Run `/youtube channels` to see where each channel is configured to post, then check the bot has
**View Channel**, **Send Messages**, and **Embed Links** there. `/notifications history` shows recent
delivery attempts and the exact error for any that failed; `/notifications retry` re-queues them
after you fix the permission.

**The role ping isn't working.**
The bot needs **Mention @everyone, @here and All Roles** to ping a role that isn't itself
"mentionable", or to ping `@everyone`/`@here`. `/youtube config` will warn you if this is missing
when you set a role.

**I hit the YouTube API quota.**
NotifyX detects this automatically, pauses new-item checks until the daily reset (midnight Pacific),
and resumes on its own — existing livestream tracking and Discord delivery are unaffected. See
[About quota](#about-quota) for how to reduce usage further if this happens often.

**Health check / `/health` returns 503.**
This means either the database isn't reachable or the bot hasn't finished connecting to Discord yet —
both resolve on their own shortly after start. If it persists, check the logs for the underlying
error.

---

## Project layout

```
index.js                     Entry point (hosting panels just run `node index.js`)
src/
  config/                     Environment variables, emoji defaults
  database/                   PostgreSQL pool, migrations, one repository module per table
  platforms/                  Platform abstraction + the YouTube implementation
    youtube/                  YouTube Data API client, feed/WebSub parsing, normalization
  services/                   Cross-cutting logic: emoji resolution, permissions, subscriptions,
                              notification preview/test, the command registry's runtime handles
  notifications/              Event detection, Discord message/embed building, the delivery worker
  workers/                    Background loops: polling, live-status tracking, cleanup
  commands/                   One file per slash command; commands/youtube/ holds the /youtube
                              config panel's internal (non-command) helper modules
  events/                     discord.js event handlers
scripts/                      migrate.js, deploy-commands.js, invite.js — run with `npm run <name>`
```

Every SQL migration lives in `src/database/migrations/`; add new ones as
`002_whatever.sql`, `003_...` — they run automatically, in order, exactly once.

## Adding another platform

The database schema and worker code are already platform-agnostic (`platform_accounts.platform`,
`content_items.kind`/`state` aren't YouTube-specific). To add Twitch, Instagram, TikTok, etc.:

1. Create `src/platforms/<name>/index.js` implementing the same interface as
   `src/platforms/youtube/index.js` (see the comment at the top of `src/platforms/index.js` for the
   exact contract: `resolveAccount`, `discover`, `fetchItems`, `eventTypes`, etc.).
2. Register it in `src/platforms/index.js`.
3. Add a slash command (copy `src/commands/youtube.js` as a starting point) that calls
   `services/subscriptions.js` with your new platform's id.

Everything else — the database, the notification queue, delivery, retries, duplicate protection,
templates, and the `/settings`/`/notifications` commands — works for any platform automatically.

---

## A note on this build

This project was written and syntax-checked in a sandboxed environment without outbound network
access, so dependencies could not be `npm install`ed or run end-to-end against a live Discord bot
token or a real PostgreSQL server here. Every file has been checked with `node --check`, and the full
module graph, command registration, notification-building, and startup/shutdown sequence were
exercised against lightweight local stand-ins for `discord.js`/`pg`/`pino` to catch wiring mistakes.
Please run `npm install` and test against a real bot token and database before deploying to
production — and open an issue (or just ask) if anything doesn't behave as documented here.


## NotifyX Ultra-Fast notifications

YouTube WebSub is the primary real-time path. WebSub POSTs are acknowledged immediately and processed without waiting for the polling loop. The notifier is event-triggered as soon as notification rows are committed, while polling remains a safety net.

Relevant tuning variables:
- `YOUTUBE_POLL_INTERVAL_SECONDS` (default `30`) — fallback polling only.
- `NOTIFIER_INITIAL_DELAY_MS` (default `500`) — startup safety-net delay.
- `NOTIFIER_INTERVAL_MS` (default `10000`) — notifier safety-net interval.
- `NOTIFIER_CONCURRENCY` (default `8`) — parallel Discord deliveries.
- `NOTIFIER_BATCH` (default `25`) — rows claimed per notifier batch.

For the fastest path, configure a public HTTPS `PUBLIC_URL` so YouTube WebSub can deliver push events directly to NotifyX.

## Cloudflare Worker relay

For the InfinityHosting deployment, NotifyX can use the Cloudflare Worker `notifyx-relay` as its public HTTPS WebSub callback. The Worker forwards `/websub/youtube` to `http://gq1.infinityhosting.online:2000/websub/youtube`.

Deploy `cloudflare-worker.js` as the code for the existing Worker. Keep `PUBLIC_URL` set to `https://notifyx-relay.harshgahlaut00.workers.dev`. Do not put Discord or YouTube API secrets in the Worker.

The Worker is only a public relay; NotifyX remains the source of truth and continues to verify the YouTube WebSub signature.
