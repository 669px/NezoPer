const fs = require("fs")
const path = require("path")

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


for (const d of [USERS, CHATS]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })

const read = p => fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""
const json = (p, d) => {
  try { return JSON.parse(read(p)) } catch { return d }
}
const save = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2))

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const STYLE_SLANG_WORDS = ["bro", "bruh", "yo", "lol", "lmao", "fr", "ngl", "btw", "idk", "u", "ur", "rn", "tbh", "pls", "plz"]


function appendToLogFile(level, msg) {
  try {
    const timestamp = new Date().toISOString()
    const logLine = `[${timestamp}] [${level}] ${msg}\n`
    fs.appendFileSync(LOG_FILE, logLine, "utf8")
  } catch (e) {

  }
}


const log = {
  info: (msg) => {
    console.log(`[INFO] ${msg}`)
    appendToLogFile("INFO", msg)
  },
  warn: (msg) => {
    console.warn(`[WARN] ${msg}`)
    appendToLogFile("WARN", msg)
  },
  error: (msg, err) => {
    const errText = err ? ` | Error: ${err.message || err}` : ""
    console.error(`[ERROR] ${msg}`, err || "")
    appendToLogFile("ERROR", `${msg}${errText}`)
  },
  success: (msg) => {
    console.log(`[SUCCESS] ${msg}`)
    appendToLogFile("SUCCESS", msg)
  },
  chat: (jid, text) => {
    const logMsg = `[${jid}] -> "${text}"`
    console.log(`[CHAT] ${logMsg}`)
    appendToLogFile("CHAT", logMsg)
  },
  reply: (jid, text) => {
    const logMsg = `[${jid}] <- "${text}"`
    console.log(`[REPLY] ${logMsg}`)
    appendToLogFile("REPLY", logMsg)
  },
  cmd: (jid, cmd) => {
    const logMsg = `[${jid}] action: ${cmd}`
    console.log(`[CMD] ${logMsg}`)
    appendToLogFile("CMD", logMsg)
  }
}


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
  process.env.REACT_TO_MESSAGES = process.env.REACT_TO_MESSAGES || "true"

  log.info("Environment configuration validated successfully.")
}


validateEnv()


const COOLDOWNS = new Map()
const RATE_LIMIT_WARNED = new Map()

function checkRateLimit(jid) {
  const now = Date.now()
  const userTimestamps = COOLDOWNS.get(jid) || []


  const recent = userTimestamps.filter(t => now - t < 10000)
  recent.push(now)
  COOLDOWNS.set(jid, recent)


  if (recent.length > 4) {
    return true
  }
  return false
}

function shouldSendWarning(jid) {
  const now = Date.now()
  const lastWarn = RATE_LIMIT_WARNED.get(jid) || 0
  if (now - lastWarn > 60000) {
    RATE_LIMIT_WARNED.set(jid, now)
    return true
  }
  return false
}


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

function clampRatio(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function weightedAverage(oldValue, newValue, samples) {
  if (!Number.isFinite(oldValue) || samples <= 1) return newValue
  const weight = Math.min(samples, 25)
  return ((oldValue * (weight - 1)) + newValue) / weight
}

function analyzeStyleSample(text) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const letters = text.match(/[a-z]/gi) || []
  const lowercaseLetters = text.match(/[a-z]/g) || []
  const uppercaseLetters = text.match(/[A-Z]/g) || []
  const slang = STYLE_SLANG_WORDS.filter(word => new RegExp(`\\b${word}\\b`, "i").test(text))

  return {
    chars: text.length,
    words: words.length,
    lowerCaseRate: letters.length ? lowercaseLetters.length / letters.length : 0,
    upperCaseRate: letters.length ? uppercaseLetters.length / letters.length : 0,
    questionRate: text.includes("?") ? 1 : 0,
    exclamationRate: text.includes("!") ? 1 : 0,
    emojiRate: /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(text) ? 1 : 0,
    slang
  }
}

