import type { ModelStreamChunk } from '../../ports/model-client.js'

export type PendingToolCall = {
  index?: number
  name?: string
  argumentParts: string[]
  argumentBytes: number
  argumentFragments: number
}

export type ModelStreamLimits = {
  maxBufferBytes: number
  maxFrameBytes: number
  maxTotalBytes: number
  maxFrames: number
  maxOutputBytes: number
  maxPendingToolCalls: number
  maxPendingToolArgumentBytes: number
  maxTotalPendingToolArgumentBytes: number
  maxToolArgumentFragments: number
  maxTotalToolArgumentFragments: number
  maxCompletedToolCalls: number
  maxCompletedToolArgumentBytes: number
}

export const DEFAULT_MODEL_STREAM_LIMITS: ModelStreamLimits = {
  maxBufferBytes: 20 * 1024 * 1024,
  maxFrameBytes: 16 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxFrames: 8_192,
  maxOutputBytes: 8 * 1024 * 1024,
  maxPendingToolCalls: 32,
  maxPendingToolArgumentBytes: 1 * 1024 * 1024,
  maxTotalPendingToolArgumentBytes: 4 * 1024 * 1024,
  maxToolArgumentFragments: 1_024,
  maxTotalToolArgumentFragments: 4_096,
  maxCompletedToolCalls: 32,
  maxCompletedToolArgumentBytes: 4 * 1024 * 1024
}

export class ModelStreamResourceLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelStreamResourceLimitError'
  }
}

export class ModelStreamResourceBudget {
  private totalBytes = 0
  private frames = 0
  private outputBytes = 0
  private pendingArgumentBytes = 0
  private pendingArgumentFragments = 0
  private completedToolCalls = 0
  private completedToolArgumentBytes = 0

  constructor(readonly limits: ModelStreamLimits) {}

  addInboundBytes(bytes: number): void {
    this.totalBytes += bytes
    if (this.totalBytes > this.limits.maxTotalBytes) {
      throw this.limit(`${this.limits.maxTotalBytes} total response bytes`)
    }
  }

  addFrame(bytes: number): void {
    this.frames += 1
    if (this.frames > this.limits.maxFrames) throw this.limit(`${this.limits.maxFrames} SSE frames`)
    if (bytes > this.limits.maxFrameBytes) throw this.limit(`${this.limits.maxFrameBytes} SSE frame bytes`)
  }

  pendingCall(
    pending: Map<string, PendingToolCall>,
    callId: string,
    index: number | undefined
  ): PendingToolCall {
    const existing = pending.get(callId)
    if (existing) {
      if (index !== undefined) existing.index = index
      return existing
    }
    if (pending.size >= this.limits.maxPendingToolCalls) {
      throw this.limit(`${this.limits.maxPendingToolCalls} pending tool calls`)
    }
    const created: PendingToolCall = {
      ...(index !== undefined ? { index } : {}),
      argumentParts: [], argumentBytes: 0, argumentFragments: 0
    }
    pending.set(callId, created)
    return created
  }

  bindPendingIndex(pendingByIndex: Map<number, string>, index: number, callId: string): void {
    if (!pendingByIndex.has(index) && pendingByIndex.size >= this.limits.maxPendingToolCalls) {
      throw this.limit(`${this.limits.maxPendingToolCalls} pending tool-call indexes`)
    }
    pendingByIndex.set(index, callId)
  }

  appendArguments(pending: PendingToolCall, value: string): void {
    if (!value) return
    const bytes = Buffer.byteLength(value, 'utf8')
    this.assertPendingCapacity(pending, bytes, 1)
    pending.argumentParts.push(value)
    pending.argumentBytes += bytes
    pending.argumentFragments += 1
    this.pendingArgumentBytes += bytes
    this.pendingArgumentFragments += 1
  }

