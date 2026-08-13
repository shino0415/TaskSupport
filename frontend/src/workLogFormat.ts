/**
 * 稼働ログ・時給換算の表示用フォーマット（描画から独立した純粋関数）。
 *
 * 稼働時間はバックエンドと同じく `ended_at - started_at` で都度計算する
 * （保存された値をそのまま信用しない）。進行中（ended_at が null）のログは
 * 現在時刻までの経過時間としては計算しない（時給換算の集計方針と平仄を
 * 合わせ、GETのたびに値が変わり続けることを避ける）。
 */

/** 稼働ログ1件の稼働時間の表示。進行中は経過時間を計算せず「進行中」と表す。 */
export function formatWorkLogDuration(startedAt: string | null, endedAt: string | null): string {
  if (endedAt === null) {
    return '進行中'
  }
  if (startedAt === null) {
    return '-'
  }
  const startMs = new Date(startedAt).getTime()
  const endMs = new Date(endedAt).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return '-'
  }
  const totalMinutes = Math.round((endMs - startMs) / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}時間${minutes}分`
}

/** 案件の時給換算結果の表示。稼働実績が無く算出できない場合はその旨を返す。 */
export function formatHourlyRate(hourlyRate: number | null): string {
  if (hourlyRate === null) {
    return '時給を算出できません（稼働実績がありません）。'
  }
  return `${Math.round(hourlyRate).toLocaleString()} 円/時`
}

/** 合計稼働時間の表示。 */
export function formatTotalWorkHours(totalWorkHours: number): string {
  return `${totalWorkHours.toLocaleString()} 時間`
}
