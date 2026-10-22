import { describe, expect, it } from 'vitest'

import type { Assignment } from './api/types'
import type { AssignmentFormValues } from './assignmentForm'
import {
  toAssignmentFormValues,
  toAssignmentInput,
  validateAssignmentForm,
} from './assignmentForm'

const VALID: AssignmentFormValues = {
  name: '正規化レポート',
  status: '未着手',
  deadline: '',
  submission_method: '',
  memo: '',
}

const ASSIGNMENT: Assignment = {
  id: 1,
  course_id: 10,
  name: '正規化レポート',
  status: '取組中',
  deadline: '2026-11-01T23:59:00',
  submission_method: 'WebClass',
  memo: 'A4で2枚',
  is_deleted: false,
}

describe('validateAssignmentForm', () => {
  it('必須項目が揃っていればエラーなし（任意項目は未入力でよい）', () => {
    expect(validateAssignmentForm(VALID)).toEqual({})
  })

  it('課題名が未入力（空白のみ含む）ならエラーを返す', () => {
    expect(validateAssignmentForm({ ...VALID, name: '' }).name).toContain('課題名')
    expect(validateAssignmentForm({ ...VALID, name: '   ' }).name).toContain('課題名')
  })

  it('提出期限は日付と時刻（秒は任意）の形式なら受け付ける', () => {
    expect(validateAssignmentForm({ ...VALID, deadline: '2026-11-01T23:59' })).toEqual({})
    expect(validateAssignmentForm({ ...VALID, deadline: '2026-11-01T23:59:30' })).toEqual({})
  })

  it('時刻の無い日付やタイムゾーン付きの提出期限はエラーを返す', () => {
    expect(validateAssignmentForm({ ...VALID, deadline: '2026-11-01' }).deadline).toBeDefined()
    expect(
      validateAssignmentForm({ ...VALID, deadline: '2026-11-01T23:59:00+09:00' }).deadline,
    ).toBeDefined()
    expect(
      validateAssignmentForm({ ...VALID, deadline: '2026-11-01T23:59:00Z' }).deadline,
    ).toBeDefined()
  })
})

describe('toAssignmentFormValues', () => {
  it('新規追加（null）なら未着手・未設定の初期値を返す', () => {
    expect(toAssignmentFormValues(null)).toEqual({
      name: '',
      status: '未着手',
      deadline: '',
      submission_method: '',
      memo: '',
    })
  })

  it('編集対象の値をフォーム値へ変換し、秒が0の提出期限は分までにする', () => {
    expect(toAssignmentFormValues(ASSIGNMENT)).toEqual({
      name: '正規化レポート',
      status: '取組中',
      deadline: '2026-11-01T23:59',
      submission_method: 'WebClass',
      memo: 'A4で2枚',
    })
  })

  it('秒が0でない提出期限は秒まで残し、小数秒は落とす', () => {
    expect(toAssignmentFormValues({ ...ASSIGNMENT, deadline: '2026-11-01T23:59:30' }).deadline).toBe(
      '2026-11-01T23:59:30',
    )
    expect(
      toAssignmentFormValues({ ...ASSIGNMENT, deadline: '2026-11-01T23:59:00.123456' }).deadline,
    ).toBe('2026-11-01T23:59')
  })

  it('nullの任意項目は空文字にし、未知のステータス・提出方法は既定値へ寄せる', () => {
    expect(
      toAssignmentFormValues({
        ...ASSIGNMENT,
        status: '不明なステータス',
        deadline: null,
        submission_method: 'メール',
        memo: null,
      }),
    ).toEqual({
      name: '正規化レポート',
      status: '未着手',
      deadline: '',
      submission_method: '',
      memo: '',
    })
  })
})

describe('toAssignmentInput', () => {
  it('未入力の任意項目をnullに変換する', () => {
    expect(toAssignmentInput(VALID)).toEqual({
      name: '正規化レポート',
      status: '未着手',
      deadline: null,
      submission_method: null,
      memo: null,
    })
  })

  it('入力された値を送信形式に変換し、前後の空白を除く', () => {
    expect(
      toAssignmentInput({
        name: '  正規化レポート  ',
        status: '提出済み',
        deadline: '2026-11-01T23:59',
        submission_method: '紙',
        memo: '  補足  ',
      }),
    ).toEqual({
      name: '正規化レポート',
      status: '提出済み',
      deadline: '2026-11-01T23:59',
      submission_method: '紙',
      memo: '補足',
    })
  })
})
