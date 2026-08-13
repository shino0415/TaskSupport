/** 案件フォームの入力値とその検証・送信値への変換（描画から独立した純粋なロジック）。 */

import type { Project, ProjectInput, ProjectStatus } from './api/types'
import { PROJECT_STATUSES } from './api/types'

/** フォームの入力値。数値・日付も入力途中の状態を扱えるよう文字列で保持する。 */
export type ProjectFormValues = {
  name: string
  client_name: string
  status: ProjectStatus
  reward: string
  applied_date: string
  deadline: string
  platform: string
  memo: string
}

export type ProjectFormErrors = Partial<Record<keyof ProjectFormValues, string>>

export const EMPTY_PROJECT_FORM_VALUES: ProjectFormValues = {
  name: '',
  client_name: '',
  status: '提案中',
  reward: '',
  applied_date: '',
  deadline: '',
  platform: '',
  memo: '',
}

/** 編集対象の案件をフォームの入力値へ変換する。nullなら新規登録用の初期値。 */
export function toProjectFormValues(project: Project | null): ProjectFormValues {
  if (project === null) {
    return EMPTY_PROJECT_FORM_VALUES
  }
  return {
    name: project.name,
    client_name: project.client_name,
    // APIのstatusはstrのため、未知の値でも選択肢が壊れないように既定値へ寄せる
    status: (PROJECT_STATUSES as readonly string[]).includes(project.status)
      ? (project.status as ProjectStatus)
      : '提案中',
    reward: String(project.reward),
    applied_date: project.applied_date,
    deadline: project.deadline ?? '',
    platform: project.platform,
    memo: project.memo ?? '',
  }
}

/** 必須項目の未入力・形式不正を検出する。エラーが無ければ空オブジェクトを返す。 */
export function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {}
  if (values.name.trim() === '') {
    errors.name = '案件名を入力してください。'
  }
  if (values.client_name.trim() === '') {
    errors.client_name = 'クライアント名を入力してください。'
  }
  if (values.reward.trim() === '') {
    errors.reward = '報酬額を入力してください。'
  } else if (!/^-?\d+$/.test(values.reward.trim())) {
    errors.reward = '報酬額は整数で入力してください。'
  }
  if (values.applied_date === '') {
    errors.applied_date = '応募日を入力してください。'
  }
  if (values.platform.trim() === '') {
    errors.platform = 'プラットフォームを入力してください。'
  }
  return errors
}

/** 検証済みの入力値をAPIへ送る形へ変換する。 */
export function toProjectInput(values: ProjectFormValues): ProjectInput {
  return {
    name: values.name.trim(),
    client_name: values.client_name.trim(),
    status: values.status,
    reward: Number(values.reward.trim()),
    applied_date: values.applied_date,
    deadline: values.deadline === '' ? null : values.deadline,
    platform: values.platform.trim(),
    memo: values.memo.trim() === '' ? null : values.memo.trim(),
  }
}
