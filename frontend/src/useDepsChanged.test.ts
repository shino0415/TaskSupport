import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useDepsChanged } from './useDepsChanged'

/** 描画ごとの戻り値を記録する（変化を検知した描画ではReactがすぐに描画し直すため、最終値だけでは判別できない）。 */
function renderRecording<T>(initialValue: T) {
  const calls: boolean[] = []
  const { rerender } = renderHook(({ value }) => calls.push(useDepsChanged([value])), {
    initialProps: { value: initialValue },
  })
  return { calls, rerender }
}

describe('useDepsChanged', () => {
  it('初回の描画ではtrueを返し、描画し直した後はfalseになる', () => {
    const { calls } = renderRecording(1)
    expect(calls).toEqual([true, false])
  })

  it('依存値が変わらなければ再描画してもfalseを返す', () => {
    const { calls, rerender } = renderRecording(1)
    calls.length = 0
    rerender({ value: 1 })
    expect(calls).toEqual([false])
  })

  it('依存値が変わった描画ではtrueを返し、その次の描画ではfalseに戻る', () => {
    const { calls, rerender } = renderRecording(1)
    calls.length = 0
    rerender({ value: 2 })
    expect(calls).toEqual([true, false])
    calls.length = 0
    rerender({ value: 2 })
    expect(calls).toEqual([false])
  })

  it('オブジェクトは同一参照かどうかで比較する', () => {
    const target = { id: 1 }
    const { calls, rerender } = renderRecording<{ id: number }>(target)
    calls.length = 0
    rerender({ value: target })
    expect(calls).toEqual([false])
    rerender({ value: { id: 1 } })
    expect(calls).toEqual([false, true, false])
  })
})
