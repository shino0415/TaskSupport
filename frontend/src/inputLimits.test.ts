import { describe, expect, it } from 'vitest'

import { exceedsMaxLength, maxLengthMessage } from './inputLimits'

describe('exceedsMaxLength', () => {
  it('上限ちょうどは超過ではなく、1文字でも超えると超過', () => {
    expect(exceedsMaxLength('あ'.repeat(32), 32)).toBe(false)
    expect(exceedsMaxLength('あ'.repeat(33), 32)).toBe(true)
  })

  it('送信時と同じく前後の空白を除いて数える', () => {
    expect(exceedsMaxLength(`  ${'a'.repeat(32)}  `, 32)).toBe(false)
  })

  it('サロゲートペアの文字も1文字として数える（バックエンドの文字数と揃える）', () => {
    expect(exceedsMaxLength('😀'.repeat(32), 32)).toBe(false)
    expect(exceedsMaxLength('😀'.repeat(33), 32)).toBe(true)
  })
})

describe('maxLengthMessage', () => {
  it('項目名と上限を含むメッセージを返す', () => {
    expect(maxLengthMessage('授業名', 32)).toBe('授業名は32文字以内で入力してください。')
  })
})
