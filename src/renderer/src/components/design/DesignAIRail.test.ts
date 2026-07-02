import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { DesignAIRail } from './DesignAIRail'
import { DesignTargetToggle } from './DesignTargetToggle'

type DesignAIRailProps = ComponentProps<typeof DesignAIRail>

function props(overrides: Partial<DesignAIRailProps> = {}): DesignAIRailProps {
  return {
    input: '',
    setInput: () => {},
    mode: 'agent',
    setMode: () => {},
    busy: false,
    runtimeConnection: 'ready',
    activeThreadId: null,
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    composerModel: 'deepseek-chat',
    composerPickList: ['deepseek-chat'],
    composerReasoningEffort: 'auto',
    setComposerModel: () => {},
    setComposerReasoningEffort: () => {},
    queuedMessages: [],
    removeQueuedMessage: () => {},
    onSend: () => {},
    onInterrupt: () => {},
    onRetryConnection: () => {},
    onOpenSettings: () => {},
    onNewConversation: () => {},
    designThreads: [],
    onSwitchThread: () => {},
    onCollapse: () => {},
    ...overrides
  }
}

beforeEach(() => {
  useDesignWorkspaceStore.setState({
    workspaceRoot: '/tmp/kun-design',
    artifacts: [],
    activeArtifactId: null,
    designContext: { designTarget: 'web' },
    pagesRun: null,
    multiPageMode: false
  })
})

describe('DesignAIRail target toggle', () => {
  it('shows the design target toggle with Web selected by default', () => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props()))

    expect(html).toContain('Choose whether the design agent defaults to web pages or mobile app screens')
    expect(html).toContain('aria-label="Web: Default 1280 x 800 web frame"')
    expect(html).toContain('aria-label="App: Default 390 x 844 app frame"')
    expect(html).toContain('Agent context')
    expect(html).toContain('aria-label="Agent context: Web - Default 1280 x 800 web frame"')
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?Web<\/button>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>[\s\S]*?App<\/button>/)
  })

  it('reflects the selected App target and locks switching while busy', () => {
    const html = renderToStaticMarkup(
      createElement(DesignTargetToggle, {
        designTarget: 'app',
        disabled: true,
        disabledReason: 'Design target switching is locked while the design agent is working',
        onChange: () => {}
      })
    )

    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*disabled=""[^>]*>[\s\S]*?Web<\/button>/)
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*disabled=""[^>]*>[\s\S]*?App<\/button>/)
    expect(html).toContain('aria-label="Design target switching is locked while the design agent is working"')
    expect(html).toContain(
      'aria-label="App: Default 390 x 844 app frame. Design target switching is locked while the design agent is working"'
    )
    expect(html).toContain(
      'title="Default 390 x 844 app frame. Design target switching is locked while the design agent is working"'
    )
  })

  it('explains why the rail target switch is disabled while the agent is busy', () => {
    const html = renderToStaticMarkup(createElement(DesignAIRail, props({ busy: true })))

    expect(html).toContain('Design target switching is locked while the design agent is working')
    expect(html).toContain(
      'aria-label="Web: Default 1280 x 800 web frame. Design target switching is locked while the design agent is working"'
    )
  })
})
