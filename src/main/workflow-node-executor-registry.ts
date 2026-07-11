import type { WorkflowNodeV1 } from '../shared/app-settings'

export type WorkflowNodeKind = WorkflowNodeV1['type']
export type WorkflowNodeExecutorContext<TOutcome> = {
  executeAdapter: (node: WorkflowNodeV1) => Promise<TOutcome>
}
export type WorkflowNodeExecutor<TOutcome> = (
  node: WorkflowNodeV1,
  context: WorkflowNodeExecutorContext<TOutcome>
) => Promise<TOutcome>

export class WorkflowNodeExecutorRegistry<TOutcome> {
  private readonly executors = new Map<WorkflowNodeKind, WorkflowNodeExecutor<TOutcome>>()

  registerFamily(
    kinds: readonly WorkflowNodeKind[],
    executor: WorkflowNodeExecutor<TOutcome>
  ): this {
    for (const kind of kinds) {
      if (this.executors.has(kind)) throw new Error(`Workflow node executor already registered: ${kind}`)
      this.executors.set(kind, executor)
    }
    return this
  }

  execute(
    node: WorkflowNodeV1,
    context: WorkflowNodeExecutorContext<TOutcome>
  ): Promise<TOutcome> {
    const executor = this.executors.get(node.type)
    if (!executor) throw new Error(`Workflow node executor is not registered: ${node.type}`)
    return executor(node, context)
  }

  registeredKinds(): WorkflowNodeKind[] {
    return [...this.executors.keys()]
  }
}

const TRIGGER_KINDS = ['manual-trigger', 'schedule-trigger', 'webhook-trigger'] as const
const AI_KINDS = ['ai-agent', 'generate-image', 'parameter-extractor', 'question-classifier'] as const
const FLOW_KINDS = ['condition', 'switch', 'filter', 'merge', 'subworkflow', 'loop', 'human-approval'] as const
const TRANSFORM_KINDS = ['set-fields', 'sort', 'limit', 'aggregate', 'template', 'json', 'output', 'code'] as const
const INTEGRATION_KINDS = ['http-request', 'delay', 'custom'] as const

/** Registers explicit node-family adapters while the facade supplies I/O dependencies. */
export function createWorkflowNodeExecutorRegistry<TOutcome>(): WorkflowNodeExecutorRegistry<TOutcome> {
  const registry = new WorkflowNodeExecutorRegistry<TOutcome>()
  const adapter: WorkflowNodeExecutor<TOutcome> = (node, context) => context.executeAdapter(node)
  return registry
    .registerFamily(TRIGGER_KINDS, adapter)
    .registerFamily(AI_KINDS, adapter)
    .registerFamily(FLOW_KINDS, adapter)
    .registerFamily(TRANSFORM_KINDS, adapter)
    .registerFamily(INTEGRATION_KINDS, adapter)
}
