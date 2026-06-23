import { z } from 'zod'
import { SubagentProfileConfig } from '../../contracts/capabilities.js'
import type { ModelClient, ModelRequest } from '../../ports/model-client.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'

const GenerateAgentRequest = z.object({
  intent: z.string().trim().min(4).max(2_000),
  /** Optional override for the generator model. Defaults to the runtime default. */
  model: z.string().min(1).optional()
})

const META_SYSTEM_PROMPT = `You are an assistant designing reusable subagent profiles for the Kun runtime.

Given a user intent, output a single JSON object describing the profile. Required JSON shape (all keys camelCase, no markdown fences, no commentary):

{
  "name": string,
  "description": string,
  "mode": "subagent" | "primary" | "all",
  "toolPolicy": "readOnly" | "inherit",
  "systemPrompt": string,
  "promptPreamble"?: string,
  "color"?: "#RRGGBB",
  "allowedTools"?: string[]
}

Guidelines:
- "mode": "subagent" for delegated investigation agents (default), "primary" for chat personas, "all" if it makes sense in both contexts.
- "toolPolicy": prefer "readOnly" when the agent only inspects/reports; use "inherit" only when it needs to write/run shell.
- "systemPrompt" must include the persona, output style, and explicit refusal of out-of-scope edits when readOnly.
- Keep description under 120 characters.
- Output ONLY the JSON object. No prose.`

export async function generateAgentProfile(
  client: ModelClient | undefined,
  defaultModel: string | undefined,
  request: Request
): Promise<JsonResponse | Response> {
  if (!client) return ERRORS.unavailable('model client is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = GenerateAgentRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid agent generate body', parsed.error.issues)

  const model = parsed.data.model?.trim() || defaultModel
  if (!model) return ERRORS.unavailable('no default model is configured for one-shot generation')

  const abortController = new AbortController()
  // Pick up an upstream client abort so a UI cancel doesn't strand the call.
  request.signal?.addEventListener('abort', () => abortController.abort())

  const modelRequest: ModelRequest = {
    threadId: 'agent_generate_oneshot',
    turnId: 'agent_generate_oneshot',
    model,
    systemPrompt: META_SYSTEM_PROMPT,
    prefix: [],
    history: [
      {
        id: 'user_intent',
        kind: 'user_message',
        threadId: 'agent_generate_oneshot',
        turnId: 'agent_generate_oneshot',
        role: 'user',
        status: 'completed',
        text: parsed.data.intent,
        createdAt: new Date().toISOString()
      }
    ],
    tools: [],
    responseFormat: 'json_object',
    temperature: 0.2,
    maxTokens: 1_200,
    abortSignal: abortController.signal
  }

  let buffer = ''
  let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' | undefined
  let errorMessage: string | undefined
  try {
    for await (const chunk of client.stream(modelRequest)) {
      if (chunk.kind === 'assistant_text_delta') buffer += chunk.text
      else if (chunk.kind === 'completed') stopReason = chunk.stopReason
      else if (chunk.kind === 'error') errorMessage = chunk.message
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  if (errorMessage) return ERRORS.unavailable(`agent generator: ${errorMessage}`)
  if (!buffer.trim()) return ERRORS.unavailable('agent generator returned no content')
  // The model occasionally wraps JSON in fences. Strip the outer ```json block.
  const cleaned = buffer.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(cleaned)
  } catch {
    return ERRORS.unavailable(`agent generator produced invalid JSON (stopReason=${stopReason ?? 'unknown'})`)
  }

  const profile = SubagentProfileConfig.safeParse(parsedJson)
  if (!profile.success) {
    return ERRORS.validation('generated profile failed validation', profile.error.issues)
  }
  return jsonResponse({ profile: profile.data })
}
