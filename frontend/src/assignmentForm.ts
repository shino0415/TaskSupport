/** 課題フォームの入力値とその検証・送信値への変換（描画から独立した純粋なロジック）。 */

import type {
  Assignment,
  AssignmentInput,
  AssignmentStatus,
  AssignmentSubmissionMethod,
} from './api/types'
import { ASSIGNMENT_STATUSES, ASSIGNMENT_SUBMISSION_METHODS } from './api/types'

/** フォームの入力値。提出期限はdatetime-local入力の値（空文字は未設定）、選択式の未設定は空文字。 */
export type AssignmentFormValues = {
  name: string
  status: AssignmentStatus
  deadline: string
  submission_method: AssignmentSubmissionMethod | ''
  memo: string
}

export type AssignmentFormErrors = Partial<Record<keyof AssignmentFormValues, string>>

// 新規課題は常にグラフの起点から始まるのが自然なため、バックエンドのAssignmentCreateの既定値と合わせる。
export const EMPTY_ASSIGNMENT_FORM_VALUES: AssignmentFormValues = {
  name: '',
  status: '未着手',
  deadline: '',
  submission_method: '',
  memo: '',
}

// APIはタイムゾーン無しの日時のみ受け付ける（オフセット付きは422）ため、オフセットを含まない形に限定する。
const LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/** APIの日時をdatetime-local入力の値へ変換する。秒が0なら分までにし、それ以外は秒まで残す。 */
function toLocalDateTimeInputValue(deadline: string): string {
  const withoutFraction = deadline.split('.')[0]
  return withoutFraction.length === 19 && withoutFraction.endsWith(':00')
    ? withoutFraction.slice(0, 16)
    : withoutFraction
}

/** 編集対象の課題をフォームの入力値へ変換する。nullなら新規追加用の初期値。 */
export function toAssignmentFormValues(assignment: Assignment | null): AssignmentFormValues {
  if (assignment === null) {
    return EMPTY_ASSIGNMENT_FORM_VALUES
  }
  return {
    name: assignment.name,
    // APIの値はstrのため、未知の値でも選択肢が壊れないように既定値（未設定）へ寄せる
    status: (ASSIGNMENT_STATUSES as readonly string[]).includes(assignment.status)
      ? (assignment.status as AssignmentStatus)
      : '未着手',
    deadline: assignment.deadline === null ? '' : toLocalDateTimeInputValue(assignment.deadline),
    submission_method: (ASSIGNMENT_SUBMISSION_METHODS as readonly string[]).includes(
      assignment.submission_method ?? '',
    )
      ? (assignment.submission_method as AssignmentSubmissionMethod)
      : '',
    memo: assignment.memo ?? '',
  }
}

/** 必須項目の未入力・形式不正を検出する。エラーが無ければ空オブジェクトを返す。 */
export function validateAssignmentForm(values: AssignmentFormValues): AssignmentFormErrors {
  const errors: AssignmentFormErrors = {}
  if (values.name.trim() === '') {
    errors.name = '課題名を入力してください。'
  }
  if (values.deadline !== '' && !LOCAL_DATETIME_PATTERN.test(values.deadline)) {
    errors.deadline = '提出期限は日付と時刻を入力してください。'
  }
  return errors
}

/** 検証済みの入力値をAPIへ送る形へ変換する。未入力の任意項目はnullにする。 */
export function toAssignmentInput(values: AssignmentFormValues): AssignmentInput {
  const memo = values.memo.trim()
  return {
    name: values.name.trim(),
    status: values.status,
    deadline: values.deadline === '' ? null : values.deadline,
    submission_method: values.submission_method === '' ? null : values.submission_method,
    memo: memo === '' ? null : memo,
  }
}
