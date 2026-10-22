/** バックエンドと共通の入力値の上限・範囲（spec.md「入力値の上限とバリデーション強化」）。 */

export const NAME_MAX_LENGTH = 32
export const MEMO_MAX_LENGTH = 1000

export const COURSE_PERIOD_MIN = 1
export const COURSE_PERIOD_MAX = 6
export const COURSE_ACADEMIC_YEAR_MIN = 2000
export const COURSE_ACADEMIC_YEAR_MAX = 2100

/**
 * 送信される値（前後の空白を除いた値）が上限文字数を超えるかを判定する。
 * バックエンド（Python）の文字数と揃えるため、UTF-16のコード単位ではなくコードポイント単位で数える。
 */
export function exceedsMaxLength(value: string, maxLength: number): boolean {
  return [...value.trim()].length > maxLength
}

/** 上限超過時のメッセージ。 */
export function maxLengthMessage(label: string, maxLength: number): string {
  return `${label}は${maxLength}文字以内で入力してください。`
}
