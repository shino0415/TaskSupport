/** APIのレスポンス／リクエストで扱う型。 */

/** Project.statusの取りうる値（バックエンドの状態遷移グラフのキーと同じ集合）。 */
export const PROJECT_STATUSES = ['提案中', '契約中', '納品済み', '完了', '見送り'] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export type Project = {
  id: number
  name: string
  client_name: string
  // 表示は取得した値をそのまま扱う（APIのレスポンスはstrのため、未知の値でも壊れないようにする）
  status: string
  reward: number
  applied_date: string
  deadline: string | null
  platform: string
  memo: string | null
  is_deleted: boolean
}

/** 案件の作成・更新で送信する内容。 */
export type ProjectInput = {
  name: string
  client_name: string
  status: ProjectStatus
  reward: number
  applied_date: string
  deadline: string | null
  platform: string
  memo: string | null
}

/** PATCH /projects/{id} のレスポンス。逆行遷移時のみwarningが入る。 */
export type ProjectPatchResponse = Project & {
  warning: string | null
}
