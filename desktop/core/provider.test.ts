import { afterEach, describe, expect, test } from "bun:test"
import { z } from "zod"
import type { AgentToolBridge } from "../agent/tools"
import { DEFAULT_SETTINGS } from "./model"
import { fetchThroughPreviewProxy, OpenAICompatibleProvider, ProviderError } from "./provider"

describe("OpenAI-compatible provider", () => {
  let stopServer: (() => void) | undefined

  afterEach(() => {
    stopServer?.()
    stopServer = undefined
  })

  test("discovers models and streams a response from an OpenAI-compatible server", async () => {
    let received: { authorization: string | null; model: string } = {
      authorization: null,
      model: "",
    }

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url)
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "local-model" }] })
        }

        received = { ...received, authorization: request.headers.get("authorization") }
        const body = z.record(z.string(), z.unknown()).parse(await request.json())
        const model = body["model"]
        if (typeof model === "string") received = { ...received, model }

        return new Response(
          'data: {"choices":[{"delta":{"content":"Hallo "}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"Workshop"}}]}\n\n' +
            "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })
    stopServer = () => server.stop(true)

    const provider = new OpenAICompatibleProvider((input, init) => fetch(new Request(input, init)))
    const settings = {
      ...DEFAULT_SETTINGS,
      apiBaseUrl: `http://127.0.0.1:${server.port}/v1`,
      model: "local-model",
    }
    const models = await provider.discoverModels(settings, "test-key")
    const chunks: string[] = []

    await provider.streamChat(
      { settings, apiKey: "test-key", messages: [], signal: new AbortController().signal },
      { onChunk: (chunk) => chunks.push(chunk) },
    )

    expect(models).toEqual(["local-model"])
    expect(chunks.join("")).toBe("Hallo Workshop")
    expect(received.authorization).toBe("Bearer test-key")
    expect(received.model).toBe("local-model")
  })

  test("buffers a streaming request body when forwarding it through the browser preview proxy", async () => {
    let forwarded: Request | undefined
    const source = new Request("http://127.0.0.1:1234/v1/chat/completions?source=ui", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key" },
      body: JSON.stringify({ model: "local-model", stream: true }),
    })

    const response = await fetchThroughPreviewProxy(
      source,
      "http://127.0.0.1:1420",
      async (input, init) => {
        forwarded = new Request(input, init)
        return Response.json({ ok: true })
      },
    )

    expect(response.status).toBe(200)
    expect(forwarded?.url).toBe(
      "http://127.0.0.1:1420/__workshop_lmstudio/v1/chat/completions?source=ui",
    )
    expect(forwarded?.method).toBe("POST")
    expect(forwarded?.headers.get("authorization")).toBe("Bearer test-key")
    expect(await forwarded?.json()).toEqual({ model: "local-model", stream: true })
  })

  test("executes bounded structured tool calls and returns their result to the model", async () => {
    const requests: Array<Record<string, unknown>> = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const body = z.record(z.string(), z.unknown()).parse(await request.json())
        requests.push(body)
        if (requests.length === 1) {
          return new Response(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_list","function":{"name":"list_plugins","arguments":"{}"}}]}}]}\n\n' +
              "data: [DONE]\n\n",
            { headers: { "content-type": "text/event-stream" } },
          )
        }
        return new Response(
          'data: {"choices":[{"delta":{"content":"Demo Notes ist verfügbar."}}]}\n\n' +
            "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })
    stopServer = () => server.stop(true)
    const provider = new OpenAICompatibleProvider((input, init) => fetch(new Request(input, init)))
    const settings = {
      ...DEFAULT_SETTINGS,
      apiBaseUrl: `http://127.0.0.1:${server.port}/v1`,
      model: "local-model",
    }
    const toolResults: string[] = []
    const bridge: AgentToolBridge = {
      definitions: [
        {
          type: "function",
          function: { name: "list_plugins", description: "List plugins", parameters: {} },
        },
      ],
      execute: async (name, args) => {
        toolResults.push(`${name}:${args}`)
        return '[{"id":"demo-notes","status":"active"}]'
      },
    }
    const chunks: string[] = []

    await provider.streamChat(
      { settings, apiKey: "", messages: [], signal: new AbortController().signal },
      { onChunk: (chunk) => chunks.push(chunk), tools: bridge },
    )

    expect(toolResults).toEqual(["list_plugins:{}"])
    expect(chunks.join("")).toBe("Demo Notes ist verfügbar.")
    expect(requests).toHaveLength(2)
    expect(requests[0]?.["tools"]).toEqual(bridge.definitions)
    const messages = requests[1]?.["messages"]
    expect(messages).toEqual([
      expect.objectContaining({ role: "system" }),
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_list",
            type: "function",
            function: { name: "list_plugins", arguments: "{}" },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_list",
        content: '[{"id":"demo-notes","status":"active"}]',
      },
    ])
  })

  test("rejects streamed tool calls without an id or function name", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async () =>
        new Response(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
    })
    stopServer = () => server.stop(true)
    const provider = new OpenAICompatibleProvider((input, init) => fetch(new Request(input, init)))
    const settings = {
      ...DEFAULT_SETTINGS,
      apiBaseUrl: `http://127.0.0.1:${server.port}/v1`,
      model: "local-model",
    }
    const bridge: AgentToolBridge = { definitions: [], execute: async () => "{}" }

    const error = await provider
      .streamChat(
        { settings, apiKey: "", messages: [], signal: new AbortController().signal },
        { onChunk: () => undefined, tools: bridge },
      )
      .then(
        () => undefined,
        (reason: unknown) => reason,
      )

    expect(error).toBeInstanceOf(ProviderError)
    expect(error).toMatchObject({
      kind: "invalid",
      message: "Der KI-Server hat einen ungültigen Werkzeugaufruf gesendet.",
    })
  })
})
