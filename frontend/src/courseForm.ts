/** 授業フォームの入力値とその検証・送信値への変換（描画から独立した純粋なロジック）。 */

import type { Course, CourseDayOfWeek, CourseInput, CourseTerm } from './api/types'
import { COURSE_DAYS_OF_WEEK, COURSE_TERMS } from './api/types'
import {
  COURSE_ACADEMIC_YEAR_MAX,
  COURSE_ACADEMIC_YEAR_MIN,
  COURSE_PERIOD_MAX,
  COURSE_PERIOD_MIN,
  MEMO_MAX_LENGTH,
  NAME_MAX_LENGTH,
  exceedsMaxLength,
  maxLengthMessage,
} from './inputLimits'

/** フォームの入力値。選択式の未設定は空文字、数値は入力途中の状態を扱えるよう文字列で保持する。 */
export type CourseFormValues = {
  name: string
  day_of_week: CourseDayOfWeek | ''
  period: string
  academic_year: string
  term: CourseTerm | ''
  memo: string
}

export type CourseFormErrors = Partial<Record<keyof CourseFormValues, string>>

export const EMPTY_COURSE_FORM_VALUES: CourseFormValues = {
  name: '',
  day_of_week: '',
  period: '',
  academic_year: '',
  term: '',
  memo: '',
}

const INTEGER_PATTERN = /^-?\d+$/

/** 編集対象の授業をフォームの入力値へ変換する。nullなら新規登録用の初期値。 */
export function toCourseFormValues(course: Course | null): CourseFormValues {
  if (course === null) {
    return EMPTY_COURSE_FORM_VALUES
  }
  return {
    name: course.name,
    // APIの値はstrのため、未知の値でも選択肢が壊れないよう未設定扱いにする
    day_of_week: (COURSE_DAYS_OF_WEEK as readonly string[]).includes(course.day_of_week ?? '')
      ? (course.day_of_week as CourseDayOfWeek)
      : '',
    period: course.period === null ? '' : String(course.period),
    academic_year: course.academic_year === null ? '' : String(course.academic_year),
    term: (COURSE_TERMS as readonly string[]).includes(course.term ?? '')
      ? (course.term as CourseTerm)
      : '',
    memo: course.memo ?? '',
  }
}

function isIntegerInRange(value: string, min: number, max: number): boolean {
  return INTEGER_PATTERN.test(value) && Number(value) >= min && Number(value) <= max
}

/** 必須項目の未入力・形式不正・上限超過・範囲外を検出する。エラーが無ければ空オブジェクトを返す。 */
export function validateCourseForm(values: CourseFormValues): CourseFormErrors {
  const errors: CourseFormErrors = {}
  if (values.name.trim() === '') {
    errors.name = '授業名を入力してください。'
  } else if (exceedsMaxLength(values.name, NAME_MAX_LENGTH)) {
    errors.name = maxLengthMessage('授業名', NAME_MAX_LENGTH)
  }
  const period = values.period.trim()
  if (period !== '' && !isIntegerInRange(period, COURSE_PERIOD_MIN, COURSE_PERIOD_MAX)) {
    errors.period = `時限は${COURSE_PERIOD_MIN}〜${COURSE_PERIOD_MAX}の整数で入力してください。`
  }
  const academicYear = values.academic_year.trim()
  if (
    academicYear !== '' &&
    !isIntegerInRange(academicYear, COURSE_ACADEMIC_YEAR_MIN, COURSE_ACADEMIC_YEAR_MAX)
  ) {
    errors.academic_year = `年度は${COURSE_ACADEMIC_YEAR_MIN}〜${COURSE_ACADEMIC_YEAR_MAX}の整数で入力してください。`
  }
  if (exceedsMaxLength(values.memo, MEMO_MAX_LENGTH)) {
    errors.memo = maxLengthMessage('メモ', MEMO_MAX_LENGTH)
  }
  return errors
}

/** 検証済みの入力値をAPIへ送る形へ変換する。未入力の任意項目はnullにする。 */
export function toCourseInput(values: CourseFormValues): CourseInput {
  const period = values.period.trim()
  const academicYear = values.academic_year.trim()
  const memo = values.memo.trim()
  return {
    name: values.name.trim(),
    day_of_week: values.day_of_week === '' ? null : values.day_of_week,
    period: period === '' ? null : Number(period),
    academic_year: academicYear === '' ? null : Number(academicYear),
    term: values.term === '' ? null : values.term,
    memo: memo === '' ? null : memo,
  }
}
