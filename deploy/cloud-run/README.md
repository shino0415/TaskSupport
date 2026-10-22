# Cloud Run（公開デモ環境）

誰でも自由に試せる公開デモ環境を、Google Cloud Runのサービス `tasksupport-demo`
（リージョン `asia-northeast1`）として稼働させています。

個人利用環境（Compute Engine）との違いは [`deploy/compute-engine/README.md`](../compute-engine/README.md)、
全体像は [`deploy/README.md`](../README.md) を参照してください。

このディレクトリには追加の設定ファイルはありません。バックエンドのソースコード・`Dockerfile`・
`entrypoint.sh` はリポジトリルートのものをそのまま使い、Cloud Run固有の設定はすべて
`gcloud run deploy` のフラグとしてサービスに設定済みです（後述）。masterへのpush時にはイメージだけが自動で差し替わります。

## サービス概要

| 項目 | 値 |
|---|---|
| GCPプロジェクト | `tasksupport-portfolio` |
| サービス名 | `tasksupport-demo` |
| リージョン | `asia-northeast1` |
| サービスURL | `https://tasksupport-demo-769416410713.asia-northeast1.run.app` |
| コンテナイメージ | `asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport-demo/backend:<コミットSHA>`（自動デプロイ専用のArtifact Registryリポジトリ `tasksupport-demo`）。自動デプロイの初回より前は、VM用の `tasksupport/backend:latest` を使っている |
| ランタイム用サービスアカウント | `tasksupport-demo-runtime@tasksupport-portfolio.iam.gserviceaccount.com`（ロールを持たない専用SA。切り替え手順は [`../github-actions/README.md`](../github-actions/README.md) のG-6・G-7） |
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

## 自動デプロイ（masterへのpush時）

masterへのpushでCIのチェック（バックエンド・フロントエンドとも）がすべて通ると、GitHub Actions
（`.github/workflows/ci.yml` の `deploy-backend` ジョブ）が次を行います。

1. Workload Identity連携でデプロイ用サービスアカウント `github-actions-deployer` を借用する（鍵ファイルは使わない）。
2. GitHub Actionsのランナー上でリポジトリルートの `Dockerfile` をビルドし、
   `asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport-demo/backend:<コミットSHA>` としてpushする
   （`latest` タグは付けない。provenance等の追加マニフェストも付けない）。
3. `gcloud run deploy tasksupport-demo --image=<上のイメージ> --region=asia-northeast1` で**イメージだけ**を差し替える。

手順3では `--image` 以外のフラグを付けないため、環境変数（`API_KEY`・`CORS_ALLOW_ORIGINS`・`DEMO_AUTO_RESET_ENABLED`）、
`--max-instances=1`・`--min-instances=0`、未認証アクセスの許可、ポート・メモリ・CPU、ランタイム用サービスアカウントは
既存の設定がそのまま引き継がれます。このデプロイが成功した後に、フロントエンド（Vercel）がデプロイされます。

VM（個人利用環境）は自動デプロイの対象外で、`tasksupport/backend:latest` は自動デプロイでは更新されません
（`backend:<コミットSHA>` と `backend:latest` の使い分け、VMの手動更新手順は [`deploy/README.md`](../README.md) を参照）。
外部サービス側の初期設定は [`../github-actions/README.md`](../github-actions/README.md) を参照してください。

### 前の版へ戻す（切り戻し）

自動デプロイ専用リポジトリには新しいものから5個のイメージが残っているので、問題があったときは前のSHAへ戻せます
（自分の権限で実行）。

```bash
gcloud run deploy tasksupport-demo \
  --image=asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport-demo/backend:<戻したいコミットSHA> \
  --region=asia-northeast1
```

切り戻した後は、使用中のイメージが早くクリーンアップの削除対象になるため、原因を直すまでmasterへのpushを控えるか、
クリーンアップポリシーをドライランに戻してください（[`../github-actions/README.md`](../github-actions/README.md) のG-8a）。

## 手動デプロイ（自動デプロイが使えないとき）

GitHub Actionsや外部サービスの設定に問題があって自動デプロイが使えないときは、自分の権限（`gcloud auth login` 済み）で
次のコマンドを実行します（リポジトリルートで、デプロイしたいコミットをチェックアウトし、未コミットの変更が無い状態で実行。
`gcloud builds submit` は作業ツリーの内容をビルドするため、変更が残っているとタグのSHAと中身が食い違います）。
自動デプロイと同じく、自動デプロイ専用リポジトリ `tasksupport-demo` にコミットSHAのタグでpushし、`latest` は使いません
（VM用の `tasksupport/backend:latest` を更新すると、VMの次回更新時に意図しないイメージに切り替わるため）。

```bash
# 1. GCPプロジェクトを設定
gcloud config set project tasksupport-portfolio

# 2. リポジトリルートの既存Dockerfileをビルドし、自動デプロイ専用リポジトリへコミットSHAのタグでpush
IMAGE="asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport-demo/backend:$(git rev-parse HEAD)"
gcloud builds submit --tag "${IMAGE}" .

# 3. Cloud Runのイメージだけを差し替える（他のフラグは付けず、既存の設定を引き継ぐ）
gcloud run deploy tasksupport-demo \
  --image="${IMAGE}" \
  --region=asia-northeast1
```

フロントエンドも手動でデプロイする場合は、Cloud Runの更新が終わってから行います（手順は [`deploy/README.md`](../README.md) の
「自動デプロイが使えないときの手動デプロイ」）。

### サービスを作り直す場合（全設定の指定）

サービスを削除して作り直すなど、設定を最初から指定する必要があるときだけ、すべてのフラグを付けて実行します
（`--allow-unauthenticated` を付けるにはIAMポリシーを変更できる権限が必要なため、デプロイ用サービスアカウントではなく自分の権限で実行する）。

```bash
gcloud run deploy tasksupport-demo \
  --image=asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport-demo/backend:<コミットSHA> \
  --region=asia-northeast1 \
  --platform=managed \
  --allow-unauthenticated \
  --port=8000 \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi \
  --cpu=1 \
  --service-account=tasksupport-demo-runtime@tasksupport-portfolio.iam.gserviceaccount.com \
  --set-env-vars="API_KEY=demo-fb6713027aa00b2a,CORS_ALLOW_ORIGINS=https://frontend-silk-kappa-cub22v0dtl.vercel.app,DEMO_AUTO_RESET_ENABLED=1"
```

`API_KEY` はデモ用の固定値（README.md記載のものと同じ）で、公開しても問題ない値です。
個人利用環境のAPI Keyとは別物で、そちらの値はどのドキュメントにも記載していません。

環境変数を変更したい場合は `--set-env-vars` に必要な値をすべて含めて指定してください（差分更新ではなく完全上書きです）。
環境変数の変更は自動デプロイでは行わないため、自分の権限で実行します。

## フロントエンド側の設定

フロントエンド（Vercelプロジェクト `frontend`）の環境変数 `VITE_API_BASE_URL` を、このCloud Run
サービスURL（`https://tasksupport-demo-769416410713.asia-northeast1.run.app`）に向けて再デプロイ済みです。
バックエンドのイメージを更新してもフロントエンド側の再設定は不要です（自動デプロイでもVercelの環境変数は変更しません）。
