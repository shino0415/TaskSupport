#!/usr/bin/env bash
# G-8a: クリーンアップポリシーのドライラン結果を確かめる（読み取りのみ。GCPの状態は変えない）。
# 確かめられなかった場合・使用中のイメージが削除予定に含まれる場合は、非ゼロで終了する。
# 終了コードが0のときだけ、G-8aの手順2（--no-dry-run での本番適用）に進んでよい。
#
# ログの種類・フィールド名（DRY_RUN_FILTER など）は未確認。README.mdのG-8a「確認できなかった点」を参照し、
# 公式ドキュメントで確かめてから実行すること。
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-tasksupport-portfolio}"
REGION="${REGION:-asia-northeast1}"
AR_REPO="${AR_REPO:-tasksupport-demo}"
RUN_SERVICE="${RUN_SERVICE:-tasksupport-demo}"
PACKAGE=backend
KEEP_COUNT=5
FRESHNESS="${FRESHNESS:-2d}"

# 未確認: ドライランの削除予定は、Artifact Registryのサービスエージェントによる BatchDeleteVersions の
# validateOnly=true の監査ログとして記録される、という前提で絞り込んでいる。
DRY_RUN_FILTER="protoPayload.serviceName=\"artifactregistry.googleapis.com\"
AND protoPayload.methodName=\"google.devtools.artifactregistry.v1.ArtifactRegistry.BatchDeleteVersions\"
AND protoPayload.request.validateOnly=true
AND protoPayload.resourceName:\"projects/${PROJECT_ID}/locations/${REGION}/repositories/${AR_REPO}\""

fail() {
  echo "NG: $*" >&2
  echo "手順2（本番適用）には進まないこと。" >&2
  exit 1
}

is_digest() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]
}

LOG_FILE="$(mktemp)"
trap 'rm -f "${LOG_FILE}"' EXIT

# 1. ドライランの削除予定の記録だけを取得し、0件なら止める
gcloud logging read "${DRY_RUN_FILTER}" --project="${PROJECT_ID}" \
  --freshness="${FRESHNESS}" --format=json > "${LOG_FILE}"
ENTRY_COUNT="$(grep -c '"insertId"' "${LOG_FILE}" || true)"
[[ "${ENTRY_COUNT}" -gt 0 ]] || fail "ドライランの削除予定の記録が見つからない（未評価、ログの種類・フィルタ違い、データアクセス監査ログ無効のいずれか）"
echo "OK: ドライランの削除予定の記録 ${ENTRY_COUNT} 件"

# 2. 確認の仕組みが働いていることの検査: 新しい5個に入らない古いダイジェストが、少なくとも1件削除予定に含まれる
mapfile -t ALL_DIGESTS < <(
  gcloud artifacts versions list --project="${PROJECT_ID}" --location="${REGION}" \
    --repository="${AR_REPO}" --package="${PACKAGE}" --sort-by=~CREATE_TIME --format='value(name)' \
    | grep -oE 'sha256:[0-9a-f]{64}'
)
[[ "${#ALL_DIGESTS[@]}" -gt "${KEEP_COUNT}" ]] || fail "バージョンが ${#ALL_DIGESTS[@]} 個で、削除対象になる古いものが無い（自動デプロイが6回以上動いてから再実行する）"
FOUND_OLD=0
for D in "${ALL_DIGESTS[@]:${KEEP_COUNT}}"; do
  if grep -qF "${D#sha256:}" "${LOG_FILE}"; then
    FOUND_OLD=1
    break
  fi
done
[[ "${FOUND_OLD}" -eq 1 ]] || fail "古いダイジェストが1件も削除予定に見つからない（ログの中のダイジェストの書かれ方が想定と違う可能性）"
echo "OK: 新しい${KEEP_COUNT}個より古いダイジェストが削除予定に含まれている"

# 3. トラフィックを受けている各リビジョンのダイジェストが、削除予定に1件も含まれない
mapfile -t REVISIONS < <(
  gcloud run services describe "${RUN_SERVICE}" --project="${PROJECT_ID}" --region="${REGION}" \
    --flatten='status.traffic' --format='value(status.traffic.revisionName)' | sed '/^$/d'
)
[[ "${#REVISIONS[@]}" -gt 0 ]] || fail "トラフィックを受けているリビジョンが取得できない"
for REV in "${REVISIONS[@]}"; do
  DIGEST="$(gcloud run revisions describe "${REV}" --project="${PROJECT_ID}" --region="${REGION}" \
    --format='value(status.imageDigest)' | grep -oE 'sha256:[0-9a-f]{64}' || true)"
  is_digest "${DIGEST}" || fail "リビジョン ${REV} のダイジェストが取得できない、または sha256: で始まらない"
  if grep -qF "${DIGEST#sha256:}" "${LOG_FILE}"; then
    fail "使用中のリビジョン ${REV} のイメージ ${DIGEST} が削除予定に含まれている"
  fi
  echo "OK: ${REV} (${DIGEST}) は削除予定に含まれない"
done

echo "すべての確認が通った。G-8aの手順2（本番適用）に進んでよい。"
