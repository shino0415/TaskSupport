/**
 * 課題の提出期限（タイムゾーン無しの日時文字列）が、基準時刻より前かどうかを判定する。
 * APIの提出期限はタイムゾーン無しで扱われるため、閲覧しているブラウザのローカル時刻として解釈する。
 * 期限なし・解釈できない値は期限切れとみなさない。
 */
export function isDeadlinePassed(deadline: string | null, now: Date): boolean {
  if (deadline === null) {
    return false
  }
  const time = new Date(deadline).getTime()
  if (Number.isNaN(time)) {
    return false
  }
  return time < now.getTime()
}

// APIの提出期限（タイムゾーン無し）の先頭部分。秒・小数秒の有無は問わない
const DEADLINE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/**
 * 提出期限を画面表示用の `M/D HH:mm`（例: `11/1 23:59`）へ整形する。
 * タイムゾーン変換による日時のずれを避けるため、Dateを介さず文字列から組み立てる。
 * 想定外の形式の値はそのまま返す。
 */
export function formatDeadline(deadline: string): string {
  const match = DEADLINE_PATTERN.exec(deadline)
  if (match === null) {
    return deadline
  }
  const [, , month, day, hour, minute] = match
  return `${Number(month)}/${Number(day)} ${hour}:${minute}`
}
