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

  it('パラメータが無ければnull', () => {
    expect(parsePositiveIntegerParam(undefined)).toBeNull()
  })
})
