import { z } from "zod"

export const DevelopmentModeSchema = z.enum(["safe", "normal", "autonomous"])

export const SettingsSchema = z.object({
  apiBaseUrl: z
    .string()
    .url()
    .max(2048)
    .refine((value) => {
      const url = new URL(value)
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.username.length === 0 &&
        url.password.length === 0 &&
        url.hash.length === 0
      )
    }, "Verwende eine HTTP- oder HTTPS-Adresse ohne eingebettete Zugangsdaten."),
  model: z.string().trim().max(240),
  temperature: z.number().min(0).max(2),
  timeoutMs: z.number().int().min(5_000).max(180_000),
  developmentMode: DevelopmentModeSchema,
  stagedRepairAttemptLimit: z.number().int().min(0).max(3).default(1),
  pluginFailureThreshold: z.number().int().min(2).max(10).default(3),
  pluginFailureWindowMs: z
    .number()
    .int()
    .refine((value) => [300_000, 900_000, 1_800_000, 3_600_000, 7_200_000].includes(value))
    .default(1_800_000),
  pluginFailureCooldownMs: z
    .number()
    .int()
    .refine((value) => [300_000, 900_000, 1_800_000, 3_600_000, 7_200_000].includes(value))
    .default(1_800_000),
})

export type DevelopmentMode = z.infer<typeof DevelopmentModeSchema>
export type Settings = z.infer<typeof SettingsSchema>

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(100_000),
  createdAt: z.string().datetime(),
})

export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const AppStateSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  settings: SettingsSchema,
  messages: z.array(ChatMessageSchema).max(200).default([]),
  workspaceRoot: z.string().max(4096).nullable().default(null),
  railWidth: z.number().int().min(300).max(520).default(360),
  railCollapsed: z.boolean().default(false),
})

export type AppState = z.infer<typeof AppStateSchema>

export const DEFAULT_SETTINGS = {
  apiBaseUrl: "http://127.0.0.1:1234/v1",
  model: "",
  temperature: 0.7,
  timeoutMs: 60_000,
  developmentMode: "normal",
  stagedRepairAttemptLimit: 1,
  pluginFailureThreshold: 3,
  pluginFailureWindowMs: 1_800_000,
  pluginFailureCooldownMs: 1_800_000,
} satisfies Settings

export const DEFAULT_APP_STATE = {
  schemaVersion: 1,
  settings: DEFAULT_SETTINGS,
  messages: [],
  workspaceRoot: null,
  railWidth: 360,
  railCollapsed: false,
} satisfies AppState

export const ModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) }).passthrough()),
})

export const StreamChunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z
        .object({
          content: z.string().optional(),
          tool_calls: z
            .array(
              z.object({
                index: z.number().int().nonnegative(),
                id: z.string().optional(),
                function: z
                  .object({
                    name: z.string().optional(),
                    arguments: z.string().optional(),
                  })
                  .optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    }),
  ),
})

export function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return ChatMessageSchema.parse({
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  })
}
