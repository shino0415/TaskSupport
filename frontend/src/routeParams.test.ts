import { describe, expect, it } from 'vitest'

import { parsePositiveIntegerParam } from './routeParams'

describe('parsePositiveIntegerParam', () => {
  it('正の整数は数値として返す', () => {
    expect(parsePositiveIntegerParam('1')).toBe(1)
    expect(parsePositiveIntegerParam('42')).toBe(42)
  })

  it.each(['0', '00', '-1', '1.5', '1e2', '0x10', 'abc', '', ' 1', '1 ', '+1'])(
    '正の整数以外（%j）はnull',
    (value) => {
      expect(parsePositiveIntegerParam(value)).toBeNull()
    },
  )

  it('Number.MAX_SAFE_INTEGERちょうどは受理する', () => {
    expect(parsePositiveIntegerParam('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
  })

  it.each([
    ['MAX_SAFE_INTEGER+1', '9007199254740992'],
    ['MAX_SAFE_INTEGER+2', '9007199254740993'],
    ['25桁の9', '9'.repeat(25)],
    ['400桁の9', '9'.repeat(400)],
  ])('Number.MAX_SAFE_INTEGERを超える値（%s）はnull', (_label, value) => {
    expect(parsePositiveIntegerParam(value)).toBeNull()
  })

  it('パラメータが無ければnull', () => {
    expect(parsePositiveIntegerParam(undefined)).toBeNull()
  })
})
