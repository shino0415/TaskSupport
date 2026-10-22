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
