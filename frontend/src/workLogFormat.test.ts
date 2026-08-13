import { describe, expect, it } from 'vitest'

import { formatHourlyRate, formatTotalWorkHours, formatWorkLogDuration } from './workLogFormat'

describe('formatWorkLogDuration', () => {
  it('終了時刻が未設定なら「進行中」を返す', () => {
    expect(formatWorkLogDuration('2026-08-13T10:00:00', null)).toBe('進行中')
  })

  it('開始・終了とも設定済みなら経過時間を時分で返す', () => {
    expect(formatWorkLogDuration('2026-08-13T10:00:00', '2026-08-13T11:30:00')).toBe('1時間30分')
  })

  it('経過時間が1時間未満でも0時間台として返す', () => {
    expect(formatWorkLogDuration('2026-08-13T10:00:00', '2026-08-13T10:15:00')).toBe('0時間15分')
  })

  it('開始時刻が未設定（想定外データ）なら - を返す', () => {
    expect(formatWorkLogDuration(null, '2026-08-13T11:30:00')).toBe('-')
  })

  it('終了時刻が開始時刻より前（想定外データ）なら - を返す', () => {
    expect(formatWorkLogDuration('2026-08-13T11:00:00', '2026-08-13T10:00:00')).toBe('-')
  })
})

describe('formatHourlyRate', () => {
  it('nullなら算出できない旨のメッセージを返す', () => {
    expect(formatHourlyRate(null)).toBe('時給を算出できません（稼働実績がありません）。')
  })

  it('数値なら四捨五入して円/時の表記で返す', () => {
    expect(formatHourlyRate(5000)).toBe('5,000 円/時')
  })

  it('小数の時給は四捨五入して表示する', () => {
    expect(formatHourlyRate(3333.33)).toBe('3,333 円/時')
  })
})

describe('formatTotalWorkHours', () => {
  it('合計稼働時間を「時間」付きで表示する', () => {
    expect(formatTotalWorkHours(2.5)).toBe('2.5 時間')
  })

  it('0時間でもエラーにならず表示できる', () => {
    expect(formatTotalWorkHours(0)).toBe('0 時間')
  })
})
