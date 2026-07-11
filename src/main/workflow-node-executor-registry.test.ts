import { describe, expect, it } from 'vitest'
import type { WorkflowNodeV1 } from '../shared/app-settings'
import { createWorkflowNodeExecutorRegistry } from './workflow-node-executor-registry'

describe('workflow node executor registry', () => {
  it('registers every persisted workflow node kind exactly once', () => {
    const registry = createWorkflowNodeExecutorRegistry<string>()
    const expected: WorkflowNodeV1['type'][] = [
      'manual-trigger', 'schedule-trigger', 'webhook-trigger', 'ai-agent', 'generate-image',
      'parameter-extractor', 'question-classifier', 'condition', 'switch', 'filter', 'merge',
      'subworkflow', 'loop', 'human-approval', 'set-fields', 'sort', 'limit', 'aggregate',
      'template', 'json', 'output', 'code', 'http-request', 'delay', 'custom'
    ]
    expect(new Set(registry.registeredKinds())).toEqual(new Set(expected))
  })

  it('dispatches through the registered family adapter', async () => {
    const registry = createWorkflowNodeExecutorRegistry<string>()
    const node = { type: 'delay' } as WorkflowNodeV1
    await expect(registry.execute(node, {
      executeAdapter: async (candidate) => `ran:${candidate.type}`
    })).resolves.toBe('ran:delay')
  })
})
