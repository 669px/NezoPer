# 🤖 Numan AI WhatsApp Bot

A premium, highly interactive, and memory-capable AI companion for WhatsApp. Powered by the **Featherless AI API (Qwen-2.5)** and built with **Baileys**, this bot acts as a believable digital version of Numan, learning details about users over time and executing interactive commands.

---

## ✨ Features

- **🧠 Long-Term Facts Memory:** Automatically extracts and updates key long-term facts about people (e.g. name, work, preferences, location, relationships) from conversations and saves them.
- **💬 Natural Conversations:** Simulates typing status with dynamic typing delays based on message length, making it feel like a real human is responding.
- **⚡ Command System:** Supports interactive prefix commands (like `/draw`, `/facts`, `/stats`, `/joke`) to perform instant actions.
- **🎨 AI Image Generation:** Generate stunning AI artwork directly in chat using `/draw <prompt>` (powered by Pollinations AI, no keys needed!).
- **📢 Owner Broadcast & Controls:** Allows the owner to broadcast messages to all users (`/broadcast <message>`) and send custom messages (`/say <message>`).
- **🛡️ Smart Group/DM Filters:** Highly configurable filters to ignore broadcast statuses, only reply when mentioned in groups, or disable group replies entirely.
- **📊 Detailed Statistics:** Tracks bot performance (received/sent messages, commands executed, images generated, and system uptime).

---

## 🛠️ Commands

The bot supports command prefixes like `/`, `!`, and `.`.

| Command | Description | Permission |
| :--- | :--- | :--- |
| `/help` | Displays the help menu with available commands | Public |
| `/draw <prompt>` | Generate and send a high-quality AI image | Public |
| `/forget` / `/clear` | Clear conversation history and saved facts to start fresh | Public |
| `/broadcast <msg>` | Send a broadcast message to all active chats | 👑 Owner Only |
| `/say <msg>` | Make the bot speak a specific message in the chat | 👑 Owner Only |




---

## 📦 Project Structure

```
.
├── auth_info/             # Multi-file authentication state for WhatsApp session
├── chats/                 # Global bot data (e.g., stats.json)
├── users/                 # Chat profiles, history, and extracted facts (JID-based JSONs)
├── .env                   # Environment variables (API keys, settings)
├── main.js                # Core bot application file
├── memory.md              # AI system prompt defining Numan's personality & behavior
├── package.json           # Project dependencies
└── README.md              # This file!
```

---

## 🚀 Setup & Installation

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- A WhatsApp account (to link the bot)

### 2. Configure Environment Variables
Create or edit the `.env` file in the root directory:

```env
# --- AI Provider Configuration ---
# Choose provider: featherless | openai | anthropic | gemini | openrouter | groq | custom
AI_PROVIDER=openai

# API Credentials
AI_API_KEY=sk-proj-...your_openai_or_anthropic_or_gemini_key...
AI_MODEL=gpt-4o-mini

# Base URL override (optional, defaults automatically per provider)
# AI_BASE_URL=https://api.openai.com/v1

# --- Legacy Compatibility (Fallback) ---
# FEATHERLESS_API_KEY=your_featherless_api_key_here
# FEATHERLESS_MODEL=Qwen/Qwen2.5-7B-Instruct

# --- Bot Details ---
BOT_NAME=Numan
OWNER_NUMBER=923001234567  # Your WhatsApp phone number including country code

# --- AI Tuning ---
TEMPERATURE=0.9
MAX_TOKENS=1000
MAX_HISTORY_MESSAGES=50
MEMORY_FACT_LIMIT=100

# --- Behavior Settings ---
DM_AUTO_REPLY=true
GROUP_AUTO_REPLY=true
IGNORE_BROADCASTS=true
IGNORE_STATUS=true
```


### 3. Run and Deploy in Production

#### Option A: Run Locally (Development)
First, install dependencies:
```bash
npm install
```
Start the bot:
```bash
npm start
```
Or run with live reload for development:
```bash
npm run dev
```

#### Option B: Deploy with PM2 (Recommended for VPS/Servers)
PM2 will run the bot in the background and automatically restart it if it crashes or reaches memory limits:
```bash
# Start the bot daemon
npm run pm2:start

# View real-time logs
npm run pm2:logs

# Stop the daemon
npm run pm2:stop
```

#### Option C: Deploy with Docker (Containerized)
Build and run the container securely:
```bash
# Build image
docker build -t numan-wa-bot .

# Run container with volume mounts for persistent data
docker run -d \
  --name numan-bot \
  -v $(pwd)/auth_info:/app/auth_info \
  -v $(pwd)/users:/app/users \
  -v $(pwd)/chats:/app/chats \
  --env-file .env \
  numan-wa-bot
```

### 4. Link WhatsApp
- When running option A (or viewing logs in Option B/C), a **QR Code** will be generated in the console logs.
- Open WhatsApp on your mobile phone -> **Linked Devices** -> **Link a Device**.
- Scan the terminal QR Code.
- Once connected, the log will output `[✅ SUCCESS] Connected successfully to WhatsApp!`.

---

## 🛡️ Production Safety Measures

- **🛡️ Anti-Spam Rate Limiter:** The bot monitors user message frequencies in all chats. If a JID sends more than 4 messages in 10 seconds, it will reject further executions and issue a slow-down warning once per minute, protecting your API key from billing surges.
- **📁 Persistent File Logging:** Logs are simultaneously printed to the terminal console and appended to a persistent log file at [chats/bot.log](file:///home/numan/wp%20testing/chats/bot.log) for offline diagnostics.
- **✅ Startup Environment Validation:** Strict configuration checks on launch verify key integrity (checks key presence, falls back to default settings for max history, temperature, etc.) to prevent failures during runtime.


---

## 🧬 Memory & Fact Extraction

The bot dynamically updates its understanding of you. When a conversation occurs, the AI extracts facts and saves them under the `users/` directory.

### Example User Profile JSON:
```json
{
  "jid": "123456789@s.whatsapp.net",
  "facts": [
    "The user's name is Wahlid.",
    "The user is a software engineering student.",
    "The user likes drinking iced lattes."
  ],
  "history": [
    { "role": "user", "content": "Hi" },
    { "role": "assistant", "content": "Hey there! What's up? 🌟" }
  ]
}
```

---

## 🤝 Contributing & Customization
To customize Numan's personality, modify the instructions in [memory.md](file:///home/numan/wp%20testing/memory.md). The AI refers to this file on every message to stay in character.