function updateStyleProfile(profileData, text) {
  const sample = analyzeStyleSample(text)
  const style = profileData.style || {}
  const samples = (style.samples || 0) + 1
  const slangCounts = style.slangCounts || {}

  for (const word of sample.slang) {
    slangCounts[word] = (slangCounts[word] || 0) + 1
  }

  profileData.style = {
    samples,
    avgChars: Math.round(weightedAverage(style.avgChars, sample.chars, samples)),
    avgWords: Math.round(weightedAverage(style.avgWords, sample.words, samples)),
    lowerCaseRate: clampRatio(weightedAverage(style.lowerCaseRate, sample.lowerCaseRate, samples)),
    upperCaseRate: clampRatio(weightedAverage(style.upperCaseRate, sample.upperCaseRate, samples)),
    questionRate: clampRatio(weightedAverage(style.questionRate, sample.questionRate, samples)),
    exclamationRate: clampRatio(weightedAverage(style.exclamationRate, sample.exclamationRate, samples)),
    emojiRate: clampRatio(weightedAverage(style.emojiRate, sample.emojiRate, samples)),
    slangCounts
  }
}

function describeStyle(style = {}) {
  if (!style.samples) {
    return "No stable style profile yet. Mirror the latest message naturally and keep it human."
  }

  const length = style.avgWords <= 8 ? "usually sends short messages" :
    style.avgWords >= 28 ? "usually sends longer, more detailed messages" :
    "usually sends medium-length messages"
  const casing = style.lowerCaseRate > 0.9 && style.upperCaseRate < 0.08 ? "leans lowercase and casual" :
    style.upperCaseRate > 0.18 ? "uses more uppercase emphasis" :
    "uses normal casing"
  const punctuation = [
    style.questionRate > 0.35 ? "asks questions often" : null,
    style.exclamationRate > 0.25 ? "uses excited punctuation" : null,
    style.emojiRate > 0.2 ? "uses emojis sometimes" : null
  ].filter(Boolean).join(", ")
  const slang = Object.entries(style.slangCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word)
    .join(", ")

  return [
    `User style profile from ${style.samples} message(s): ${length}; ${casing}.`,
    punctuation ? `Signals: ${punctuation}.` : "",
    slang ? `Common casual words to mirror lightly when natural: ${slang}.` : "",
    "Match their language, pace, and directness, but make the reply clearer, warmer, and slightly smoother than the input. Do not parody them."
  ].filter(Boolean).join(" ")
}

function extractImagePrompt(text) {
  const patterns = [
    /^(?:draw|paint|sketch)\s+(.+)/i,
    /^(?:generate|create|make)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|art|drawing)\s+(?:of\s+)?(.+)/i,
    /(?:can you|could you|please)\s+(?:draw|paint|sketch)\s+(.+)/i,
    /(?:can you|could you|please)\s+(?:generate|create|make)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|art|drawing)\s+(?:of\s+)?(.+)/i
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim()
  }

  return ""
}

function detectNaturalAction(text, isOwner) {
  const normalized = text.trim()
  const lower = normalized.toLowerCase()
  const imagePrompt = extractImagePrompt(normalized)

  if (/^(help|what can you do|features|commands)$/i.test(lower)) {
    return { type: "help" }
  }

  if (/(forget|clear|reset).*(memory|chat|history|conversation)|forget everything|start fresh/i.test(lower)) {
    return { type: "clear" }
  }

  if (imagePrompt) {
    return { type: "image", args: imagePrompt }
  }

  if (isOwner) {
    const broadcast = normalized.match(/^broadcast(?:\s+this|\s+message)?[:\s]+([\s\S]+)/i)
    if (broadcast?.[1]) return { type: "broadcast", args: broadcast[1].trim() }

    const say = normalized.match(/^say[:\s]+([\s\S]+)/i)
    if (say?.[1]) return { type: "say", args: say[1].trim() }
  }

  return null
}

