import { describe, expect, it } from 'vitest'

import type { CourseFormValues } from './courseForm'
import {
  EMPTY_COURSE_FORM_VALUES,
  toCourseFormValues,
  toCourseInput,
  validateCourseForm,
} from './courseForm'

const VALID: CourseFormValues = {
  name: 'データベース論',
  day_of_week: '月',
  period: '2',
  academic_year: '2026',
  term: '前期',
  memo: '',
}

describe('validateCourseForm', () => {
  it('必須項目が揃っていればエラーなし', () => {
    expect(validateCourseForm(VALID)).toEqual({})
  })

  it('授業名以外は未入力でもエラーにしない', () => {
    expect(validateCourseForm({ ...EMPTY_COURSE_FORM_VALUES, name: '線形代数' })).toEqual({})
  })

  it('授業名が未入力（空白のみを含む）ならメッセージを返す', () => {
    expect(validateCourseForm({ ...VALID, name: '' }).name).toContain('授業名')
    expect(validateCourseForm({ ...VALID, name: '   ' }).name).toContain('授業名')
  })

  it('時限は1以上の整数のみ受け付ける', () => {
    expect(validateCourseForm({ ...VALID, period: '1' })).toEqual({})
    expect(validateCourseForm({ ...VALID, period: '0' }).period).toContain('1以上の整数')
    expect(validateCourseForm({ ...VALID, period: '-1' }).period).toContain('1以上の整数')
    expect(validateCourseForm({ ...VALID, period: '1.5' }).period).toContain('1以上の整数')
    expect(validateCourseForm({ ...VALID, period: 'abc' }).period).toContain('1以上の整数')
  })

  it('年度は整数のみ受け付ける', () => {
    expect(validateCourseForm({ ...VALID, academic_year: '2026.5' }).academic_year).toContain(
      '整数',
    )
    expect(validateCourseForm({ ...VALID, academic_year: 'abc' }).academic_year).toContain('整数')
  })
})

describe('toCourseFormValues', () => {
  it('新規登録（null）なら空の初期値を返す', () => {
    expect(toCourseFormValues(null)).toEqual(EMPTY_COURSE_FORM_VALUES)
  })

  it('編集対象の値を文字列のフォーム値へ変換し、nullは空文字にする', () => {
    expect(
      toCourseFormValues({
        id: 1,
        name: 'データベース論',
        day_of_week: '月',
        period: 2,
        academic_year: 2026,
        term: '前期',
        memo: null,
        is_deleted: false,
      }),
    ).toEqual({
      name: 'データベース論',
      day_of_week: '月',
      period: '2',
      academic_year: '2026',
      term: '前期',
      memo: '',
    })
  })

  it('未設定・未知の曜日/学期は未設定（空文字）として扱う', () => {
    expect(
      toCourseFormValues({
        id: 1,
        name: '集中講義',
        day_of_week: '月曜',
        period: null,
        academic_year: null,
        term: null,
        memo: null,
        is_deleted: false,
      }),
    ).toMatchObject({ day_of_week: '', period: '', academic_year: '', term: '' })
  })
})

describe('toCourseInput', () => {
  it('数値項目を数値に変換する', () => {
    expect(toCourseInput(VALID)).toEqual({
      name: 'データベース論',
      day_of_week: '月',
      period: 2,
      academic_year: 2026,
      term: '前期',
      memo: null,
    })
  })

  it('未入力の任意項目はnullにする', () => {
    expect(toCourseInput({ ...EMPTY_COURSE_FORM_VALUES, name: '線形代数' })).toEqual({
      name: '線形代数',
      day_of_week: null,
      period: null,
      academic_year: null,
      term: null,
      memo: null,
    })
  })

  it('前後の空白を除いて送信する', () => {
    expect(toCourseInput({ ...VALID, name: '  線形代数  ', memo: '  補足  ' })).toMatchObject({
      name: '線形代数',
      memo: '補足',
    })
  })
})
