import { describe, expect, it } from 'vitest'

import type { InterviewStep } from './api/types'
import {
  EMPTY_INTERVIEW_STEP_FORM_VALUES,
  toInterviewStepFormValues,
  toInterviewStepInput,
  validateInterviewStepForm,
} from './interviewStepForm'
import type { InterviewStepFormValues } from './interviewStepForm'

const VALID_VALUES: InterviewStepFormValues = {
  type: '一次面接',
  date: '2026-03-01',
  prep_status: '準備万端',
  result: '未定',
  memo: 'メモ',
}

const SAMPLE_STEP: InterviewStep = {
  id: 1,
  company_id: 10,
  type: '二次面接',
  date: '2026-04-01',
  prep_status: '完了',
  result: '通過',
  memo: '合格連絡あり',
  is_deleted: false,
}

describe('validateInterviewStepForm', () => {
  it('全項目入力済みならエラーが無い', () => {
    expect(validateInterviewStepForm(VALID_VALUES)).toEqual({})
  })

  it('種別が未入力ならエラーになる', () => {
    expect(validateInterviewStepForm({ ...VALID_VALUES, type: '' })).toEqual({
      type: '選考種別を入力してください。',
    })
  })

  it('種別が空白のみならエラーになる', () => {
    expect(validateInterviewStepForm({ ...VALID_VALUES, type: '   ' })).toEqual({
      type: '選考種別を入力してください。',
    })
  })

  it('予定日が未入力でもエラーにならない（任意項目）', () => {
    expect(validateInterviewStepForm({ ...VALID_VALUES, date: '' })).toEqual({})
  })
})

describe('toInterviewStepFormValues', () => {
  it('nullなら新規追加用の初期値（準備中・未定）を返す', () => {
    expect(toInterviewStepFormValues(null)).toEqual(EMPTY_INTERVIEW_STEP_FORM_VALUES)
  })

  it('既存の選考ステップをフォームの入力値へ変換する', () => {
    expect(toInterviewStepFormValues(SAMPLE_STEP)).toEqual({
      type: '二次面接',
      date: '2026-04-01',
      prep_status: '完了',
      result: '通過',
      memo: '合格連絡あり',
    })
  })

  it('予定日・メモが未設定なら空文字に変換する', () => {
    expect(toInterviewStepFormValues({ ...SAMPLE_STEP, date: null, memo: null })).toMatchObject({
      date: '',
      memo: '',
    })
  })

  it('未知のprep_status/resultは既定値へフォールバックする', () => {
    expect(
      toInterviewStepFormValues({ ...SAMPLE_STEP, prep_status: '不明', result: '不明' }),
    ).toMatchObject({
      prep_status: '準備中',
      result: '未定',
    })
  })
})

describe('toInterviewStepInput', () => {
  it('前後の空白を取り除き、空欄の予定日・メモはnullへ変換する', () => {
    expect(
      toInterviewStepInput({
        type: '  一次面接  ',
        date: '',
        prep_status: '準備中',
        result: '未定',
        memo: '  ',
      }),
    ).toEqual({
      type: '一次面接',
      date: null,
      prep_status: '準備中',
      result: '未定',
      memo: null,
    })
  })

  it('予定日・メモが入力済みならそのまま送る', () => {
    expect(toInterviewStepInput(VALID_VALUES)).toEqual({
      type: '一次面接',
      date: '2026-03-01',
      prep_status: '準備万端',
      result: '未定',
      memo: 'メモ',
    })
  })
})
