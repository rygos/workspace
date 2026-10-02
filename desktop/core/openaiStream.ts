import { StreamChunkSchema } from "./model"

export type OpenAIToolCall = {
  readonly id: string
  readonly name: string
  readonly arguments: string
}

export type OpenAIStreamResult =
  | { readonly kind: "complete"; readonly toolCalls: readonly OpenAIToolCall[] }
  | { readonly kind: "invalidToolCall" }

type ToolCallAccumulator = {
  id: string
  name: string
  arguments: string
}

export async function readOpenAIStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<OpenAIStreamResult> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let eventData: string[] = []
  const toolCalls = new Map<number, ToolCallAccumulator>()

  const emitEvent = (): void => {
    if (eventData.length === 0) return
    const line = eventData.join("\n")
    eventData = []
    if (line === "[DONE]") return
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch (error) {
      if (error instanceof SyntaxError) return
      throw error
    }
    const parsed = StreamChunkSchema.safeParse(raw)
    if (!parsed.success) return
    for (const choice of parsed.data.choices) {
      if (choice.delta?.content !== undefined) onChunk(choice.delta.content)
      for (const call of choice.delta?.tool_calls ?? []) {
        const current = toolCalls.get(call.index) ?? { id: "", name: "", arguments: "" }
        if (call.id !== undefined) current.id += call.id
        if (call.function?.name !== undefined) current.name += call.function.name
        if (call.function?.arguments !== undefined) current.arguments += call.function.arguments
        toolCalls.set(call.index, current)
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line.length === 0) {
        emitEvent()
      } else if (line.startsWith("data:")) {
        eventData.push(line.slice(5).trimStart())
      }
    }
    if (done) break
  }

  if (buffer.startsWith("data:")) eventData.push(buffer.slice(5).trimStart())
  emitEvent()
  await reader.cancel()

  const calls = [...toolCalls.values()]
  if (calls.some((call) => call.id.length === 0 || call.name.length === 0)) {
    return { kind: "invalidToolCall" }
  }
  return { kind: "complete", toolCalls: calls }
}
