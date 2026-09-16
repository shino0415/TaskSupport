# Cloud Run（公開デモ環境）

誰でも自由に試せる公開デモ環境を、Google Cloud Runのサービス `tasksupport-demo`
（リージョン `asia-northeast1`）として稼働させています。

個人利用環境（Compute Engine）との違いは [`deploy/compute-engine/README.md`](../compute-engine/README.md)、
全体像は [`deploy/README.md`](../README.md) を参照してください。

このディレクトリには追加の設定ファイルはありません。バックエンドのソースコード・`Dockerfile`・
`entrypoint.sh` はリポジトリルートのものをそのまま使い、Cloud Run固有の設定はすべて
`gcloud run deploy` のフラグとして渡しています（後述）。

## サービス概要

| 項目 | 値 |
|---|---|
| GCPプロジェクト | `tasksupport-portfolio` |
| サービス名 | `tasksupport-demo` |
| リージョン | `asia-northeast1` |
| サービスURL | `https://tasksupport-demo-769416410713.asia-northeast1.run.app` |
| コンテナイメージ | `asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport/backend:latest`（Artifact Registryリポジトリ `tasksupport`） |
| フロントエンド | Vercelプロジェクト `frontend`（`https://frontend-silk-kappa-cub22v0dtl.vercel.app`、変更なし） |

## `--max-instances=1` にしている理由

このアプリはSQLiteのDBファイルをコンテナのローカルディスクに持つ構成です。Cloud Runで複数インスタンスが
同時に立つと、インスタンスごとに別々のDBファイルを持つことになりデータが不整合になります。それを避けるため、
意図的に `--max-instances=1` で常に1インスタンスに制限しています（スケールしない代わりに、単一のSQLite
ファイルで一貫性を保つ設計上のトレードオフです）。

## `DEMO_AUTO_RESET_ENABLED` の意味

`DEMO_AUTO_RESET_ENABLED=1` を設定すると、`backend/app/demo_reset.py` のバックグラウンドタスクが
24時間ごとにデモデータを自動リセットします。またこのバックグラウンドタスクは、起動直後に1回目の
リセット（＝シード投入）も即座に実行します。これはCloud Runがコールドスタートのたびにコンテナの
ディスクを空の状態で立ち上げる（`min-instances=0` のため、アクセスが無いとインスタンスが落ちて
次回起動時にディスクの内容が失われる）ため、起動直後にシードしないと公開デモとして機能しないための
対応です。

個人利用環境（Compute Engine）では、実データが消えてはいけないため `DEMO_AUTO_RESET_ENABLED` は
意図的に設定していません。

## デプロイ手順（ビルド〜デプロイ）

Artifact Registryへのビルド・push、Cloud Runへのデプロイは以下のコマンドで行います
（リポジトリルートで実行）。

```bash
# 1. GCPプロジェクトを設定
gcloud config set project tasksupport-portfolio

# 2. リポジトリルートの既存Dockerfileをそのままビルドし、Artifact Registryへpush
gcloud builds submit \
  --tag asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport/backend:latest \
  .

# 3. Cloud Runへデプロイ
gcloud run deploy tasksupport-demo \
  --image=asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport/backend:latest \
  --region=asia-northeast1 \
  --platform=managed \
  --allow-unauthenticated \
  --port=8000 \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi \
  --cpu=1 \
  --set-env-vars="API_KEY=demo-fb6713027aa00b2a,CORS_ALLOW_ORIGINS=https://frontend-silk-kappa-cub22v0dtl.vercel.app,DEMO_AUTO_RESET_ENABLED=1"
```

`API_KEY` はデモ用の固定値（README.md記載のものと同じ）で、公開しても問題ない値です。
個人利用環境のAPI Keyとは別物で、そちらの値はどのドキュメントにも記載していません。

再デプロイのみ行いたい場合（イメージを変更しない場合）は、手順3の `gcloud run deploy` だけを
再実行すれば既存の環境変数設定を引き継いだまま更新されます。環境変数を変更したい場合は
`--set-env-vars` に必要な値をすべて含めて指定してください（差分更新ではなく完全上書きです）。

## フロントエンド側の設定

フロントエンド（Vercelプロジェクト `frontend`）の環境変数 `VITE_API_BASE_URL` を、このCloud Run
サービスURL（`https://tasksupport-demo-769416410713.asia-northeast1.run.app`）に向けて再デプロイ済みです。
バックエンドのイメージを更新してもフロントエンド側の再設定は不要です。
