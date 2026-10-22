import { useState } from 'react'

const NOT_RENDERED = Symbol('notRendered')

/**
 * 依存値が前回の描画から変わったか（初回の描画を含む）を返す。
 * propsの変化に合わせた状態の初期化を、Effectではなく描画中に行うために使う
 * （https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes）。
 * trueを返した描画の中で呼び出し側が状態を更新すると、Reactはその結果で描画し直してから画面に反映する。
 */
export function useDepsChanged(deps: readonly unknown[]): boolean {
  const [prevDeps, setPrevDeps] = useState<readonly unknown[] | typeof NOT_RENDERED>(NOT_RENDERED)
  if (
    prevDeps === NOT_RENDERED ||
    prevDeps.length !== deps.length ||
    prevDeps.some((value, index) => !Object.is(value, deps[index]))
  ) {
    setPrevDeps(deps)
    return true
  }
  return false
}
