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

  it('時限は1〜6の整数のみ受け付ける', () => {
    expect(validateCourseForm({ ...VALID, period: '1' })).toEqual({})
    expect(validateCourseForm({ ...VALID, period: '6' })).toEqual({})
    for (const period of ['0', '7', '-1', '1.5', 'abc']) {
      expect(validateCourseForm({ ...VALID, period }).period).toBe(
        '時限は1〜6の整数で入力してください。',
      )
    }
  })

  it('年度は2000〜2100の整数のみ受け付ける', () => {
    expect(validateCourseForm({ ...VALID, academic_year: '2000' })).toEqual({})
    expect(validateCourseForm({ ...VALID, academic_year: '2100' })).toEqual({})
    for (const academicYear of ['1999', '2101', '2026.5', 'abc']) {
      expect(validateCourseForm({ ...VALID, academic_year: academicYear }).academic_year).toBe(
        '年度は2000〜2100の整数で入力してください。',
      )
    }
  })

  it('授業名は32文字まで、メモは1000文字まで受け付ける', () => {
    expect(validateCourseForm({ ...VALID, name: 'a'.repeat(32), memo: 'm'.repeat(1000) })).toEqual(
      {},
    )
  })

  it('授業名が32文字、メモが1000文字を超えるとメッセージを返す', () => {
    expect(validateCourseForm({ ...VALID, name: 'a'.repeat(33), memo: 'm'.repeat(1001) })).toEqual({
      name: '授業名は32文字以内で入力してください。',
      memo: 'メモは1000文字以内で入力してください。',
    })
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
