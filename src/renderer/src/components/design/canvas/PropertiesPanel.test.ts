import { describe, expect, it } from 'vitest'
import { propertiesPanelShellClass } from './PropertiesPanel'

describe('PropertiesPanel surface layout', () => {
  it('uses a compact inspector shell on the code whiteboard', () => {
    const className = propertiesPanelShellClass('code')

    expect(className).toContain('right-[64px]')
    expect(className).toContain('top-[60px]')
    expect(className).toContain('bottom-[92px]')
    expect(className).toContain('w-[236px]')
    expect(className).toContain('max-w-[calc(100%-80px)]')
    expect(className).toContain('rounded-[14px]')
    expect(className).not.toContain('right-[76px]')
    expect(className).not.toContain('w-[252px]')
  })

  it('keeps the full canvas inspector shell on the design surface', () => {
    const className = propertiesPanelShellClass('design')

    expect(className).toContain('right-[76px]')
    expect(className).toContain('top-[72px]')
    expect(className).toContain('bottom-[104px]')
    expect(className).toContain('w-[252px]')
    expect(className).toContain('rounded-[18px]')
    expect(className).not.toContain('max-w-[calc(100%-80px)]')
  })
})
