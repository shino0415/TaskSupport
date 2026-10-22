import { describe, expect, it } from 'vitest'

import { isDeadlinePassed } from './assignmentDeadline'

// 基準時刻はローカル時刻で組み立て、タイムゾーン無しの提出期限と同じ解釈で比較する
const NOW = new Date(2026, 10, 1, 12, 0, 0)

describe('isDeadlinePassed', () => {
  it('基準時刻より前の期限は期限切れ', () => {
    expect(isDeadlinePassed('2026-11-01T11:59:59', NOW)).toBe(true)
    expect(isDeadlinePassed('2000-01-01T00:00:00', NOW)).toBe(true)
  })

  it('基準時刻ちょうどの期限は期限切れではない', () => {
    expect(isDeadlinePassed('2026-11-01T12:00:00', NOW)).toBe(false)
  })

  it('基準時刻より後の期限は期限切れではない', () => {
    expect(isDeadlinePassed('2026-11-01T12:00:01', NOW)).toBe(false)
    expect(isDeadlinePassed('2099-12-31T23:59:00', NOW)).toBe(false)
  })

  it('分までの値や小数秒付きの値もタイムゾーン無しの日時として比較する', () => {
    expect(isDeadlinePassed('2026-11-01T11:59', NOW)).toBe(true)
    expect(isDeadlinePassed('2026-11-01T12:00:00.500000', NOW)).toBe(false)
  })

  it('期限なし・解釈できない値は期限切れとみなさない', () => {
    expect(isDeadlinePassed(null, NOW)).toBe(false)
    expect(isDeadlinePassed('not-a-date', NOW)).toBe(false)
  })
})
