/** タスクフォームの入力値とその検証・送信値への変換（描画から独立した純粋なロジック）。 */

import type { Task, TaskInput, TaskStatus } from './api/types'
import { TASK_STATUSES } from './api/types'

export type TaskFormValues = {
  name: string
  status: TaskStatus
  memo: string
}

export type TaskFormErrors = Partial<Record<keyof TaskFormValues, string>>

export const EMPTY_TASK_FORM_VALUES: TaskFormValues = {
  name: '',
  status: '未着手',
  memo: '',
}

/** 編集対象のタスクをフォームの入力値へ変換する。nullなら新規登録用の初期値。 */
export function toTaskFormValues(task: Task | null): TaskFormValues {
  if (task === null) {
    return EMPTY_TASK_FORM_VALUES
  }
  return {
    name: task.name,
    // APIのstatusはstrのため、未知の値でも選択肢が壊れないように既定値へ寄せる
    status: (TASK_STATUSES as readonly string[]).includes(task.status)
      ? (task.status as TaskStatus)
      : '未着手',
    memo: task.memo ?? '',
  }
}

/** 必須項目の未入力を検出する。エラーが無ければ空オブジェクトを返す。 */
export function validateTaskForm(values: TaskFormValues): TaskFormErrors {
  const errors: TaskFormErrors = {}
  if (values.name.trim() === '') {
    errors.name = 'タスク名を入力してください。'
  }
  return errors
}

/** 検証済みの入力値をAPIへ送る形へ変換する。 */
export function toTaskInput(values: TaskFormValues): TaskInput {
  return {
    name: values.name.trim(),
    status: values.status,
    memo: values.memo.trim() === '' ? null : values.memo.trim(),
  }
}
