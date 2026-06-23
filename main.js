const fs = require("fs")
const path = require("path")
// Load environment variables relative to the script location
require("dotenv").config({ path: path.join(__dirname, ".env") })

const axios = require("axios")
const P = require("pino")
const qrcode = require("qrcode-terminal")
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys")

const ROOT = __dirname
const USERS = path.join(ROOT, "users")
const CHATS = path.join(ROOT, "chats")
const MEMORY = path.join(ROOT, "memory.md")
const STATS_FILE = path.join(CHATS, "stats.json")
const LOG_FILE = path.join(CHATS, "bot.log")

// Ensure essential directories exist
for (const d of [USERS, CHATS]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

const read = p => fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""
const json = (p, d) => {
  try { return JSON.parse(read(p)) } catch { return d }
}
const save = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2))

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Persistent logs writer
function appendToLogFile(level, msg) {
  try {
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] [${level}] ${msg}\n`
    fs.appendFileSync(LOG_FILE, logLine, "utf8")
  } catch (e) {
    // Ignore logging write failures silently in case of file locks
  }
}

// Enhanced logging helper
const log = {
  info: (msg) => {
    console.log(`[🤖 INFO] ${msg}`)
    appendToLogFile("INFO", msg)
  },
  warn: (msg) => {
    console.warn(`[⚠️ WARN] ${msg}`)
    appendToLogFile("WARN", msg)
  },
  error: (msg, err) => {
    const errText = err ? ` | Error: ${err.message || err}` : ""
    console.error(`[❌ ERROR] ${msg}`, err || "")
    appendToLogFile("ERROR", `${msg}${errText}`)
  },
  success: (msg) => {
    console.log(`[✅ SUCCESS] ${msg}`)
    appendToLogFile("SUCCESS", msg)
  },
  chat: (jid, text) => {
    const logMsg = `[${jid}] -> "${text}"`
    console.log(`[📬 CHAT] ${logMsg}`)
    appendToLogFile("CHAT", logMsg)
  },
  reply: (jid, text) => {
    const logMsg = `[${jid}] <- "${text}"`
    console.log(`[✉️ REPLY] ${logMsg}`)
    appendToLogFile("REPLY", logMsg)
  },
  cmd: (jid, cmd) => {
    const logMsg = `[${jid}] executed: /${cmd}`
    console.log(`[⚡ CMD] ${logMsg}`)
    appendToLogFile("CMD", logMsg)
  }
}

// Startup Environment Variables Validation
function validateEnv() {
  const apiKey = process.env.AI_API_KEY || process.env.FEATHERLESS_API_KEY
  const model = process.env.AI_MODEL || process.env.FEATHERLESS_MODEL
  
  if (!apiKey) {
    log.error("CRITICAL CONFIG ERROR: Missing AI API Key. Please configure AI_API_KEY (or FEATHERLESS_API_KEY) in your .env file.")
    process.exit(1)
  }
  if (!model) {
    log.error("CRITICAL CONFIG ERROR: Missing AI model name. Please configure AI_MODEL (or FEATHERLESS_MODEL) in your .env file.")
    process.exit(1)
  }
  
  // Set defaults for optional vars if they don't exist
  process.env.AI_PROVIDER = process.env.AI_PROVIDER || "featherless"
  process.env.BOT_NAME = process.env.BOT_NAME || "Numan"
  process.env.TEMPERATURE = process.env.TEMPERATURE || "0.9"
  process.env.MAX_TOKENS = process.env.MAX_TOKENS || "1000"
  process.env.MAX_HISTORY_MESSAGES = process.env.MAX_HISTORY_MESSAGES || "50"
  process.env.MEMORY_FACT_LIMIT = process.env.MEMORY_FACT_LIMIT || "100"
  process.env.DM_AUTO_REPLY = process.env.DM_AUTO_REPLY || "true"
  process.env.GROUP_AUTO_REPLY = process.env.GROUP_AUTO_REPLY || "true"
  process.env.IGNORE_BROADCASTS = process.env.IGNORE_BROADCASTS || "true"
  process.env.IGNORE_STATUS = process.env.IGNORE_STATUS || "true"
  
  log.info("Environment configuration validated successfully.")
}

// Run config validation
validateEnv()

// Cooldown & Anti-Spam Rate Limiter
const COOLDOWNS = new Map() // JID -> Array of timestamps
const RATE_LIMIT_WARNED = new Map() // JID -> Timestamp of last warning

function checkRateLimit(jid) {
  const now = Date.now()
  const userTimestamps = COOLDOWNS.get(jid) || []
  
  // Keep only timestamps from the last 10 seconds
  const recent = userTimestamps.filter(t => now - t < 10000)
  recent.push(now)
  COOLDOWNS.set(jid, recent)
  
  // If user sends more than 4 messages in 10 seconds, trigger limit
  if (recent.length > 4) {
    return true
  }
  return false
}

function shouldSendWarning(jid) {
  const now = Date.now()
  const lastWarn = RATE_LIMIT_WARNED.get(jid) || 0
  if (now - lastWarn > 60000) { // Limit warnings to once per minute per user/chat JID
    RATE_LIMIT_WARNED.set(jid, now)
    return true
  }
  return false
}

// User helper
function userFile(jid) {
  return path.join(USERS, `${jid.replace(/[^a-zA-Z0-9]/g, "_")}.json`)
}

function profile(jid) {
  const file = userFile(jid)
  const data = json(file, {
    jid,
    facts: [],
    style: {},
    history: []
  })
  save(file, data)
  return data
}

// Stats helpers
function getStats() {
  return json(STATS_FILE, {
    messagesReceived: 0,
    repliesSent: 0,
    commandsRun: 0,
    imagesGenerated: 0,
    startTime: Date.now()
  })
}

function updateStats(updater) {
  const current = getStats()
  updater(current)
  save(STATS_FILE, current)
}

// Web Link Preview scraper
async function getLinkPreviews(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const urls = text.match(urlRegex)
  if (!urls || urls.length === 0) return ""

  let previewText = "\n\n[Link Previews:]"
  const targetUrls = urls.slice(0, 2) // limit to first 2 URLs to avoid bloating
  
  for (const url of targetUrls) {
    try {
      const res = await axios.get(url, {
        headers: { 
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9"
        },
        timeout: 2500
      })
      
      const titleMatch = res.data.match(/<title>([^<]+)<\/title>/i)
      const descMatch = res.data.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                        res.data.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i)
      
      const title = titleMatch ? titleMatch[1].trim() : "No Title"
      const desc = descMatch ? descMatch[1].trim() : "No description available."
      
      const cleanHTML = str => str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
      
      previewText += `\n- *URL:* ${url}\n  *Title:* ${cleanHTML(title)}\n  *Description:* ${cleanHTML(desc)}`
    } catch (e) {
      // Ignore URL crawl failures silently
    }
  }
  return previewText === "\n\n[Link Previews:]" ? "" : previewText
}

// Universal AI Client (Supports OpenAI, Anthropic, Gemini, OpenRouter, Groq, Featherless, Custom)
async function ai(messages) {
  const provider = (process.env.AI_PROVIDER || "featherless").toLowerCase()
  const apiKey = process.env.AI_API_KEY || process.env.FEATHERLESS_API_KEY
  const model = process.env.AI_MODEL || process.env.FEATHERLESS_MODEL
  const temperature = Number(process.env.TEMPERATURE || 0.9)
  const maxTokens = Number(process.env.MAX_TOKENS || 1000)

  if (!apiKey) {
    throw new Error("AI API Key is missing. Check environment config.")
  }

  // Define defaults base url depending on provider
  let baseUrl = process.env.AI_BASE_URL || process.env.FEATHERLESS_BASE_URL
  if (!baseUrl) {
    if (provider === "openai") baseUrl = "https://api.openai.com/v1"
    else if (provider === "anthropic") baseUrl = "https://api.anthropic.com/v1"
    else if (provider === "gemini") baseUrl = "https://generativelanguage.googleapis.com/v1beta"
    else if (provider === "openrouter") baseUrl = "https://openrouter.ai/api/v1"
    else if (provider === "groq") baseUrl = "https://api.groq.com/openai/v1"
    else if (provider === "featherless") baseUrl = "https://api.featherless.ai/v1"
    else baseUrl = "https://api.openai.com/v1" // general fallback
  }

  // --- ANTHROPIC PROVIDER ---
  if (provider === "anthropic") {
    // Re-arrange prompt system params and strip system role from messages
    const systemPrompt = messages.filter(m => m.role === "system").map(m => m.content).join("\n")
    const formattedMessages = messages.filter(m => m.role !== "system").map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content
    }))

    const res = await axios.post(
      `${baseUrl.replace(/\/$/, "")}/messages`,
      {
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: formattedMessages
      },
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        }
      }
    )
    return res.data.content[0].text.trim()
  }

  // --- GEMINI PROVIDER ---
  if (provider === "gemini") {
    // Route through Gemini's standard OpenAI-compatible API
    let geminiUrl = baseUrl.replace(/\/$/, "")
    if (!geminiUrl.includes("/openai")) {
      geminiUrl = `${geminiUrl}/openai`
    }
    const res = await axios.post(
      `${geminiUrl}/chat/completions`,
      {
        model,
        temperature,
        max_tokens: maxTokens,
        messages
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    )
    return res.data.choices[0].message.content.trim()
  }

  // --- STANDARD OPENAI-COMPATIBLE API (OpenAI, OpenRouter, Groq, Featherless, Ollama, DeepSeek) ---
  const res = await axios.post(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      model,
      temperature,
      max_tokens: maxTokens,
      messages
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    }
  )
  return res.data.choices[0].message.content.trim()
}

// Facts memory extraction helper
async function extractFacts(jid, text, reply, currentFacts) {
  try {
    const factLimit = Number(process.env.MEMORY_FACT_LIMIT || 100)
    const prompt = [
      {
        role: "system",
        content: `You are an AI that extracts key long-term facts about a person from a conversation.
Here is the existing list of facts about this person (JID: ${jid}):
${JSON.stringify(currentFacts)}

Analyze the new message exchange below. If there are new facts (like name, age, preferences, relationship to Numan, work, location, hobbies, etc.), return a new JSON array of ALL facts (existing plus new ones, cleaned up, maximum ${factLimit}).
- Clean up duplicate or contradictory information.
- Format each fact as a complete, self-contained, descriptive sentence (e.g. "The user is a software developer", "The user's name is Alex", "The user loves coffee").
- Do not include temporary details (e.g., "they are tired today", "they are currently eating").
- If no new facts are learned, return the existing list.
Only output the JSON array of strings, nothing else.`
      },
      {
        role: "user",
        content: `User: ${text}\nNuman: ${reply}`
      }
    ]

    const resText = await ai(prompt)
    let jsonStr = resText.trim()
    // Strip markdown code blocks if present
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(json)?/, "").replace(/```$/, "").trim()
    }
    const startIdx = jsonStr.indexOf("[")
    const endIdx = jsonStr.lastIndexOf("]")
    if (startIdx !== -1 && endIdx !== -1) {
      jsonStr = jsonStr.substring(startIdx, endIdx + 1)
    }

    const newFacts = JSON.parse(jsonStr)
    if (Array.isArray(newFacts)) {
      return newFacts.filter(f => typeof f === "string" && f.trim().length > 0).slice(0, factLimit)
    }
  } catch (e) {
    log.error("Fact extraction failed:", e.message)
  }
  return currentFacts
}

