import { describe, expect, it } from 'vitest'

import { toCompanyInput, validateCompanyForm } from './companyForm'
import type { CompanyFormValues } from './companyForm'

const VALID_VALUES: CompanyFormValues = {
  name: '株式会社サンプル',
}

describe('validateCompanyForm', () => {
  it('全項目入力済みならエラーが無い', () => {
    expect(validateCompanyForm(VALID_VALUES)).toEqual({})
  })

  it('企業名が未入力ならエラーになる', () => {
    expect(validateCompanyForm({ ...VALID_VALUES, name: '' })).toEqual({
      name: '企業名を入力してください。',
    })
  })

  it('企業名が空白のみならエラーになる', () => {
    expect(validateCompanyForm({ ...VALID_VALUES, name: '   ' })).toEqual({
      name: '企業名を入力してください。',
    })
  })
})

describe('toCompanyInput', () => {
  it('前後の空白を取り除いて変換する', () => {
    expect(toCompanyInput({ name: '  株式会社サンプル  ' })).toEqual({
      name: '株式会社サンプル',
    })
  })
})
