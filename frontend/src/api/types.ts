/** APIのレスポンス型（本タスクで疎通確認に使う案件のみ定義する）。 */

export type Project = {
  id: number
  name: string
  client_name: string
  status: string
  reward: number
  applied_date: string
  deadline: string | null
  platform: string
  memo: string | null
  is_deleted: boolean
}
