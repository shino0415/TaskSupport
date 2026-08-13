import { describe, expect, it } from 'vitest'

import type { ProjectFormValues } from './projectForm'
import { toProjectFormValues, toProjectInput, validateProjectForm } from './projectForm'

const VALID: ProjectFormValues = {
  name: 'LP制作',
  client_name: '株式会社テスト',
  status: '提案中',
  reward: '50000',
  applied_date: '2026-08-10',
  deadline: '',
  platform: 'CrowdWorks',
  memo: '',
}

describe('validateProjectForm', () => {
  it('必須項目が揃っていればエラーなし', () => {
    expect(validateProjectForm(VALID)).toEqual({})
  })

  it('必須項目が未入力（空白のみを含む）なら項目ごとのメッセージを返す', () => {
    const errors = validateProjectForm({
      ...VALID,
      name: '   ',
      client_name: '',
      reward: '',
      applied_date: '',
      platform: ' ',
    })

    expect(Object.keys(errors).sort()).toEqual(
      ['applied_date', 'client_name', 'name', 'platform', 'reward'].sort(),
    )
    expect(errors.name).toContain('案件名')
    expect(errors.applied_date).toContain('応募日')
  })

  it('報酬額が整数でなければ形式エラーにする', () => {
    expect(validateProjectForm({ ...VALID, reward: '1000.5' }).reward).toContain('整数')
    expect(validateProjectForm({ ...VALID, reward: 'abc' }).reward).toContain('整数')
    expect(validateProjectForm({ ...VALID, reward: '-100' })).toEqual({})
  })

  it('納期・メモは未入力でもエラーにしない', () => {
    expect(validateProjectForm({ ...VALID, deadline: '', memo: '' })).toEqual({})
  })
})

describe('toProjectFormValues', () => {
  it('新規登録（null）なら空の初期値を返す', () => {
    expect(toProjectFormValues(null)).toEqual({
      name: '',
      client_name: '',
      status: '提案中',
      reward: '',
      applied_date: '',
      deadline: '',
      platform: '',
      memo: '',
    })
  })

  it('編集対象の値を文字列のフォーム値へ変換し、nullは空文字にする', () => {
    expect(
      toProjectFormValues({
        id: 1,
        name: 'LP制作',
        client_name: '株式会社テスト',
        status: '契約中',
        reward: 50000,
        applied_date: '2026-08-10',
        deadline: null,
        platform: 'CrowdWorks',
        memo: null,
        is_deleted: false,
      }),
    ).toEqual({
      name: 'LP制作',
      client_name: '株式会社テスト',
      status: '契約中',
      reward: '50000',
      applied_date: '2026-08-10',
      deadline: '',
      platform: 'CrowdWorks',
      memo: '',
    })
  })
})

describe('toProjectInput', () => {
  it('報酬額を数値に、未入力の納期・メモをnullに変換する', () => {
    expect(toProjectInput(VALID)).toEqual({
      name: 'LP制作',
      client_name: '株式会社テスト',
      status: '提案中',
      reward: 50000,
      applied_date: '2026-08-10',
      deadline: null,
      platform: 'CrowdWorks',
      memo: null,
    })
  })

  it('前後の空白を除いて送信する', () => {
    expect(toProjectInput({ ...VALID, name: '  LP制作  ', memo: '  補足  ' })).toMatchObject({
      name: 'LP制作',
      memo: '補足',
    })
  })
})
