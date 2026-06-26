# NezoPer

A WhatsApp AI assistant built to remember user context, react naturally, adapt to each person's talking style, and handle useful actions without slash commands.

## Overview

NezoPer is a WhatsApp-based AI bot that uses chat memory, natural-language action detection, lightweight style learning, and external AI services to deliver a more human chat experience.

## Features

- **Memory storage** - preserves useful user details, preferences, and conversation facts.
- **Adaptive talking style** - learns each chat's length, tone, slang, punctuation, and energy, then replies in a smoother version of that style.
- **Message reactions** - reacts to incoming messages with context-aware WhatsApp emoji reactions.
- **Natural actions** - image generation, memory reset, help, broadcast, and say actions work from normal phrases instead of slash commands.
- **AI image generation** - produces visuals when someone asks naturally, such as "draw a futuristic city".
- **Owner tools** - broadcast announcements and send direct custom messages through natural owner-only phrases.
- **Configurable filters** - choose when the bot replies in groups, DMs, broadcasts, or status updates.
- **Activity tracking** - logs message counts, actions, image requests, and uptime.

## Natural Actions

| Phrase example | Description | Permission |
| :--- | :--- | :--- |
| `help` or `what can you do` | Show available capabilities | Public |
| `draw a neon city at night` | Generate an image from the prompt | Public |
| `make an image of a cyberpunk room` | Generate an image from the prompt | Public |
| `forget this chat` or `clear memory` | Reset memory and history for the current chat | Public |
| `broadcast: your message` | Send a message to every active chat | Owner only |
| `say: your message` | Send a custom bot message in the current conversation | Owner only |

## Project Structure

```text
.
auth_info/
chats/
users/
.env
main.js
memory.md
package.json
README.md
```

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
REACT_TO_MESSAGES=true
```

## Install and Run

```bash
npm install
npm start
```

## Development mode

```bash
npm run dev
```

## PM2 deployment

```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:stop
```

## Docker deployment

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

## WhatsApp Connection

1. Start the bot.
2. Open WhatsApp on your phone.
3. Go to Linked Devices and scan the QR code shown in the terminal.
4. Confirm the connection once the bot logs success.

## Safety and Reliability

- **Spam protection** - rate limiting prevents rapid-fire abuse and protects API usage.
- **Persistent logging** - runtime events are stored under `chats/` for debugging.
- **Startup validation** - required settings are checked before the bot begins processing messages.

## Memory and Profiles

The bot stores extracted facts, conversation history, and style data in `users/`.

Example profile:

```json
{
  "jid": "123456789@s.whatsapp.net",
  "facts": [
    "The user is a software engineering student.",
    "The user prefers iced coffee."
  ],
  "style": {
    "samples": 12,
    "avgWords": 7,
    "lowerCaseRate": 0.92,
    "slangCounts": {
      "bro": 4,
      "fr": 2
    }
  },
  "history": [
    { "role": "user", "content": "hi bro" },
    { "role": "assistant", "content": "yo bro, what we fixing today?" }
  ]
}
```

## Customization

Edit `memory.md` to change NezoPer's tone, behavior, and instruction profile. The bot uses this file as its system prompt for every incoming message.
