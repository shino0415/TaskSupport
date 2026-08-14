/** 企業タスクフォームの入力値とその検証・送信値への変換（描画から独立した純粋なロジック）。 */

import type { CompanyTask, CompanyTaskInput, TaskStatus } from './api/types'
import { TASK_STATUSES } from './api/types'

export type CompanyTaskFormValues = {
  name: string
  status: TaskStatus
  memo: string
}

export type CompanyTaskFormErrors = Partial<Record<keyof CompanyTaskFormValues, string>>

export const EMPTY_COMPANY_TASK_FORM_VALUES: CompanyTaskFormValues = {
  name: '',
  status: '未着手',
  memo: '',
}

/** 編集対象の企業タスクをフォームの入力値へ変換する。nullなら新規登録用の初期値。 */
export function toCompanyTaskFormValues(companyTask: CompanyTask | null): CompanyTaskFormValues {
  if (companyTask === null) {
    return EMPTY_COMPANY_TASK_FORM_VALUES
  }
  return {
    name: companyTask.name,
    // APIのstatusはstrのため、未知の値でも選択肢が壊れないように既定値へ寄せる
    status: (TASK_STATUSES as readonly string[]).includes(companyTask.status)
      ? (companyTask.status as TaskStatus)
      : '未着手',
    memo: companyTask.memo ?? '',
  }
}

/** 必須項目の未入力を検出する。エラーが無ければ空オブジェクトを返す。 */
export function validateCompanyTaskForm(values: CompanyTaskFormValues): CompanyTaskFormErrors {
  const errors: CompanyTaskFormErrors = {}
  if (values.name.trim() === '') {
    errors.name = '企業タスク名を入力してください。'
  }
  return errors
}

/** 検証済みの入力値をAPIへ送る形へ変換する。 */
export function toCompanyTaskInput(values: CompanyTaskFormValues): CompanyTaskInput {
  return {
    name: values.name.trim(),
    status: values.status,
    memo: values.memo.trim() === '' ? null : values.memo.trim(),
  }
}
