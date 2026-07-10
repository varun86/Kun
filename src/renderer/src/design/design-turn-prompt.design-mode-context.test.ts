import { describe, expect, it } from 'vitest'
import { buildDesignTurnPrompt } from './design-turn-prompt'

describe('design turn prompt design mode context', () => {
  it('routes single-screen and complete multi-screen requests without a forced workflow', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: '做一套完整 CRM，包括登录、工作台、客户详情和设置',
      artifactRelativePath: '.kun-design/doc/board.canvas.json',
      workspaceRoot: '/workspace'
    })

    expect(prompt).toContain('BUILD A SINGLE SCREEN')
    expect(prompt).toContain('BUILD A COMPLETE MULTI-SCREEN EXPERIENCE')
    expect(prompt).toContain('one `design_create_screen` call with a `screens` array')
    expect(prompt).toContain('ask one concise question with `user_input`')
    expect(prompt).toContain('prefer the fewest calls')
    expect(prompt).not.toContain('Design mode workflow contract:')
    expect(prompt).not.toContain('Suggested tool call: design.plan')
    expect(prompt).not.toContain('design.ops')
    expect(prompt).not.toContain('MANY focused calls')
    expect(prompt).not.toContain('Reply with a short plain-text plan')
  })

  it('keeps the design-mode workflow contract out of the code whiteboard prompt', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'Sketch an API flow',
      artifactRelativePath: '.kun-design/doc/board.canvas.json',
      workspaceRoot: '/workspace',
      canvasSurface: 'code'
    })

    expect(prompt).not.toContain('Design mode workflow contract:')
    expect(prompt).not.toContain('BUILD A COMPLETE MULTI-SCREEN EXPERIENCE')
    expect(prompt).toContain('Code sidebar whiteboard')
  })
})
