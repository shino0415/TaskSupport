import { describe, expect, it } from 'vitest'

import type { CompanyTaskFormValues } from './companyTaskForm'
import { toCompanyTaskFormValues, toCompanyTaskInput, validateCompanyTaskForm } from './companyTaskForm'

const VALID: CompanyTaskFormValues = {
  name: '職務経歴書更新',
  status: '未着手',
  memo: '',
}

describe('validateCompanyTaskForm', () => {
  it('必須項目が揃っていればエラーなし', () => {
    expect(validateCompanyTaskForm(VALID)).toEqual({})
  })

  it('タスク名が未入力（空白のみ含む）ならエラーを返す', () => {
    expect(validateCompanyTaskForm({ ...VALID, name: '' }).name).toContain('タスク名')
    expect(validateCompanyTaskForm({ ...VALID, name: '   ' }).name).toContain('タスク名')
  })

  it('メモは未入力でもエラーにしない', () => {
    expect(validateCompanyTaskForm({ ...VALID, memo: '' })).toEqual({})
  })
})

describe('toCompanyTaskFormValues', () => {
  it('新規追加（null）なら空の初期値を返す', () => {
    expect(toCompanyTaskFormValues(null)).toEqual({
      name: '',
      status: '未着手',
      memo: '',
    })
  })

  it('編集対象の値を文字列のフォーム値へ変換し、nullは空文字にする', () => {
    expect(
      toCompanyTaskFormValues({
        id: 1,
        company_id: 10,
        name: '職務経歴書更新',
        status: '処理中',
        memo: null,
        is_deleted: false,
      }),
    ).toEqual({
      name: '職務経歴書更新',
      status: '処理中',
      memo: '',
    })
  })

  it('未知のステータス値は既定値（未着手）へ寄せる', () => {
    expect(
      toCompanyTaskFormValues({
        id: 1,
        company_id: 10,
        name: '職務経歴書更新',
        status: '不明なステータス',
        memo: null,
        is_deleted: false,
      }).status,
    ).toBe('未着手')
  })
})

describe('toCompanyTaskInput', () => {
  it('未入力のメモをnullに変換する', () => {
    expect(toCompanyTaskInput(VALID)).toEqual({
      name: '職務経歴書更新',
      status: '未着手',
      memo: null,
    })
  })

  it('前後の空白を除いて送信する', () => {
    expect(toCompanyTaskInput({ ...VALID, name: '  職務経歴書更新  ', memo: '  補足  ' })).toEqual({
      name: '職務経歴書更新',
      status: '未着手',
      memo: '補足',
    })
  })
})