// Robust message details parsing (Text + Media details)
function getMessageDetails(message) {
  if (!message) return { text: "", mediaType: null, description: "" }
  if (message.ephemeralMessage) return getMessageDetails(message.ephemeralMessage.message)
  if (message.viewOnceMessage) return getMessageDetails(message.viewOnceMessage.message)
  if (message.viewOnceMessageV2) return getMessageDetails(message.viewOnceMessageV2.message)
  if (message.documentWithCaptionMessage) return getMessageDetails(message.documentWithCaptionMessage.message)

  const text = message.conversation || message.extendedTextMessage?.text || ""
  
  if (message.imageMessage) {
    const caption = message.imageMessage.caption || ""
    return {
      text: caption,
      mediaType: "image",
      description: caption ? `[Sent an image with caption: "${caption}"]` : "[Sent an image]"
    }
  }
  if (message.videoMessage) {
    const caption = message.videoMessage.caption || ""
    return {
      text: caption,
      mediaType: "video",
      description: caption ? `[Sent a video with caption: "${caption}"]` : "[Sent a video]"
    }
  }
  if (message.audioMessage) {
    return {
      text: "",
      mediaType: "audio",
      description: message.audioMessage.ptt ? "[Sent a voice note]" : "[Sent an audio message]"
    }
  }
  if (message.stickerMessage) {
    return {
      text: "",
      mediaType: "sticker",
      description: "[Sent a sticker]"
    }
  }
  if (message.documentMessage) {
    const caption = message.documentMessage.caption || ""
    return {
      text: caption,
      mediaType: "document",
      description: `[Sent a document: "${message.documentMessage.fileName || "document"}"${caption ? ` with caption "${caption}"` : ""}]`
    }
  }
  if (message.locationMessage) {
    return {
      text: "",
      mediaType: "location",
      description: `[Sent a location: Latitude ${message.locationMessage.degreesLatitude}, Longitude ${message.locationMessage.degreesLongitude}]`
    }
  }
  if (message.contactMessage || message.contactsArrayMessage) {
    return {
      text: "",
      mediaType: "contact",
      description: "[Sent contact card(s)]"
    }
  }

  return { text, mediaType: null, description: "" }
}

