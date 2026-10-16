# NotifyX

**Automated YouTube notifications for Discord.**

NotifyX is a Discord bot designed to monitor YouTube channels and notify your Discord servers when new videos are uploaded, livestreams begin, or upcoming streams are scheduled.

One bot. Multiple servers. Custom notifications.

---

## Features

- **YouTube Monitoring** — Track YouTube channels and receive video and livestream notifications.
- **Multi-Server Support** — Configure notifications independently for each Discord server.
- **Slash Commands** — Manage settings directly inside Discord.
- **Custom Notifications** — Customize embeds, messages, images, footers, buttons, and role mentions.
- **Channel Management** — Choose destination channels and organize notifications.
- **Notification History** — Review delivery history and retry failed notifications.
- **Persistent Storage** — Store server settings and notification queues in PostgreSQL.
- **Reliable Delivery** — Automatic retries and duplicate protection.
- **Docker Support** — Deploy using Docker where supported.
- **Flexible Hosting** — Run on a VPS, Node.js hosting panel, or Termux.
- **YouTube API Integration** — Retrieve channel and video information using YouTube Data API v3.

## Technology Stack

- Node.js
- Discord.js
- YouTube Data API v3
- PostgreSQL
- Docker and Docker Compose (optional)

## Repository Structure

```text
NotifyX/
├── cloudflare-worker.js
├── index.js
├── package.json
└── notifyx/
    ├── index.js
    ├── package.json
    ├── .env.example
    ├── Dockerfile
    ├── docker-compose.yml
    ├── start.sh
    └── README.md
```

## Requirements

- Node.js 18.17.0 or newer
- A Discord application and bot token
- A YouTube Data API v3 key
- PostgreSQL 13 or newer
- Git (for cloning the repository)

Docker is optional.

## Installation

Clone the repository:

```bash
git clone https://github.com/harshgahlaut00-blip/NotifyX.git
cd NotifyX/notifyx
```

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Edit `.env` and configure the required credentials and database connection.

## Configuration

Configure these environment variables in your `.env` file or hosting panel:

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_CLIENT_ID` | Discord application ID |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `DATABASE_URL` | PostgreSQL connection string |
| `PUBLIC_URL` | Optional public URL for YouTube push notifications |
| `PORT` | Optional HTTP server port |

See [`notifyx/.env.example`](notifyx/.env.example) for the complete configuration options.

**Security:** Never commit `.env` files, bot tokens, API keys, database passwords, or other secrets to GitHub.

## Running NotifyX

From the `notifyx` directory:

```bash
npm start
```

Equivalent command:

```bash
node index.js
```

To register slash commands manually:

```bash
npm run deploy-commands
```

For development:

```bash
npm run dev
```

Make sure PostgreSQL is configured and accessible before starting the bot.

## Docker Deployment

The project includes a `Dockerfile` and `docker-compose.yml`.

From the `notifyx` directory, configure your `.env` file and run:

```bash
docker compose up -d --build
```

Review the Docker configuration and environment variables before deploying.

## Discord Commands

Examples of supported commands include:

| Command | Purpose |
|---|---|
| `/setup` | Configure server notification defaults |
| `/youtube add` | Add a YouTube channel to monitor |
| `/youtube remove` | Stop monitoring a channel |
| `/youtube list` | List followed channels |
| `/youtube config` | Customize notification settings |
| `/youtube test` | Test a notification |
| `/notifications history` | Review notification history |
| `/notifications stats` | View delivery statistics |
| `/notifications retry` | Retry failed notifications |
| `/help` | Access bot help |

Command options may require additional parameters. Use Discord's slash-command interface for the available options.

## Documentation

For detailed setup instructions, database configuration, environment variables, notification behavior, hosting, and troubleshooting, see the [NotifyX documentation](notifyx/README.md).

## Troubleshooting

- **Bot won't start:** Verify the environment variables and database connection.
- **Commands are missing:** Check command registration and Discord permissions.
- **Notifications aren't delivered:** Check destination-channel permissions and notification history.
- **YouTube monitoring fails:** Verify your API key and enable YouTube Data API v3.
- **Database errors:** Verify PostgreSQL credentials, connectivity, and SSL settings.

Consult the detailed documentation for more troubleshooting steps.

## Contributing

Contributions, bug reports, and suggestions are welcome. Please test changes before submitting a pull request.

## License

The NotifyX package declares the MIT license. See the project files for the applicable license terms.

---

**NotifyX — Never miss a YouTube upload or livestream.**