async function reactToIncomingMessage(sock, jid, msg, text, mediaType) {
  if (process.env.REACT_TO_MESSAGES !== "true") return

  const lower = text.toLowerCase()
  let reaction = "\uD83D\uDC4D"
  if (/\b(lol|lmao|haha|hehe|funny)\b/i.test(lower)) reaction = "\uD83D\uDE02"
  else if (/\b(sad|hurt|miss|sorry|bad day|depressed|upset)\b/i.test(lower)) reaction = "\u2764\uFE0F"
  else if (/\b(thanks|thank you|ty|appreciate)\b/i.test(lower)) reaction = "\uD83D\uDE4F"
  else if (/\b(wow|nice|great|awesome|fire|cool|crazy|insane)\b/i.test(lower)) reaction = "\uD83D\uDD25"
  else if (text.includes("?")) reaction = "\uD83D\uDC40"
  else if (mediaType) reaction = "\uD83D\uDC40"

  await sock.sendMessage(jid, { react: { text: reaction, key: msg.key } }).catch(() => {})
}


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


async function getLinkPreviews(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const urls = text.match(urlRegex)
  if (!urls || urls.length === 0) return ""

  let previewText = "\n\n[Link Previews:]"
  const targetUrls = urls.slice(0, 2)

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
    }
  }
  return previewText === "\n\n[Link Previews:]" ? "" : previewText
}