async function start() {
  log.info("Starting WhatsApp bot connection...")
  
  const { state, saveCreds } = await useMultiFileAuthState("auth_info")
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  })

  // Initialize stats startTime if not already set
  updateStats(s => {
    if (!s.startTime) s.startTime = Date.now()
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    try {
      if (qr) {
        log.info("Scan this QR code to connect:")
        qrcode.generate(qr, { small: true })
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut
        log.warn(`Connection closed. Reconnecting: ${shouldReconnect}`)
        if (shouldReconnect) start()
      }

      if (connection === "open") {
        log.success("Connected successfully to WhatsApp!")
      }
    } catch (e) {
      log.error("Error handling connection update:", e)
    }
  })

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages?.[0]
      if (!msg || msg.key.fromMe) return

      const jid = msg.key.remoteJid
      const isGroup = jid.endsWith("@g.us")

      // Extract text content and media details
      const details = getMessageDetails(msg.message)
      let text = details.text
      
      // Fallback to description if there's media and no caption
      if (!text.trim() && details.description) {
        text = details.description
      }

      if (!text.trim()) return

      // Check anti-spam rate limiting
      if (checkRateLimit(jid)) {
        log.warn(`Anti-spam rate limit triggered for JID: ${jid}`)
        if (shouldSendWarning(jid)) {
          await sock.sendMessage(jid, { 
            text: "⚠️ *Slow Down!* You are sending messages too quickly. Please wait a bit before trying again." 
          })
        }
        return
      }

      // Mark the message as read (blue ticks) to show Numan is active
      await sock.readMessages([msg.key]).catch(() => {})

      // Log received message
      log.chat(jid, text)
      
      // Update statistics
      updateStats(s => s.messagesReceived++)

      // Load user profile history and global memory prompt
      const p = profile(jid)

      // Check command prefixes
      const prefixes = ["/", "!", "."]
      const matchedPrefix = prefixes.find(p => text.startsWith(p))

      if (matchedPrefix) {
        const cleanText = text.slice(matchedPrefix.length).trim()
        const spaceIdx = cleanText.indexOf(" ")
        const command = (spaceIdx === -1 ? cleanText : cleanText.substring(0, spaceIdx)).toLowerCase()
        const argsStr = spaceIdx === -1 ? "" : cleanText.substring(spaceIdx + 1).trim()
        
        const sender = msg.key.participant || msg.participant || jid
        const isOwner = sender.replace(/[^0-9]/g, "").includes(process.env.OWNER_NUMBER)

        log.cmd(jid, command)
        updateStats(s => s.commandsRun++)

        // --- CORE WHATSAPP COMMANDS HANDLERS ---
        
        // Help menu
        if (command === "help") {
          const helpText = `🤖 *Numan WhatsApp AI Bot* 🤖\n\n` +
            `🔹 \`${matchedPrefix}draw <prompt>\` - Generate and send an AI image\n` +
            `🔹 \`${matchedPrefix}clear\` / \`${matchedPrefix}forget\` - Reset memory for this chat\n\n` +
            `👑 *Owner Commands:*\n` +
            `👑 \`${matchedPrefix}broadcast <msg>\` - Broadcast to all users\n` +
            `👑 \`${matchedPrefix}say <msg>\` - Make the bot say a specific message here`
          
          await sock.sendMessage(jid, { text: helpText })
          updateStats(s => s.repliesSent++)
          return
        }

        // Clear memory command
        if (command === "forget" || command === "clear") {
          p.history = []
          p.facts = []
          save(userFile(jid), p)
          await sock.sendMessage(jid, { text: "🧹 *Memory Reset!* I have cleared all conversation history and facts for this chat. Let's start fresh!" })
          updateStats(s => s.repliesSent++)
          return
        }

        // Image generation command
        if (command === "draw" || command === "image") {
          if (!argsStr) {
            await sock.sendMessage(jid, { text: `⚠️ Please provide a prompt description! E.g. \`${matchedPrefix}draw a cute futuristic kitten\`` })
            return
          }
          await sock.sendMessage(jid, { text: "🎨 *Generating your AI image... Please wait!*" })
          try {
            const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(argsStr)}?width=1024&height=1024&nologo=true`
            updateStats(s => {
              s.imagesGenerated++
              s.repliesSent++
            })
            await sock.sendMessage(jid, {
              image: { url: imageUrl },
              caption: `🎨 *AI Generated Image*\n\n*Prompt:* ${argsStr}`
            })
          } catch (e) {
            log.error("Image generation failed:", e)
            await sock.sendMessage(jid, { text: "❌ Failed to generate the image. Please try again later." })
          }
          return
        }

        // Owner Broadcast command
        if (command === "broadcast") {
          if (!isOwner) {
            await sock.sendMessage(jid, { text: "❌ *Permission Denied:* Only the bot owner can run this command." })
            return
          }
          if (!argsStr) {
            await sock.sendMessage(jid, { text: "⚠️ Please provide a message to broadcast!" })
            return
          }
          
          await sock.sendMessage(jid, { text: "📢 *Starting broadcast to active profiles...*" })
          
          const userFiles = fs.readdirSync(USERS).filter(f => f.endsWith(".json"))
          let successCount = 0
          let failCount = 0
          
          for (const file of userFiles) {
            try {
              const uData = json(path.join(USERS, file))
              if (uData && uData.jid && uData.jid !== jid) {
                await sock.sendMessage(uData.jid, { text: `📢 *Broadcast from Numan:*\n\n${argsStr}` })
                successCount++
                await sleep(1000) // avoid WhatsApp spam rate limits
              }
            } catch (e) {
              log.error(`Broadcast failed for ${file}:`, e)
              failCount++
            }
          }
          
          await sock.sendMessage(jid, { text: `✅ *Broadcast Completed!*\n\n🟢 *Success:* ${successCount}\n🔴 *Failed:* ${failCount}` })
          updateStats(s => s.repliesSent++)
          return
        }

        // Owner Say command
        if (command === "say") {
          if (!isOwner) {
            await sock.sendMessage(jid, { text: "❌ *Permission Denied:* Only the bot owner can run this command." })
            return
          }
          if (!argsStr) {
            await sock.sendMessage(jid, { text: "⚠️ Please provide a message!" })
            return
          }
          await sock.sendMessage(jid, { text: argsStr })
          updateStats(s => s.repliesSent++)
          return
        }

        // Fallback for unknown command
        await sock.sendMessage(jid, { text: `⚠️ *Unknown command:* Type \`${matchedPrefix}help\` to see active commands.` })
        updateStats(s => s.repliesSent++)
        return
      }

      // --- CONVERSATIONAL (AI) RESPONSES ---

      // Respect IGNORE_STATUS
      if (jid === "status@broadcast" && process.env.IGNORE_STATUS === "true") return

      // Respect IGNORE_BROADCASTS
      if (jid.endsWith("@broadcast") && process.env.IGNORE_BROADCASTS === "true") return

      // Check auto-reply settings
      if (isGroup) {
        if (process.env.GROUP_AUTO_REPLY !== "true") return
        
        const botNumber = sock.user.id.split(":")[0]
        const botJid = botNumber + "@s.whatsapp.net"
        const botName = process.env.BOT_NAME || "Numan"
        
        const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
        const isMentioned = mentions.includes(botJid) ||
                            mentions.some(m => m.startsWith(botNumber)) ||
                            msg.message?.extendedTextMessage?.contextInfo?.participant === botJid ||
                            text.includes(`@${botNumber}`)
        
        const nameRegex = new RegExp(`\\b${botName}\\b`, "i")
        const mentionsName = nameRegex.test(text)
        
        if (!isMentioned && !mentionsName) return
      } else {
        if (process.env.DM_AUTO_REPLY !== "true") return
      }

      const personality = read(MEMORY)

      // Fetch web link previews if there are any URLs in the text
      let linkPreviews = ""
      try {
        linkPreviews = await getLinkPreviews(text)
      } catch (err) {
        // ignore crawl errors
      }

      const maxHistory = Number(process.env.MAX_HISTORY_MESSAGES || 50)
      p.history.push({ role: "user", content: text + linkPreviews })
      p.history = p.history.slice(-maxHistory)

      const prompt = [
        { role: "system", content: personality },
        {
          role: "system",
          content: `Known facts about this user: ${JSON.stringify(p.facts)}`
        },
        ...p.history
      ]

      // Fetch AI Response
      const reply = await ai(prompt)

      // Simulate realistic WhatsApp typing status: start composing
      await sock.sendPresenceUpdate("composing", jid)
      
      // Calculate realistic delay (approx 20ms per character)
      const typingDelay = Math.min(4500, Math.max(1200, reply.length * 20))
      await sleep(typingDelay)

      // Save reply in history
      p.history.push({ role: "assistant", content: reply })
      p.history = p.history.slice(-maxHistory)
      save(userFile(jid), p)

      // Send the response
      await sock.sendMessage(jid, { text: reply })
      log.reply(jid, reply)
      
      // Update statistics
      updateStats(s => s.repliesSent++)

      // Extract and update facts asynchronously
      extractFacts(jid, text, reply, p.facts).then(newFacts => {
        const currentP = profile(jid)
        currentP.facts = newFacts
        save(userFile(jid), currentP)
        log.info(`Facts memory updated for ${jid}`)
      }).catch(err => {
        log.error("Fact saving failed:", err)
      })

    } catch (e) {
      log.error("Error processing message:", e)
    }
  })
}

// Handle process termination gracefully
process.on("SIGINT", async () => {
  log.warn("Termination signal received. Shutting down gracefully...")
  process.exit(0)
})

process.on("SIGTERM", async () => {
  log.warn("Termination signal received. Shutting down gracefully...")
  process.exit(0)
})

start()