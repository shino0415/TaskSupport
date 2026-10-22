import { describe, expect, it } from 'vitest'

import { formatDeadline, isDeadlinePassed } from './assignmentDeadline'

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

describe('formatDeadline', () => {
  it('M/D HH:mm 形式で表示し、月日は先頭の0を付けず時分は2桁にする', () => {
    expect(formatDeadline('2026-11-01T23:59:00')).toBe('11/1 23:59')
    expect(formatDeadline('2026-01-05T09:05:00')).toBe('1/5 09:05')
    expect(formatDeadline('2026-12-31T00:00:00')).toBe('12/31 00:00')
  })

  it('秒なし・小数秒付きの値も同じ形式にする', () => {
    expect(formatDeadline('2026-11-10T09:30')).toBe('11/10 09:30')
    expect(formatDeadline('2026-11-01T12:00:00.500000')).toBe('11/1 12:00')
  })

  it('想定外の形式はそのまま返す', () => {
    expect(formatDeadline('not-a-date')).toBe('not-a-date')
  })
})
