/** 企業登録フォームの入力値とその検証・送信値への変換（描画から独立した純粋なロジック）。
 *
 * 企業には更新エンドポイントが無い（POST/GET/DELETEのみ）ため、編集用の変換は無い。
 */

import type { CompanyInput } from './api/types'
import { NAME_MAX_LENGTH, exceedsMaxLength, maxLengthMessage } from './inputLimits'

export type CompanyFormValues = {
  name: string
}

export type CompanyFormErrors = Partial<Record<keyof CompanyFormValues, string>>

export const EMPTY_COMPANY_FORM_VALUES: CompanyFormValues = {
  name: '',
}

/** 必須項目の未入力・上限超過を検出する。エラーが無ければ空オブジェクトを返す。 */
export function validateCompanyForm(values: CompanyFormValues): CompanyFormErrors {
  const errors: CompanyFormErrors = {}
  if (values.name.trim() === '') {
    errors.name = '企業名を入力してください。'
  } else if (exceedsMaxLength(values.name, NAME_MAX_LENGTH)) {
    errors.name = maxLengthMessage('企業名', NAME_MAX_LENGTH)
  }
  return errors
}

/** 検証済みの入力値をAPIへ送る形へ変換する。 */
export function toCompanyInput(values: CompanyFormValues): CompanyInput {
  return {
    name: values.name.trim(),
  }
}
