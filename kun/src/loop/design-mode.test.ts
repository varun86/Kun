import { describe, expect, it } from 'vitest'
import { DESIGN_MODE_INSTRUCTION } from './design-mode.js'

describe('DESIGN_MODE_INSTRUCTION', () => {
  it('defines intent-aware single-screen, multi-screen, edit, and ambiguity behavior', () => {
    expect(DESIGN_MODE_INSTRUCTION).toContain('SINGLE SCREEN')
    expect(DESIGN_MODE_INSTRUCTION).toContain('COMPLETE MULTI-SCREEN EXPERIENCE')
    expect(DESIGN_MODE_INSTRUCTION).toContain('MODIFY EXISTING DESIGN')
    expect(DESIGN_MODE_INSTRUCTION).toContain('screens` array')
    expect(DESIGN_MODE_INSTRUCTION).toContain('ask one concise question through `user_input`')
    expect(DESIGN_MODE_INSTRUCTION).toContain('fewest calls')
    expect(DESIGN_MODE_INSTRUCTION).not.toContain('design.plan')
    expect(DESIGN_MODE_INSTRUCTION).not.toContain('MANY focused calls')
  })
})
