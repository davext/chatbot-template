import { generateText, isStepCount, type ModelMessage } from "ai"

import type { BlooioMessage } from "@/lib/blooio"
import { DEFAULT_MODEL } from "@/lib/models"
import { getIMessageTools } from "@/tools"

const SYSTEM = `You are replying inside iMessage. Write a short text message.
You may use **bold**, *italic*, ++underline++, and ~~strikethrough~~.
Do not use headings, bullet lists, or code blocks.`

export function transcriptToMessages(
  inboundText: string,
  history: BlooioMessage[]
): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (const message of history) {
    const text = message.text?.trim()
    if (!text) continue
    messages.push({
      role: message.direction === "outbound" ? "assistant" : "user",
      content: text,
    })
  }

  const last = messages.at(-1)
  if (!last || last.role !== "user" || last.content !== inboundText) {
    messages.push({ role: "user", content: inboundText })
  }
  return messages
}

export async function replyToIMessage(
  inboundText: string,
  history: BlooioMessage[]
) {
  const result = await generateText({
    model: DEFAULT_MODEL,
    system: SYSTEM,
    messages: transcriptToMessages(inboundText, history),
    tools: getIMessageTools(DEFAULT_MODEL),
    stopWhen: isStepCount(5),
    maxOutputTokens: 1024,
  })
  const text = result.text.trim()
  if (!text) {
    throw new Error("The model returned an empty iMessage reply.")
  }
  return text
}
