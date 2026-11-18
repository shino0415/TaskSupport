import { describe, expect, it } from 'vitest'

import { formatNextStep } from './companyNextStep'

describe('次回選考の表示', () => {
  it('予定日があれば「種別（M/D）」で、月日の先頭の0は付けない', () => {
    expect(formatNextStep({ id: 1, type: '二次面接', date: '2026-11-25' })).toBe('二次面接（11/25）')
    expect(formatNextStep({ id: 1, type: '一次面接', date: '2026-03-01' })).toBe('一次面接（3/1）')
  })

  it('予定日が無ければ日付未定と示す', () => {
    expect(formatNextStep({ id: 1, type: '最終面接', date: null })).toBe('最終面接（日付未定）')
  })

  it('次回のステップが無ければ「—」', () => {
    expect(formatNextStep(null)).toBe('—')
  })

  it('想定外の形式の予定日はそのまま出す', () => {
    expect(formatNextStep({ id: 1, type: '面談', date: '2026/11/25' })).toBe('面談（2026/11/25）')
  })
})
