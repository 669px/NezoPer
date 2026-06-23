# /NezoPer

A WhatsApp AI assistant built to remember user context, run smart commands, and deliver richer responses.

---

## Overview

/NezoPer is a WhatsApp-based AI bot that uses chat memory, command handling, and external AI services to deliver a more intelligent and interactive experience.

---

## Features

- **Memory storage** — preserves useful user details, preferences, and conversation facts.
- **Natural chat flow** — emulates realistic typing delays and responsive dialogue.
- **Command support** — handles bot commands with prefixes such as `/`, `!`, and `.`.
- **AI image generation** — produces visuals on demand from chat prompts.
- **Owner tools** — broadcast announcements, send direct replies, and manage bot behavior.
- **Configurable filters** — choose when the bot replies in groups, DMs, or status updates.
- **Activity tracking** — logs message counts, command usage, image requests, and uptime.

---

## Commands

| Command | Description | Permission |
| :--- | :--- | :--- |
| `/help` | Show the command list and usage details | Public |
| `/draw <prompt>` | Generate an image from the prompt | Public |
| `/forget` / `/clear` | Reset chat memory and history for the current chat | Public |
| `/broadcast <msg>` | Send a message to every active chat | Owner only |
| `/say <msg>` | Send a custom bot message in the current conversation | Owner only |

---

## Project Structure

```
.
├── auth_info/          # WhatsApp authentication state files
├── chats/              # Runtime data and logs
├── users/              # Saved user profiles and facts
├── .env                # Environment variables and secrets
├── main.js             # Bot entry point and behavior logic
├── memory.md           # AI personality and instruction prompt
├── package.json        # Project metadata and dependencies
└── README.md           # Project documentation
```

---

## Setup

### Prerequisites
- Node.js v16 or newer
- A WhatsApp account to link with the bot

### Environment Configuration
Create a `.env` file at the project root:

```env
AI_PROVIDER=openai
AI_API_KEY=sk-...your-key...
AI_MODEL=gpt-4o-mini

# Optional override
# AI_BASE_URL=https://api.openai.com/v1

BOT_NAME=NezoPer
OWNER_NUMBER=923001234567

TEMPERATURE=0.9
MAX_TOKENS=1000
MAX_HISTORY_MESSAGES=50
MEMORY_FACT_LIMIT=100

DM_AUTO_REPLY=true
GROUP_AUTO_REPLY=true
IGNORE_BROADCASTS=true
IGNORE_STATUS=true
```

### Install and Run

```bash
npm install
npm start
```

### Development mode

```bash
npm run dev
```

### PM2 deployment

```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:stop
```

### Docker deployment

```bash
docker build -t nezoper .
docker run -d \
  --name nezoper \
  -v $(pwd)/auth_info:/app/auth_info \
  -v $(pwd)/users:/app/users \
  -v $(pwd)/chats:/app/chats \
  --env-file .env \
  nezoper
```

---

## WhatsApp Connection

1. Start the bot.
2. Open WhatsApp on your phone.
3. Go to Linked Devices and scan the QR code shown in the terminal.
4. Confirm the connection once the bot logs success.

---

## Safety and Reliability

- **Spam protection** — rate limiting prevents rapid-fire abuse and protects API usage.
- **Persistent logging** — runtime events are stored under `chats/` for debugging.
- **Startup validation** — required settings are checked before the bot begins processing messages.

---

## Memory and Profiles

The bot stores extracted facts and conversation history in `users/`.

Example profile:

```json
{
  "jid": "123456789@s.whatsapp.net",
  "facts": [
    "The user is a software engineering student.",
    "The user prefers iced coffee."
  ],
  "history": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hello! How can I help today?" }
  ]
}
```

---

## Customization

Edit `memory.md` to change NezoPer's tone, behavior, and instruction profile. The bot uses this file as its system prompt for every incoming message.
