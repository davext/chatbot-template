const API_BASE = "https://api.blooio.com/v4"

export type BlooioMessage = {
  id: string
  direction?: string
  text?: string | null
  sender?: string | null
}

type BlooioEventData = {
  message_id?: unknown
  chat_id?: unknown
  direction?: unknown
  text?: unknown
  sender?: unknown
  contact?: { identifier?: unknown }
}

export type InboundIMessage = {
  eventId: string
  messageId: string
  chatId: string
  sender: string | null
  text: string
}

export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  header: string | null,
  toleranceSeconds = 300
) {
  if (!header) return false
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const idx = kv.indexOf("=")
      return idx > 0
        ? [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()]
        : [kv.trim(), ""]
    })
  )
  const timestamp = Number(parts.t)
  const provided = parts.v1
  if (!Number.isFinite(timestamp) || !provided) return false
  if (
    toleranceSeconds > 0 &&
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds
  ) {
    return false
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  )
  const signature = hexToBytes(provided)
  if (!signature) return false
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(`${timestamp}.${rawBody}`)
  )
}

export function readInboundIMessage(event: {
  id?: unknown
  type?: unknown
  data?: unknown
}): InboundIMessage | null {
  if (event.type !== "message.received") return null
  const data = isRecord(event.data) ? (event.data as BlooioEventData) : null
  if (!data) return null
  if (typeof data.direction === "string" && data.direction !== "inbound") {
    return null
  }
  const text = typeof data.text === "string" ? data.text.trim() : ""
  const chatId = typeof data.chat_id === "string" ? data.chat_id : ""
  const messageId = typeof data.message_id === "string" ? data.message_id : ""
  const eventId = typeof event.id === "string" ? event.id : ""
  if (!text || !chatId || !messageId) return null
  return {
    eventId,
    messageId,
    chatId,
    sender: readSender(data),
    text,
  }
}

export function senderAllowed(sender: string | null) {
  const raw = process.env.BLOOIO_REPLY_ALLOWLIST?.trim()
  if (!raw) return true
  if (!sender) return false
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(sender)
}

export async function listChatMessages(apiKey: string, chatId: string) {
  const response = await blooioFetch(
    apiKey,
    `/chats/${encodeURIComponent(chatId)}/messages?limit=12&order=asc`
  )
  if (!response.ok) {
    throw new Error(`List messages failed (${response.status})`)
  }
  const body = (await response.json()) as { data?: BlooioMessage[] }
  return Array.isArray(body.data) ? body.data : []
}

export async function showTyping(apiKey: string, chatId: string) {
  await blooioFetch(apiKey, `/chats/${encodeURIComponent(chatId)}/typing`, {
    state: "started",
  })
}

export async function sendChatMessage(
  apiKey: string,
  chatId: string,
  text: string,
  idempotencyKey: string
) {
  const response = await blooioFetch(
    apiKey,
    `/chats/${encodeURIComponent(chatId)}/messages`,
    { text, format: "markdown" },
    { "Idempotency-Key": idempotencyKey }
  )
  // A webhook retry can regenerate slightly different text. The first send
  // already won; a conflicting Idempotency-Key is not a second bubble.
  if (response.status === 409) return null
  if (response.status !== 200 && response.status !== 201) {
    const detail = await response.text()
    throw new Error(`Send failed (${response.status}): ${detail.slice(0, 300)}`)
  }
  return response.json()
}

async function blooioFetch(
  apiKey: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
) {
  return fetch(`${API_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function readSender(data: BlooioEventData) {
  if (typeof data.sender === "string" && data.sender) return data.sender
  const identifier = data.contact?.identifier
  return typeof identifier === "string" && identifier ? identifier : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}
