import { after } from "next/server"

import {
  listChatMessages,
  readInboundIMessage,
  sendChatMessage,
  senderAllowed,
  showTyping,
  verifyWebhookSignature,
} from "@/lib/blooio"
import { replyToIMessage } from "@/lib/imessage-reply"

export const maxDuration = 30

// Blooio aborts a webhook delivery after 15 seconds. Acknowledge first, then
// generate and send. A retry of the same inbound message reuses its id as the
// Idempotency-Key, so a second delivery does not send a second bubble.
export async function POST(req: Request) {
  const apiKey = process.env.BLOOIO_API_KEY
  const secret = process.env.BLOOIO_WEBHOOK_SECRET
  if (!apiKey || !secret) {
    return Response.json(
      { error: "Blooio is not configured." },
      { status: 503 }
    )
  }

  const rawBody = await req.text()
  const valid = await verifyWebhookSignature(
    secret,
    rawBody,
    req.headers.get("x-blooio-signature")
  )
  if (!valid) {
    return Response.json({ error: "Invalid signature." }, { status: 401 })
  }

  let event: unknown
  try {
    event = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }
  if (!event || typeof event !== "object") {
    return Response.json({ error: "Invalid event." }, { status: 400 })
  }

  const inbound = readInboundIMessage(
    event as { type?: unknown; data?: unknown; id?: unknown }
  )
  if (!inbound || !senderAllowed(inbound.sender)) {
    return Response.json({ ok: true, ignored: true })
  }

  after(async () => {
    const history = await listChatMessages(apiKey, inbound.chatId).catch(
      () => []
    )
    await showTyping(apiKey, inbound.chatId).catch(() => undefined)
    const text = await replyToIMessage(inbound.text, history)
    await sendChatMessage(
      apiKey,
      inbound.chatId,
      text,
      `imsg-${inbound.messageId}`
    )
  })

  return Response.json({ ok: true })
}
