import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelToolSpec } from '../ports/model-client.js'
import type {
  GuiDesignArtifactContext,
  GuiPlanContext,
  ToolCallLike,
  ToolHostContext,
  ToolProviderKind
} from '../ports/tool-host.js'

/** Terminal status exposed by the public AgentLoop turn boundary. */
export type TurnExecutionStatus = 'completed' | 'failed' | 'aborted'

/** Outcome returned by one native model round to the loop orchestrator. */
export type ModelRoundOutcome = 'continue' | 'stop' | 'failed' | 'aborted'

/** Outcome returned after the ordered tool-dispatch stage. */
export type ToolDispatchOutcome = 'continue' | 'aborted' | 'all_suppressed'

/**
 * Stable inputs shared by a prepared model/tool turn. Context preparation
 * owns populating this record; execution services only consume it.
 */
export type PreparedTurnContext = {
  threadId: string
  turnId: string
  workspace: string
  model: string
  providerId?: string
  mode: 'agent' | 'plan'
  approvalPolicy: ToolHostContext['approvalPolicy']
  sandboxMode: NonNullable<ToolHostContext['sandboxMode']>
  signal: AbortSignal
  history: readonly TurnItem[]
  tools: readonly ModelToolSpec[]
}

/** Internal boundary between the model round and ordered tool execution. */
export type ToolDispatchInput = {
  calls: ToolCallLike[]
  threadId: string
  turnId: string
  workspace: string
  threadMode?: 'agent' | 'plan'
  activePlanContext?: GuiPlanContext
  guiDesignCanvas?: boolean
  guiDesignMode?: boolean
  guiDesignArtifact?: GuiDesignArtifactContext
  modelProviderId?: string
  modelCapabilities: ModelCapabilityMetadata
  activeSkillIds: readonly string[]
  allowedToolNames?: readonly string[]
  userInputDisabled?: boolean
  imContext?: boolean
  toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
  approvalPolicy: ToolHostContext['approvalPolicy']
  sandboxMode: NonNullable<ToolHostContext['sandboxMode']>
  signal: AbortSignal
}