  replaceArguments(pending: PendingToolCall, value: string): void {
    const bytes = value ? Buffer.byteLength(value, 'utf8') : 0
    const fragments = value ? 1 : 0
    this.assertPendingCapacity(
      pending,
      bytes - pending.argumentBytes,
      fragments - pending.argumentFragments,
      bytes,
      fragments
    )
    this.pendingArgumentBytes += bytes - pending.argumentBytes
    this.pendingArgumentFragments += fragments - pending.argumentFragments
    pending.argumentParts = value ? [value] : []
    pending.argumentBytes = bytes
    pending.argumentFragments = fragments
  }

  pendingArguments(pending: PendingToolCall): string {
    return pending.argumentParts.join('')
  }

  completeToolCall(argumentsRaw: string): void {
    const bytes = Buffer.byteLength(argumentsRaw, 'utf8')
    if (bytes > this.limits.maxPendingToolArgumentBytes) {
      throw this.limit(`${this.limits.maxPendingToolArgumentBytes} bytes for one tool argument`)
    }
    if (this.completedToolCalls + 1 > this.limits.maxCompletedToolCalls) {
      throw this.limit(`${this.limits.maxCompletedToolCalls} completed tool calls`)
    }
    if (this.completedToolArgumentBytes + bytes > this.limits.maxCompletedToolArgumentBytes) {
      throw this.limit(`${this.limits.maxCompletedToolArgumentBytes} completed tool-argument bytes`)
    }
    this.completedToolCalls += 1
    this.completedToolArgumentBytes += bytes
  }

  removePendingCall(
    pending: Map<string, PendingToolCall>,
    callId: string
  ): PendingToolCall | undefined {
    const value = pending.get(callId)
    if (!value) return undefined
    pending.delete(callId)
    this.pendingArgumentBytes -= value.argumentBytes
    this.pendingArgumentFragments -= value.argumentFragments
    return value
  }

  clearPendingCalls(pending: Map<string, PendingToolCall>): void {
    for (const callId of pending.keys()) this.removePendingCall(pending, callId)
  }

  addOutput(chunks: readonly ModelStreamChunk[]): void {
    let bytes = 0
    for (const chunk of chunks) {
      if (chunk.kind === 'assistant_text_delta' || chunk.kind === 'assistant_reasoning_delta') {
        bytes += Buffer.byteLength(chunk.text, 'utf8')
      }
    }
    if (this.outputBytes + bytes > this.limits.maxOutputBytes) {
      throw this.limit(`${this.limits.maxOutputBytes} response text and reasoning bytes`)
    }
    this.outputBytes += bytes
  }

  private assertPendingCapacity(
    pending: PendingToolCall,
    byteDelta: number,
    fragmentDelta: number,
    replacementBytes?: number,
    replacementFragments?: number
  ): void {
    const nextBytes = replacementBytes ?? pending.argumentBytes + byteDelta
    const nextFragments = replacementFragments ?? pending.argumentFragments + fragmentDelta
    if (nextBytes > this.limits.maxPendingToolArgumentBytes) {
      throw this.limit(`${this.limits.maxPendingToolArgumentBytes} bytes for one tool argument`)
    }
    if (this.pendingArgumentBytes + byteDelta > this.limits.maxTotalPendingToolArgumentBytes) {
      throw this.limit(`${this.limits.maxTotalPendingToolArgumentBytes} total pending tool-argument bytes`)
    }
    if (nextFragments > this.limits.maxToolArgumentFragments) {
      throw this.limit(`${this.limits.maxToolArgumentFragments} fragments for one tool argument`)
    }
    if (this.pendingArgumentFragments + fragmentDelta > this.limits.maxTotalToolArgumentFragments) {
      throw this.limit(`${this.limits.maxTotalToolArgumentFragments} total tool-argument fragments`)
    }
  }

  private limit(detail: string): ModelStreamResourceLimitError {
    return new ModelStreamResourceLimitError(`model stream exceeded ${detail}`)
  }
}
