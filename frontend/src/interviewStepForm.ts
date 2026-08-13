/** 選考ステップフォームの入力値とその検証・送信値への変換（描画から独立した純粋なロジック）。 */

import type {
  InterviewStep,
  InterviewStepInput,
  InterviewStepPrepStatus,
  InterviewStepResult,
} from './api/types'
import { INTERVIEW_STEP_PREP_STATUSES, INTERVIEW_STEP_RESULTS } from './api/types'

/** フォームの入力値。予定日は入力途中の状態を扱えるよう文字列（空文字は未設定）で保持する。 */
export type InterviewStepFormValues = {
  type: string
  date: string
  prep_status: InterviewStepPrepStatus
  result: InterviewStepResult
  memo: string
}

export type InterviewStepFormErrors = Partial<Record<keyof InterviewStepFormValues, string>>

// 新規追加される選考ステップは常にグラフの起点（準備中・未定）から始まる
// のが自然なため、バックエンドのInterviewStepCreateの既定値と合わせる。
export const EMPTY_INTERVIEW_STEP_FORM_VALUES: InterviewStepFormValues = {
  type: '',
  date: '',
  prep_status: '準備中',
  result: '未定',
  memo: '',
}

/** 編集対象の選考ステップをフォームの入力値へ変換する。nullなら新規追加用の初期値。 */
export function toInterviewStepFormValues(step: InterviewStep | null): InterviewStepFormValues {
  if (step === null) {
    return EMPTY_INTERVIEW_STEP_FORM_VALUES
  }
  return {
    type: step.type,
    date: step.date ?? '',
    // APIのprep_status/resultはstrのため、未知の値でも選択肢が壊れないように既定値へ寄せる
    prep_status: (INTERVIEW_STEP_PREP_STATUSES as readonly string[]).includes(step.prep_status)
      ? (step.prep_status as InterviewStepPrepStatus)
      : '準備中',
    result: (INTERVIEW_STEP_RESULTS as readonly string[]).includes(step.result)
      ? (step.result as InterviewStepResult)
      : '未定',
    memo: step.memo ?? '',
  }
}

/** 必須項目の未入力を検出する。エラーが無ければ空オブジェクトを返す。 */
export function validateInterviewStepForm(
  values: InterviewStepFormValues,
): InterviewStepFormErrors {
  const errors: InterviewStepFormErrors = {}
  if (values.type.trim() === '') {
    errors.type = '選考種別を入力してください。'
  }
  return errors
}

/** 検証済みの入力値をAPIへ送る形へ変換する。予定日の空欄はnull（未設定）として送る。 */
export function toInterviewStepInput(values: InterviewStepFormValues): InterviewStepInput {
  return {
    type: values.type.trim(),
    date: values.date === '' ? null : values.date,
    prep_status: values.prep_status,
    result: values.result,
    memo: values.memo.trim() === '' ? null : values.memo.trim(),
  }
}
