import type { NextInterviewStepSummary } from './api/types'

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * 企業一覧の「次回選考」列の表示。`種別（M/D）`（例: `二次面接（11/25）`）、
 * 予定日なしは `種別（日付未定）`、次回のステップが無ければ `—`。
 * タイムゾーンによる日付のずれを避けるため、Dateを介さず文字列から組み立てる（想定外の形式はそのまま出す）。
 */
export function formatNextStep(nextStep: NextInterviewStepSummary | null): string {
  if (nextStep === null) {
    return '—'
  }
  if (nextStep.date === null) {
    return `${nextStep.type}（日付未定）`
  }
  const match = DATE_PATTERN.exec(nextStep.date)
  const date = match === null ? nextStep.date : `${Number(match[2])}/${Number(match[3])}`
  return `${nextStep.type}（${date}）`
}
