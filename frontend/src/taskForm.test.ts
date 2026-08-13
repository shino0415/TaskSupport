import { describe, expect, it } from 'vitest'

import type { TaskFormValues } from './taskForm'
import { toTaskFormValues, toTaskInput, validateTaskForm } from './taskForm'

const VALID: TaskFormValues = {
  name: '要件整理',
  status: '未着手',
  memo: '',
}

describe('validateTaskForm', () => {
  it('必須項目が揃っていればエラーなし', () => {
    expect(validateTaskForm(VALID)).toEqual({})
  })

  it('タスク名が未入力（空白のみ含む）ならエラーを返す', () => {
    expect(validateTaskForm({ ...VALID, name: '' }).name).toContain('タスク名')
    expect(validateTaskForm({ ...VALID, name: '   ' }).name).toContain('タスク名')
  })

  it('メモは未入力でもエラーにしない', () => {
    expect(validateTaskForm({ ...VALID, memo: '' })).toEqual({})
  })
})

describe('toTaskFormValues', () => {
  it('新規追加（null）なら空の初期値を返す', () => {
    expect(toTaskFormValues(null)).toEqual({
      name: '',
      status: '未着手',
      memo: '',
    })
  })

  it('編集対象の値を文字列のフォーム値へ変換し、nullは空文字にする', () => {
    expect(
      toTaskFormValues({
        id: 1,
        project_id: 10,
        name: '要件整理',
        status: '処理中',
        memo: null,
        is_deleted: false,
      }),
    ).toEqual({
      name: '要件整理',
      status: '処理中',
      memo: '',
    })
  })

  it('未知のステータス値は既定値（未着手）へ寄せる', () => {
    expect(
      toTaskFormValues({
        id: 1,
        project_id: 10,
        name: '要件整理',
        status: '不明なステータス',
        memo: null,
        is_deleted: false,
      }).status,
    ).toBe('未着手')
  })
})

describe('toTaskInput', () => {
  it('未入力のメモをnullに変換する', () => {
    expect(toTaskInput(VALID)).toEqual({
      name: '要件整理',
      status: '未着手',
      memo: null,
    })
  })

  it('前後の空白を除いて送信する', () => {
    expect(toTaskInput({ ...VALID, name: '  要件整理  ', memo: '  補足  ' })).toEqual({
      name: '要件整理',
      status: '未着手',
      memo: '補足',
    })
  })
})
