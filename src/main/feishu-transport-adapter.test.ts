import { describe, expect, it, vi } from 'vitest'
import type { LarkChannel } from '@larksuiteoapi/node-sdk'
import { FeishuTransportAdapter } from './feishu-transport-adapter'

function adapter(logError = vi.fn()): FeishuTransportAdapter {
  return new FeishuTransportAdapter({
    logError,
    onMessage: vi.fn(),
    allowedFileDirs: () => []
  })
}

describe('Feishu transport adapter', () => {
  it('falls back to a plain chat message when an inbound reply fails', async () => {
    const logError = vi.fn()
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('reply permission denied'))
      .mockResolvedValueOnce({ messageId: 'om_fallback' })

    const result = await adapter(logError).send(
      { send } as unknown as LarkChannel,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      1,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true }
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: undefined, replyInThread: undefined }
    )
    expect(logError).toHaveBeenCalledWith(
      'claw-feishu',
      'Failed to send Feishu / Lark reply; falling back to plain chat message.',
      expect.objectContaining({
        channelId: 'channel_1',
        message: 'reply permission denied',
        purpose: 'agent-reply',
        replyTo: 'om_inbound',
        to: 'oc_chat_a'
      })
    )
  })

  it('preserves markdown input when retrying without reply metadata', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('reply permission denied'))
      .mockResolvedValueOnce({ messageId: 'om_fallback' })

    const result = await adapter().send(
      { send } as unknown as LarkChannel,
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: undefined, replyInThread: undefined }
    )
  })
})