async function ai(messages) {
  const provider = (process.env.AI_PROVIDER || "featherless").toLowerCase()
  const apiKey = process.env.AI_API_KEY || process.env.FEATHERLESS_API_KEY
  const model = process.env.AI_MODEL || process.env.FEATHERLESS_MODEL
  const temperature = Number(process.env.TEMPERATURE || 0.9)
  const maxTokens = Number(process.env.MAX_TOKENS || 1000)

  if (!apiKey) {
    throw new Error("AI API Key is missing. Check environment config.")
  }

  let baseUrl = process.env.AI_BASE_URL || process.env.FEATHERLESS_BASE_URL
  if (!baseUrl) {
    if (provider === "openai") baseUrl = "https://api.openai.com/v1"
    else if (provider === "anthropic") baseUrl = "https://api.anthropic.com/v1"
    else if (provider === "gemini") baseUrl = "https://generativelanguage.googleapis.com/v1beta"
    else if (provider === "openrouter") baseUrl = "https://openrouter.ai/api/v1"
    else if (provider === "groq") baseUrl = "https://api.groq.com/openai/v1"
    else if (provider === "featherless") baseUrl = "https://api.featherless.ai/v1"
    else baseUrl = "https://api.openai.com/v1"
  }


  if (provider === "anthropic") {

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


  if (provider === "gemini") {

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


      const details = getMessageDetails(msg.message)
      let text = details.text


      if (!text.trim() && details.description) {
        text = details.description
      }

      if (!text.trim()) return


      if (checkRateLimit(jid)) {
        log.warn(`Anti-spam rate limit triggered for JID: ${jid}`)
        if (shouldSendWarning(jid)) {
          await sock.sendMessage(jid, {
            text: "*Slow Down!* You are sending messages too quickly. Please wait a bit before trying again."
          })
        }
        return
      }


      await sock.readMessages([msg.key]).catch(() => {})


      log.chat(jid, text)


      updateStats(s => s.messagesReceived++)


      const p = profile(jid)
      updateStyleProfile(p, text)




      if (jid === "status@broadcast" && process.env.IGNORE_STATUS === "true") return


      if (jid.endsWith("@broadcast") && process.env.IGNORE_BROADCASTS === "true") return


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

      await reactToIncomingMessage(sock, jid, msg, text, details.mediaType)

      const sender = msg.key.participant || msg.participant || jid
      const ownerNumber = process.env.OWNER_NUMBER || ""
      const isOwner = ownerNumber && sender.replace(/[^0-9]/g, "").includes(ownerNumber)
      const action = detectNaturalAction(text, isOwner)

      if (action) {
        log.cmd(jid, action.type)
        updateStats(s => s.commandsRun++)

        if (action.type === "help") {
          const helpText = [
            "*NezoPer can do this naturally:*",
            "- Chat and remember useful details",
            "- Match your talking style over time",
            "- React to messages",
            "- Generate images: say \"draw a futuristic city\"",
            "- Clear this chat memory: say \"forget this chat\"",
            "",
            "Owner only: say \"broadcast: your message\" or \"say: your message\"."
          ].join("\n")

          await sock.sendMessage(jid, { text: helpText })
          updateStats(s => s.repliesSent++)
          save(userFile(jid), p)
          return
        }

        if (action.type === "clear") {
          p.history = []
          p.facts = []
          save(userFile(jid), p)
          await sock.sendMessage(jid, { text: "Done, I cleared this chat memory. Fresh start." })
          updateStats(s => s.repliesSent++)
          return
        }

        if (action.type === "image") {
          await sock.sendMessage(jid, { text: "Got it, making the image now." })
          try {
            const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(action.args)}?width=1024&height=1024&nologo=true`
            await sock.sendMessage(jid, {
              image: { url: imageUrl },
              caption: `AI image\n\nPrompt: ${action.args}`
            })
            updateStats(s => {
              s.imagesGenerated++
              s.repliesSent += 2
            })
          } catch (e) {
            log.error("Image generation failed:", e)
            await sock.sendMessage(jid, { text: "Could not generate that image right now. Try again in a bit." })
            updateStats(s => s.repliesSent++)
          }
          save(userFile(jid), p)
          return
        }

        if (action.type === "broadcast") {
          await sock.sendMessage(jid, { text: "Starting broadcast to active chats." })

          const userFiles = fs.readdirSync(USERS).filter(f => f.endsWith(".json"))
          let successCount = 0
          let failCount = 0

          for (const file of userFiles) {
            try {
              const uData = json(path.join(USERS, file))
              if (uData && uData.jid && uData.jid !== jid) {
                await sock.sendMessage(uData.jid, { text: `Broadcast from Numan:\n\n${action.args}` })
                successCount++
                await sleep(1000)
              }
            } catch (e) {
              log.error(`Broadcast failed for ${file}:`, e)
              failCount++
            }
          }

          await sock.sendMessage(jid, { text: `Broadcast done. Success: ${successCount}. Failed: ${failCount}.` })
          updateStats(s => s.repliesSent += 2)
          save(userFile(jid), p)
          return
        }

        if (action.type === "say") {
          await sock.sendMessage(jid, { text: action.args })
          updateStats(s => s.repliesSent++)
          save(userFile(jid), p)
          return
        }
      }

      const personality = read(MEMORY)


      let linkPreviews = ""
      try {
        linkPreviews = await getLinkPreviews(text)
      } catch (err) {

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
        {
          role: "system",
          content: describeStyle(p.style)
        },
        ...p.history
      ]


      const reply = await ai(prompt)


      await sock.sendPresenceUpdate("composing", jid)


      const typingDelay = Math.min(4500, Math.max(1200, reply.length * 20))
      await sleep(typingDelay)


      p.history.push({ role: "assistant", content: reply })
      p.history = p.history.slice(-maxHistory)
      save(userFile(jid), p)


      await sock.sendMessage(jid, { text: reply })
      log.reply(jid, reply)


      updateStats(s => s.repliesSent++)


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


process.on("SIGINT", async () => {
  log.warn("Termination signal received. Shutting down gracefully...")
  process.exit(0)
})

process.on("SIGTERM", async () => {
  log.warn("Termination signal received. Shutting down gracefully...")
  process.exit(0)
})

start()
