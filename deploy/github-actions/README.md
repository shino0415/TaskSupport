# 自動デプロイ用の外部サービス設定手順（GCP・Vercel・GitHub）

> **重要: この手順はまだ実行されていません。**
> ここに書かれた設定（GCP・Vercel・GitHubの状態を変えるコマンドや画面操作）は、generator・評価者
> （AIエージェント）が実行するものではありません。**実行はユーザーの確認を取ってから、別途行います。**
> 実行したら、末尾の「実行記録」に日付と実行者を追記してください。

masterブランチへのpushでCIのチェックが通ったときに、GitHub Actionsから次の3つを自動デプロイするための
初期設定手順です（方針は `spec.md` の「## 決定事項」→「masterへのpush時の自動デプロイ」）。

1. バックエンド: イメージ `backend:<コミットSHA>` を自動デプロイ専用のArtifact Registryリポジトリ `tasksupport-demo` へpushし、
   Cloud Runの `tasksupport-demo` にデプロイ（VMが使う既存の `tasksupport` リポジトリの `backend:latest` には触れない）
2. フロントエンド（デモ用）: Vercelプロジェクト `frontend`
3. フロントエンド（個人用）: Vercelプロジェクト `tasksupport-personal-frontend`

Compute EngineのVM（個人用バックエンド）は対象外です（従来どおり手動、[`../compute-engine/README.md`](../compute-engine/README.md)）。

## 前提と方針

| 項目 | 値・方針 |
|---|---|
| GCPプロジェクトID / 番号 | `tasksupport-portfolio` / `769416410713` |
| Artifact Registry（自動デプロイ用） | `asia-northeast1` の `tasksupport-demo`（Dockerリポジトリ、G-8で新規作成）。デプロイ用SAの書き込み権限はこのリポジトリにだけ付ける。クリーンアップポリシーで新しいものから5個のイメージだけを残す（G-8a） |
| Artifact Registry（既存・VM用） | `asia-northeast1` の `tasksupport`。VMは従来どおり手動で `tasksupport/backend:latest` を使う。**デプロイ用SAにはこのリポジトリの権限を一切付けない** |
| Cloud Run | `tasksupport-demo`（`asia-northeast1`） |
| GitHubリポジトリ / ブランチ | `shino0415/TaskSupport`（パブリック） / `master` |
| GCPの認証 | Workload Identity連携（GitHub OIDC）＋デプロイ用サービスアカウントの借用。**サービスアカウントの鍵ファイルは作らない** |
| Cloud Runのランタイム用SA | `tasksupport-demo` を、ロールを一切持たない専用SA `tasksupport-demo-runtime` で動かすように切り替える（G-6・G-7、管理者が一度だけ手作業で実行）。VMのSAは変えない |
| イメージのビルド方式 | **GitHub Actionsのランナー上で `docker build` し、Artifact Registryへ直接 `docker push` する。Cloud Buildは使わない** |
| Vercelへのデプロイ | VercelのGit連携は使わず、GitHub ActionsからVercel CLIで行う |
| OIDCトークンの取得権限 | GCP側の信頼条件はリポジトリ・masterブランチ・pushイベントで絞り、workflowファイル単位（`job_workflow_ref` 等）では絞らない。その代わり **`id-token: write` はデプロイを行うジョブにだけ付け、他のジョブ・workflowには付けない**（後続のworkflowタスクが守るべき前提） |

### 自動デプロイ専用のArtifact Registryリポジトリを分ける理由

デプロイ用SAに既存の `tasksupport` リポジトリへの書き込み権限を付けると、IAM上は `backend:latest` も上書きできて
しまいます。VM（個人の実データと個人用API Keyを持つ環境）は `latest` を手動でpullするため、デプロイジョブが乗っ取られた
場合（ジョブ内のサードパーティのアクション等）に、次回の手動更新でVMが改ざんされたイメージを動かすおそれがあります。
自動デプロイ専用のリポジトリ `tasksupport-demo` を作り、デプロイ用SAの権限をそこにだけ付けることで、
「`latest` を自動デプロイで更新しない」をworkflowの決まりだけでなくIAMでも強制します。

### `id-token: write` をデプロイジョブだけに付ける理由

信頼条件は「このリポジトリのmasterへのpush」までしか絞っていないため、masterに入ったworkflowのうち
`id-token: write` を持つジョブなら、どれでもデプロイ用SAを借用できます。そこで後続のworkflowでは次を守ります。

- workflow全体の `permissions` は `contents: read` のままにし、`id-token: write` はデプロイを行うジョブの
  `permissions` にだけ書く。
- 他のジョブ（lint/test/build/frontend等）や他のworkflowファイルには `id-token: write` を付けない。
  新しいworkflowやジョブを追加するときのレビューでもこの点を確認する。

### Cloud BuildではなくDockerで直接pushする理由

- Cloud Buildを使うと、デプロイ用サービスアカウントにビルドの起動権限（`roles/cloudbuild.builds.editor`、
  プロジェクト単位でしか付けられない）、ソースのアップロード先バケットへの書き込み権限、Cloud Buildの
  実行用サービスアカウントへの `actAs` などが追加で必要になります。
- Dockerで直接pushすれば、Artifact Registryについては **自動デプロイ専用リポジトリ `tasksupport-demo` 単位の書き込み権限だけ**で済みます。
- CIの `build` ジョブはすでにランナー上で `docker/build-push-action` を使ってビルドしているため、
  後続のworkflowもその延長で書けます。

後続タスク（workflow追加）は、この前提で次のように書く想定です。

- `google-github-actions/auth` で Workload Identity連携 → サービスアカウント借用（`token_format: access_token`）
- 取得したアクセストークンで `docker/login-action`（registry: `asia-northeast1-docker.pkg.dev`、username: `oauth2accesstoken`）
- `docker/build-push-action` で `asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport-demo/backend:${{ github.sha }}` をpush
  （既存の `tasksupport` リポジトリにはpushしない。`latest` タグも付けない）
- `gcloud run deploy tasksupport-demo --image=<上のイメージ> --region=asia-northeast1` で**イメージだけ**差し替える。
  - `--allow-unauthenticated` は付けない（既存の公開設定はそのまま引き継がれる。付けるとIAMポリシー変更権限
    ＝ `roles/run.admin` 相当が必要になり、権限を最小にできない）。
  - `--set-env-vars` 等の他のフラグも付けない（既存の環境変数・`--max-instances=1` 等はそのまま引き継がれる）。
- `permissions: id-token: write`（と `contents: read`）は**デプロイを行うジョブにだけ**付け、`if: github.event_name == 'push' && github.ref == 'refs/heads/master'` で絞る
  （GCP側の信頼条件でも絞るが、workflow側でも二重に絞る）。

## GitHubに登録するSecrets / Variables（後続タスクで使う名前）

秘密情報（トークン等）は **Secrets** に置きます。秘密ではない識別子は、ログで値を確認できて設定ミスを
見つけやすいよう **Variables** に置きます。いずれもリポジトリ単位（`shino0415/TaskSupport`）で登録します。

| 名前 | 種類 | 用途 | 値（または取得方法） |
|---|---|---|---|
| `VERCEL_TOKEN` | **Secret** | Vercel CLIの認証トークン | 手順V-1で発行（**値はどこにも書かない**） |
| `VERCEL_ORG_ID` | Variable | VercelのチームID（2プロジェクト共通） | `team_QrGhVoQu9Cohe9vL6l9sWxaz` |
| `VERCEL_PROJECT_ID_DEMO` | Variable | デモ用プロジェクト `frontend` のID | `prj_uL7v5KvvXzu3vMsRjKtMHgYJYbmT` |
| `VERCEL_PROJECT_ID_PERSONAL` | Variable | 個人用プロジェクト `tasksupport-personal-frontend` のID | `prj_3u4SA2oOclU28nEX5CQyo0OVbMvw` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Variable | `google-github-actions/auth` の `workload_identity_provider` | `projects/769416410713/locations/global/workloadIdentityPools/github-actions/providers/github` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | Variable | `google-github-actions/auth` の `service_account` | `github-actions-deployer@tasksupport-portfolio.iam.gserviceaccount.com` |

- Workload Identityプロバイダ名とサービスアカウントのメールアドレスは秘密情報ではありません（これだけでは
  認証できず、GCP側の信頼条件を満たすワークフロー実行からしかトークンを得られないため）。
- GCPプロジェクトID・リージョン・Cloud Runサービス名・Artifact Registryのパスは、既にdeploy/配下の
  READMEで公開している固定値なので、Secrets/Variablesにはせずworkflowの `env` に直接書きます。
- Vercel CLIは環境変数 `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` でデプロイ先を決めるため、workflowでは
  ステップごとに `VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID_DEMO }}` のように渡します。
- 個人利用環境のAPI Keyなど、上記以外の秘密情報は登録しません（フロントエンドのビルドにAPI Keyは不要で、
  `VITE_API_BASE_URL` は各Vercelプロジェクトの環境変数を `vercel pull` で取得して使います）。

---

## GCP側の設定（上から順に実行）

以降のコマンドはすべて、プロジェクトのオーナー権限を持つユーザーで `gcloud auth login` 済みの端末で、
同じシェルセッションのまま上から順に実行します。最初に共通の変数を設定します。

```bash
export PROJECT_ID=tasksupport-portfolio
export PROJECT_NUMBER=769416410713
export REGION=asia-northeast1
export AR_REPO=tasksupport-demo        # 自動デプロイ専用（G-8で新規作成）
export AR_REPO_VM=tasksupport          # 既存・VM用（デプロイ用SAの権限は付けない）
export RUN_SERVICE=tasksupport-demo
export GITHUB_REPO=shino0415/TaskSupport
export POOL_ID=github-actions
export PROVIDER_ID=github
export DEPLOY_SA_NAME=github-actions-deployer
export DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
export RUNTIME_SA_NAME=tasksupport-demo-runtime
export RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "${PROJECT_ID}"
```

確認: `gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)'` が `769416410713` を返すこと。

### G-1. 必要なAPIを有効化する

Workload Identity連携には IAM / IAM Credentials / Security Token Service のAPIが必要です
（Cloud Run・Artifact Registryは有効化済み）。

```bash
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com
```

- 確認: `gcloud services list --enabled --filter="name:(iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com)" --format='value(name)'` に3つとも表示されること。
- 取り消し: 他で使っていなければ `gcloud services disable iamcredentials.googleapis.com sts.googleapis.com`
  （`iam.googleapis.com` は他の機能でも使うため無効化しない）。

### G-2. GitHubリポジトリのID・オーナーIDを確認する

信頼条件はリポジトリ名だけでなく、**数値のリポジトリID・オーナーID**でも絞ります（同名のリポジトリを
作り直されたり、ユーザー名が変更・再取得されたりしても、別のリポジトリから認証できないようにするため）。

```bash
export GITHUB_REPO_ID=$(gh api "repos/${GITHUB_REPO}" --jq .id)
export GITHUB_OWNER_ID=$(gh api "repos/${GITHUB_REPO}" --jq .owner.id)
echo "repo_id=${GITHUB_REPO_ID} owner_id=${GITHUB_OWNER_ID}"
```

- 確認: 2つとも数値が表示されること（空なら `gh auth login` を確認）。この値は秘密情報ではありません。
- 取り消し: 不要（読み取りのみ）。

### G-3. Workload Identityプールを作成する

```bash
gcloud iam workload-identity-pools create "${POOL_ID}" \
  --location=global \
  --display-name="GitHub Actions"
```

- 確認: `gcloud iam workload-identity-pools describe "${POOL_ID}" --location=global --format='value(name,state)'`
  が `projects/769416410713/locations/global/workloadIdentityPools/github-actions  ACTIVE` を返すこと。
- 取り消し: G-4のプロバイダを先に削除してから
  `gcloud iam workload-identity-pools delete "${POOL_ID}" --location=global`。
  削除したプールは30日間ソフト削除状態になり、その間は同じIDで作り直せません
  （`gcloud iam workload-identity-pools undelete "${POOL_ID}" --location=global` で復元は可能）。

### G-4. GitHub OIDCプロバイダを作成する（信頼条件をこのリポジトリのmasterへのpushに限定）

```bash
gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
  --location=global \
  --workload-identity-pool="${POOL_ID}" \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}' && assertion.repository_id == '${GITHUB_REPO_ID}' && assertion.repository_owner_id == '${GITHUB_OWNER_ID}' && assertion.ref == 'refs/heads/master' && assertion.event_name == 'push'"
```

`--attribute-condition` を満たさないOIDCトークンは、プロバイダの時点で交換を拒否されます。
この条件によって、次の実行からは**GCPへ認証できません**。

| 実行元 | 拒否される理由 |
|---|---|
| 他のリポジトリ | `repository` / `repository_id` が一致しない |
| フォーク（フォーク側でのpushを含む） | フォークは別リポジトリなので `repository` / `repository_id` / `repository_owner_id` が一致しない |
| プルリクエスト（同じリポジトリ内のブランチからのPRを含む） | `ref` が `refs/pull/<番号>/merge`、`event_name` が `pull_request` になり一致しない |
| master以外のブランチ・タグへのpush | `ref` が `refs/heads/master` ではない |
| `workflow_dispatch`・`schedule` 等、push以外のトリガー | `event_name` が `push` ではない（masterへのpushのワークフローを「再実行」した場合は `push` のままなので許可される） |

- 確認:
  ```bash
  gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
    --location=global --workload-identity-pool="${POOL_ID}" \
    --format='yaml(name,state,attributeCondition,attributeMapping,oidc.issuerUri)'
  ```
  `state: ACTIVE`、`attributeCondition` に実際の数値IDと `refs/heads/master`・`push` が入っていること
  （`${...}` のまま残っていたら変数が未設定なので、`update-oidc` で直す）。
- 取り消し: `gcloud iam workload-identity-pools providers delete "${PROVIDER_ID}" --location=global --workload-identity-pool="${POOL_ID}"`
  （プールと同様に30日間ソフト削除。即座に認証を止めたいだけなら
  `gcloud iam workload-identity-pools providers update-oidc "${PROVIDER_ID}" --location=global --workload-identity-pool="${POOL_ID}" --disabled` でも可）。

### G-5. デプロイ用サービスアカウントを作成する（鍵は作らない）

```bash
gcloud iam service-accounts create "${DEPLOY_SA_NAME}" \
  --display-name="GitHub Actions deployer (tasksupport-demo)" \
  --description="masterへのpush時にGitHub ActionsからCloud Run tasksupport-demoへデプロイする。鍵は作成しない"
```

**`gcloud iam service-accounts keys create` は実行しません。** GitHub ActionsはG-12のWorkload Identity連携で
このサービスアカウントの短期トークンを得るため、鍵ファイルは不要です。

- 確認: `gcloud iam service-accounts describe "${DEPLOY_SA}" --format='value(email,disabled)'` が表示されること。
  `gcloud iam service-accounts keys list --iam-account="${DEPLOY_SA}" --managed-by=user` が**空**であること
  （ユーザー管理の鍵が1つも無い）。
- 取り消し: G-9〜G-12の付与をすべて外してから `gcloud iam service-accounts delete "${DEPLOY_SA}"`
  （削除後30日以内なら `gcloud iam service-accounts undelete <数値のunique ID>` で復元可能）。
  一時的に止めるだけなら `gcloud iam service-accounts disable "${DEPLOY_SA}"`。

### G-6. Cloud Run専用のランタイム用サービスアカウントを作成する（ロールは付けない）

#### 切り替える理由

Cloud Runはリビジョンを「ランタイム用サービスアカウント」の権限で動かします。これまでの手動デプロイ
（[`../cloud-run/README.md`](../cloud-run/README.md)）では `--service-account` を指定していないため、`tasksupport-demo` は
Compute Engineのデフォルトサービスアカウント（`769416410713-compute@developer.gserviceaccount.com`）で
動いているはずです（実際の値はG-7の最初で確認する）。
このSAには既定でプロジェクトの編集者権限が付いていることが多く、デプロイ用SAにそのSAへの `actAs` を付けると、
デプロイ用SAは「編集者権限で動くコードをCloud Runにデプロイできる」ことになり、実質的な権限がデプロイ用SA
自身のロールよりはるかに広くなります。

そこで、プロジェクトのロールを一切持たないCloud Run専用のSAを作って `tasksupport-demo` をそれで動かし、
デプロイ用SAの `actAs` はこの専用SAの上だけに付けます。**デフォルトのCompute EngineサービスアカウントへのactAsは付けません。**
VM（`tasksupport-personal`）のサービスアカウントは変更しません。

#### 追加の権限が要らない理由

このSAには、プロジェクト単位・リソース単位とも**ロールを1つも付けません**。現在のアプリは次のとおりで、
実行中にGCPのAPIを呼ばないためです。

- DBはコンテナ内のSQLiteファイル（`DATABASE_URL` 未設定時は `sqlite:///./app.db`）で、Cloud SQLやCloud Storageを使わない。
- バックエンドの実行時依存は `fastapi` / `sqlalchemy` / `alembic` / `uvicorn` だけで、Google Cloudのクライアントライブラリを含まない
  （`backend/` 配下にGCPや外部HTTPを呼ぶコードは無い）。
- 環境変数（`API_KEY` 等）は `--set-env-vars` の平文で渡しており、Secret Managerを使わない。
- 標準出力・標準エラーのログはCloud Runの基盤が収集するため、ランタイム用SAに `roles/logging.logWriter` は不要。
- イメージのpullはランタイム用SAではなくCloud Runのサービスエージェント
  （`service-769416410713@serverless-robot-prod.iam.gserviceaccount.com`）が行う（同じプロジェクトのArtifact Registryなので追加設定不要）。

将来アプリがGCPのサービスを使うようになったら、そのとき必要なロールだけをリソース単位でこのSAに付けます。

```bash
gcloud iam service-accounts create "${RUNTIME_SA_NAME}" \
  --display-name="tasksupport-demo runtime" \
  --description="Cloud Run tasksupport-demo のランタイム用。ロールは付与しない。鍵は作成しない"
```

- 確認: `gcloud iam service-accounts describe "${RUNTIME_SA}" --format='value(email,disabled)'` が表示されること。
  次のコマンドが**空**であること（プロジェクト単位のロールが無い）。
  ```bash
  gcloud projects get-iam-policy "${PROJECT_ID}" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:${RUNTIME_SA}" --format='value(bindings.role)'
  ```
  `gcloud iam service-accounts keys list --iam-account="${RUNTIME_SA}" --managed-by=user` も空であること。
- 取り消し: G-7を元のSAに戻し、G-11の付与を外してから `gcloud iam service-accounts delete "${RUNTIME_SA}"`。

### G-7. `tasksupport-demo` のランタイム用SAを切り替える（管理者が一度だけ手作業で行う）

**この切り替えは、自動デプロイを有効にする前に一度だけ行う手作業です。デプロイ用SAやGitHub Actionsではなく、
プロジェクトの管理者（オーナー権限のユーザー）が自分の権限で実行します。** 以後の自動デプロイ
（`gcloud run deploy --image=...` だけ）は、ランタイム用SAの設定をそのまま引き継ぎます。

まず、現在の設定を記録します（取り消しと動作確認で使う）。

```bash
export ORIGINAL_RUNTIME_SA=$(gcloud run services describe "${RUN_SERVICE}" --region="${REGION}" \
  --format='value(spec.template.spec.serviceAccountName)')
# 空の場合は、Compute Engineのデフォルトサービスアカウントで動いている
export ORIGINAL_RUNTIME_SA="${ORIGINAL_RUNTIME_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"
echo "${ORIGINAL_RUNTIME_SA}"

# 切り替え前の設定一式（イメージのダイジェスト・環境変数・インスタンス数など）を控える
gcloud run services describe "${RUN_SERVICE}" --region="${REGION}" --format=export > /tmp/tasksupport-demo-before.yaml
gcloud run revisions describe \
  "$(gcloud run services describe "${RUN_SERVICE}" --region="${REGION}" --format='value(status.latestReadyRevisionName)')" \
  --region="${REGION}" --format='value(status.imageDigest)'
```

`/tmp/tasksupport-demo-before.yaml` には環境変数が平文で入ります（中身は公開済みのデモ用API Key等で
個人利用環境のAPI Keyは含まない）が、確認が済んだら削除してください。

切り替えます。**`--service-account` 以外のフラグは付けません**（イメージ・環境変数・`--max-instances=1`・
`--min-instances=0`・メモリ・CPU・公開設定はすべて現在の値を引き継ぐ）。

```bash
gcloud run services update "${RUN_SERVICE}" \
  --region="${REGION}" \
  --service-account="${RUNTIME_SA}"
```

> 注意: `services update` は新しいリビジョンを作ります。サービスのイメージ指定がタグ（`backend:latest`）の場合、
> Cloud Runは新しいリビジョンを作るときにタグを改めてダイジェストに解決します。VM用に `latest` を手動更新した後だと、
> 意図せず新しいイメージに切り替わることがあるため、上で控えたダイジェストと切り替え後のダイジェストを比べ、
> 違っていたら取り消すか、控えたダイジェストを指定して直す
> （`gcloud run services update ... --image=asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport/backend@<控えたダイジェスト>`）。
> また新しいリビジョンの起動時にデモデータは初期状態に戻ります（コールドスタート時と同じ挙動）。

- 確認:
  ```bash
  # ランタイム用SAが切り替わっていること
  gcloud run services describe "${RUN_SERVICE}" --region="${REGION}" \
    --format='value(spec.template.spec.serviceAccountName,status.latestReadyRevisionName)'
  # 新しいリビジョンのイメージダイジェストが、切り替え前に控えたものと同じであること
  gcloud run revisions describe \
    "$(gcloud run services describe "${RUN_SERVICE}" --region="${REGION}" --format='value(status.latestReadyRevisionName)')" \
    --region="${REGION}" --format='value(status.imageDigest)'
  # 切り替え前との差分が serviceAccountName（とリビジョン名など自動で変わる項目）だけであること
  gcloud run services describe "${RUN_SERVICE}" --region="${REGION}" --format=export \
    | diff /tmp/tasksupport-demo-before.yaml - ; rm -f /tmp/tasksupport-demo-before.yaml
  # アプリが動くこと（公開済みのデモ用API Key。200とシード済みの授業一覧が返る）
  curl -sS -o /dev/null -w '%{http_code}\n' -H 'X-API-Key: demo-fb6713027aa00b2a' \
    https://tasksupport-demo-769416410713.asia-northeast1.run.app/courses
  ```
  あわせてデモ用フロントエンド（`https://frontend-silk-kappa-cub22v0dtl.vercel.app`）で一覧が表示されることと、
  `gcloud run services logs read "${RUN_SERVICE}" --region="${REGION}" --limit=50` に権限エラー（`PERMISSION_DENIED` 等）が無いことを確認する。
- 取り消し（元のSAに戻す）:
  ```bash
  gcloud run services update "${RUN_SERVICE}" --region="${REGION}" \
    --service-account="${ORIGINAL_RUNTIME_SA}"
  ```
  急ぎの場合は、切り替え前のリビジョンへトラフィックを戻しても良い
  （`gcloud run services update-traffic "${RUN_SERVICE}" --region="${REGION}" --to-revisions=<切り替え前のリビジョン名>=100`）。
  ただし元のSAに戻した場合、自動デプロイを動かすにはデプロイ用SAに元のSAへの `actAs` が必要になるため、
  **自動デプロイは有効にしない**（G-11の付与は専用SA上だけのままにし、デフォルトSAへは付けない）。

G-7の切り替えでは、Cloud Runは既存の `tasksupport/backend:latest` のイメージを使ったままです。自動デプロイの
初回以降、Cloud Runは自動デプロイ専用リポジトリのイメージ（`tasksupport-demo/backend:<コミットSHA>`）を使うようになります。
VMの手動更新は従来どおり `tasksupport/backend:latest` を使います。

### G-8. 自動デプロイ専用のArtifact Registryリポジトリを作成する

```bash
gcloud artifacts repositories create "${AR_REPO}" \
  --location="${REGION}" \
  --repository-format=docker \
  --description="GitHub Actionsの自動デプロイ用（Cloud Run tasksupport-demo）。VM用のイメージは置かない"
```

Cloud Runのイメージ取得は、ランタイム用SAではなくCloud Runのサービスエージェント
（`service-769416410713@serverless-robot-prod.iam.gserviceaccount.com`）が行います。サービスエージェントには
Cloud Run API有効化時にプロジェクト単位で `roles/run.serviceAgent` が自動で付き、このロールに同じプロジェクトの
Artifact Registryからイメージを読み取る権限が含まれるため、**同じプロジェクト内の新しいリポジトリなら追加の付与は不要**です
（既存の `tasksupport` リポジトリからのpullも、この仕組みで動いています）。専用ランタイムSAにロールを付けない方針は変えません。

- 確認:
  ```bash
  gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}" --format='value(name,format)'
  # Cloud Runのサービスエージェントに roles/run.serviceAgent が付いていること
  gcloud projects get-iam-policy "${PROJECT_ID}" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com" \
    --format='value(bindings.role)'
  ```
  1つ目が `.../repositories/tasksupport-demo  DOCKER` を返し、2つ目に `roles/run.serviceAgent` が含まれること。
  2つ目に含まれない場合（ロールが外されている場合）に限り、プロジェクト全体ではなくこのリポジトリ単位でサービスエージェントに
  読み取り権限を付ける:
  `gcloud artifacts repositories add-iam-policy-binding "${AR_REPO}" --location="${REGION}" --member="serviceAccount:service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com" --role="roles/artifactregistry.reader"`。
  イメージの取得ができることは、後続タスクの初回自動デプロイが成功すること（リビジョンがReadyになること）で確かめる。
- 取り消し: Cloud Runが既にこのリポジトリのイメージで動いている場合は、先に既存のイメージに戻す
  （`gcloud run deploy "${RUN_SERVICE}" --region="${REGION}" --image=asia-northeast1-docker.pkg.dev/${PROJECT_ID}/${AR_REPO_VM}/backend:latest`）。
  そのうえでG-9の付与を外し、`gcloud artifacts repositories delete "${AR_REPO}" --location="${REGION}"`（中のイメージも削除される）。

### G-8a. 専用リポジトリにクリーンアップポリシーを設定する（新しいものから5個を残す）

自動デプロイはmasterへのpushのたびに `backend:<コミットSHA>` を1つ増やすため、放っておくと保存量が増え続け、
Artifact Registryの無料枠を超えやすくなります。そこで自動デプロイ専用リポジトリ `tasksupport-demo` にだけ
クリーンアップポリシーを設定し、**新しいものから5個のイメージを残して、それより古いものは自動で削除**します。
VM用の既存の `tasksupport` リポジトリ（`backend:latest`）には設定しません。

5個残す理由:

- Cloud Runが今使っているイメージ（最新のデプロイ）は、常に新しいものから数えて上位に入るので消えない。
  `min-instances=0` のためコールドスタートのたびにリビジョンが起動し直すので、使用中のイメージは消してはいけない。
- 直前の数回分が残るので、問題があったときに前の版へ切り戻せる
  （`gcloud run deploy "${RUN_SERVICE}" --region="${REGION}" --image=asia-northeast1-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/backend:<戻したいSHA>`、
  または `gcloud run services update-traffic` で前のリビジョンへ戻す）。
- 注意: 古いSHAのイメージへ切り戻した場合、使用中のイメージは既に「新しい5個」の後ろの方にあるため、その後わずかな回数の
  pushで削除対象になります。切り戻した後は、原因を直すまでmasterへのpushを控えるか、手順1のコマンド（`--dry-run`）を
  再実行してドライランに戻してください。
- 注意: イメージのpushはCloud Runへのデプロイより前に行うため、「pushは成功したがデプロイが失敗した」状態が5回以上続くと、
  Cloud Runが実際に使っているイメージが5個の外に出て削除対象になり得ます。デプロイ失敗が続いたときは、
  原因を直すまでmasterへのpushを控えるか、G-8aの取り消し（ポリシーの削除）で削除を止めてください。

ポリシー定義はリポジトリにコミットしてある [`./cleanup-policy.json`](./cleanup-policy.json) を使います。

```json
[
  {
    "name": "keep-5-most-recent",
    "action": {"type": "Keep"},
    "mostRecentVersions": {
      "packageNamePrefixes": ["backend"],
      "keepCount": 5
    }
  },
  {
    "name": "delete-older",
    "action": {"type": "Delete"},
    "condition": {
      "tagState": "any"
    }
  }
]
```

- `delete-older` はタグの有無を問わずすべてのバージョンを削除対象にし、`keep-5-most-recent` が `backend`
  パッケージの新しいものから5個を残します。Artifact RegistryではKeepポリシーがDeleteポリシーより優先されるため、
  組み合わせると「新しい5個以外を削除」になります。
- **前提: 自動デプロイのworkflowは、provenance（来歴）やSBOMなどの追加マニフェストを付けずにpushする**
  （`docker/build-push-action` の `provenance: false` 等。後続タスクの受け入れ条件で必須にしている）。
  付けると1回のpushがイメージインデックスとタグの無い子マニフェストに分かれ、子マニフェストが `delete-older` の
  対象になって、使用中のイメージが壊れる（コールドスタートできなくなる）おそれがある。
- ポリシーは即座には実行されず、Artifact Registryがバックグラウンドで定期的に（目安として1日1回程度）評価・削除します。

最初は**ドライラン**で設定し、どのバージョンが削除対象になるかを確かめてから本番適用します
（リポジトリ作成直後はイメージが無いので、後続タスクで自動デプロイが6回以上動いた後に確認するのが確実です）。

```bash
# 1. ドライランで設定（実際には削除しない）。リポジトリルートで実行
gcloud artifacts repositories set-cleanup-policies "${AR_REPO}" \
  --location="${REGION}" \
  --policy=deploy/github-actions/cleanup-policy.json \
  --dry-run
```

```bash
# 2. ドライランの結果を確かめた後、本番適用（実際に削除が行われるようになる）
gcloud artifacts repositories set-cleanup-policies "${AR_REPO}" \
  --location="${REGION}" \
  --policy=deploy/github-actions/cleanup-policy.json \
  --no-dry-run
```

- 確認:
  - `gcloud artifacts repositories list-cleanup-policies "${AR_REPO}" --location="${REGION}"` に
    `keep-5-most-recent` と `delete-older` の2つが表示されること。
  - `gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}" --format='value(cleanupPolicyDryRun)'`
    が、手順1の後は `True`、手順2の後は空または `False` になること。
  - 既存の `tasksupport` リポジトリに設定されていないこと:
    `gcloud artifacts repositories list-cleanup-policies "${AR_REPO_VM}" --location="${REGION}"` が空であること。
  - ドライランの結果は、リポジトリにコミットしてある確認スクリプト [`./check-cleanup-dry-run.sh`](./check-cleanup-dry-run.sh)
    （読み取りのコマンドだけで、GCPの状態は変えない）で確かめる。**スクリプトが終了コード0で終わったときだけ手順2に進む。**
    ```bash
    # リポジトリルートで、G-8aの手順1の1〜2日後（ポリシーが評価された後）に実行する
    PROJECT_ID="${PROJECT_ID}" REGION="${REGION}" AR_REPO="${AR_REPO}" RUN_SERVICE="${RUN_SERVICE}" \
      bash deploy/github-actions/check-cleanup-dry-run.sh
    echo "exit=$?"   # 0以外なら手順2に進まない
    ```
    スクリプトは次の順に確かめ、どれか1つでも満たさなければ `NG:` を表示して非ゼロで終了する。
    1. Artifact Registryの監査ログのうち、**クリーンアップのドライランによる削除予定の記録だけ**に絞った条件
       （`BatchDeleteVersions` かつ `validateOnly=true`、対象は `tasksupport-demo` リポジトリ）で数え、1件以上あること。
       手順1の `set-cleanup-policies` 自体のログなど、他の種類のログは数えない。
    2. 確認の仕組みが働いていることの検査として、`backend` のバージョンを新しい順に並べたときの6番目以降
       （新しい5個に入らないもの）のダイジェストが、**少なくとも1件**削除予定に含まれていること
       （6個未満なら、削除対象がまだ無いので止まる。自動デプロイが6回以上動いてから再実行する）。
    3. Cloud Runのトラフィックを受けている各リビジョンの `status.imageDigest` をループで取り出し、そのまま削除予定と照合して、
       **1件も含まれない**こと。リビジョン一覧が空のとき、ダイジェストが空または `sha256:` で始まらないときは中断する。
    ログは `mktemp` で作った一時ファイルに保存し、終了時に `trap` で消す（監査ログに入るのは実行者のメールアドレス・IP等だけで、
    トークン・API Keyは含まれない）。
  - 本番適用の1〜2日後に、残っているバージョンが5個（＋その後にpushされた分）になっていることを確認する:
    `gcloud artifacts docker images list "asia-northeast1-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/backend" --include-tags --sort-by=~UPDATE_TIME`
- 取り消し（ポリシーの削除）:
  ```bash
  gcloud artifacts repositories delete-cleanup-policies "${AR_REPO}" \
    --location="${REGION}" \
    --policynames=keep-5-most-recent,delete-older
  ```
  ポリシーを消すと以後の自動削除は止まりますが、**既に削除されたイメージは元に戻せません**。
  削除を一時的に止めるだけなら、手順1のコマンド（`--dry-run`）を再実行してドライランに戻してもよい。

> **確認できなかった点（実行前に `gcloud artifacts repositories set-cleanup-policies --help` と公式ドキュメントで確かめること）**:
> 以下は手元の知識に基づく記述で、この文書の作成時には公式ドキュメント・実環境で確かめていません。
> - JSONの書式（`action.type` の `Keep`/`Delete`、`mostRecentVersions.keepCount`・`packageNamePrefixes`、`condition.tagState` の `any`）と、
>   `--dry-run` / `--no-dry-run` のフラグ名・既定値（どちらも指定しない場合の挙動）。
> - `list-cleanup-policies` / `delete-cleanup-policies`（`--policynames`）のサブコマンド名と、`describe` の `cleanupPolicyDryRun` フィールド名。
> - ドライランの結果がどのログ（監査ログの種類・ログ名）に出るか、データアクセス監査ログの有効化が必要か。
> - ドライランの削除予定が出るログの種類と、確認スクリプトの `DRY_RUN_FILTER`（`methodName` が
>   `google.devtools.artifactregistry.v1.ArtifactRegistry.BatchDeleteVersions`、`protoPayload.request.validateOnly=true`、
>   `resourceName` での絞り込み）が正しいか、データアクセス監査ログの有効化が要るか、記録の中にダイジェストがどの形で入るか。
>   違っていた場合は、スクリプトのフィルタを公式ドキュメントに合わせて直してから実行する（条件が違えば1か2で止まる）。
> - `gcloud artifacts versions list --package=backend` の `name` の出力形式（スクリプトは `sha256:` の64桁を抜き出して使う）。
> - `gcloud run services describe` の `--flatten='status.traffic'` と `status.traffic.revisionName`、`gcloud run revisions describe` の
>   `status.imageDigest` のフィールド名。

### 付与する権限の一覧

**プロジェクト全体へのロール付与は行いません**（`gcloud projects add-iam-policy-binding` は使わない）。
すべてリソース単位で付与し、編集者（`roles/editor`）・オーナー（`roles/owner`）・`roles/run.admin` 等の広い権限は付けません。
G-6で作るランタイム用SAには、ロールを1つも付けません。VMが使う既存の `tasksupport` リポジトリには、デプロイ用SAの権限を一切付けません。

| # | 誰に | 対象リソース | ロール | 必要な理由 |
|---|---|---|---|---|
| G-9 | デプロイ用SA | 自動デプロイ専用のArtifact Registryリポジトリ `tasksupport-demo`（G-8） | `roles/artifactregistry.writer` | `backend:<コミットSHA>` イメージをpushするため（読み取りも含むので、Cloud Runデプロイ時のイメージ参照確認にも足りる）。リポジトリ単位なので、VMが使う `tasksupport` リポジトリ（`backend:latest`）には書き込めない。削除権限は含まない |
| G-10 | デプロイ用SA | Cloud Runサービス `tasksupport-demo` | `roles/run.developer` | 既存サービスの新しいリビジョンをデプロイ（イメージ差し替え）するため。サービス単位なので他のサービスは触れない。IAMポリシーは変更できない（公開設定を変えられない） |
| G-11 | デプロイ用SA | Cloud Run専用のランタイム用SA `tasksupport-demo-runtime`（G-6） | `roles/iam.serviceAccountUser` | Cloud Runはリビジョンをランタイム用SAの権限で動かすため、デプロイする側にそのSAへの `actAs`（`iam.serviceAccounts.actAs`）が必要。この専用SAだけに付け、**デフォルトのCompute EngineサービスアカウントへのactAsは付けない**。専用SAはロールを持たないため、actAsで権限が広がらない |
| G-12 | このリポジトリのmasterへのpushのワークフロー（Workload Identityプール経由の主体） | デプロイ用SA | `roles/iam.workloadIdentityUser` | GitHub ActionsがOIDCトークンと引き換えにデプロイ用SAを借用し、短期アクセストークンを得るため |

### G-9. 自動デプロイ専用リポジトリへの書き込み権限（このリポジトリだけ）

```bash
gcloud artifacts repositories add-iam-policy-binding "${AR_REPO}" \
  --location="${REGION}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/artifactregistry.writer"
```

- 確認: `gcloud artifacts repositories get-iam-policy "${AR_REPO}" --location="${REGION}" --format=yaml`
  に `roles/artifactregistry.writer` と `serviceAccount:github-actions-deployer@...` があること。
  あわせて、既存の `tasksupport` リポジトリのIAMポリシーにデプロイ用SAが**含まれない**こと:
  `gcloud artifacts repositories get-iam-policy "${AR_REPO_VM}" --location="${REGION}" --format=yaml | grep github-actions-deployer`
  が何も出力しないこと。
- 取り消し: 同じ引数で `gcloud artifacts repositories remove-iam-policy-binding ...`。

### G-10. Cloud Runサービスへのデプロイ権限

```bash
gcloud run services add-iam-policy-binding "${RUN_SERVICE}" \
  --region="${REGION}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/run.developer"
```

- 確認: `gcloud run services get-iam-policy "${RUN_SERVICE}" --region="${REGION}" --format=yaml`
  に `roles/run.developer` とデプロイ用SAがあり、既存の `allUsers` → `roles/run.invoker`（公開設定）も残っていること。
- 取り消し: 同じ引数で `gcloud run services remove-iam-policy-binding ...`。

### G-11. Cloud Run専用ランタイム用SAへの actAs（この専用SAの上だけ）

G-7の切り替えが済み、`tasksupport-demo` が `${RUNTIME_SA}` で動いていることを確認してから実行します。

```bash
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/iam.serviceAccountUser"
```

デフォルトのCompute Engineサービスアカウント（`769416410713-compute@developer.gserviceaccount.com`）には
この付与を**行いません**。

- 確認:
  - `gcloud iam service-accounts get-iam-policy "${RUNTIME_SA}" --format=yaml` に `roles/iam.serviceAccountUser` とデプロイ用SAがあること。
  - `gcloud iam service-accounts get-iam-policy "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" --format=yaml`
    にデプロイ用SAが**含まれない**こと。
- 取り消し: 同じ引数で `gcloud iam service-accounts remove-iam-policy-binding ...`。

### G-12. GitHub Actions（このリポジトリのmasterへのpush）にデプロイ用SAの借用を許可する

G-4の信頼条件に加え、ここでも主体を「このリポジトリ」に限定します（二重の制限）。

```bash
gcloud iam service-accounts add-iam-policy-binding "${DEPLOY_SA}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository_id/${GITHUB_REPO_ID}"
```

- 確認: `gcloud iam service-accounts get-iam-policy "${DEPLOY_SA}" --format=yaml` に
  `roles/iam.workloadIdentityUser` と `principalSet://.../attribute.repository_id/<数値ID>` があること。
  `roles/iam.serviceAccountTokenCreator` や `roles/iam.serviceAccountKeyAdmin` が**付いていない**こと。
- 取り消し: 同じ引数で `gcloud iam service-accounts remove-iam-policy-binding ...`
  （これを外すだけで、GitHub ActionsからGCPへのデプロイは即座にできなくなる）。

### G-13. GCP側の最終確認

```bash
# デプロイ用SA・ランタイム用SAにプロジェクト単位のロールが1つも付いていない（どちらも空であること）
for SA in "${DEPLOY_SA}" "${RUNTIME_SA}"; do
  echo "== ${SA}"
  gcloud projects get-iam-policy "${PROJECT_ID}" --flatten='bindings[].members' \
    --filter="bindings.members:serviceAccount:${SA}" --format='value(bindings.role)'
done

# ユーザー管理の鍵が無い（空であること）
gcloud iam service-accounts keys list --iam-account="${DEPLOY_SA}" --managed-by=user
gcloud iam service-accounts keys list --iam-account="${RUNTIME_SA}" --managed-by=user

# VM用の既存リポジトリ tasksupport にデプロイ用SAの権限が無い（何も出力されないこと）
gcloud artifacts repositories get-iam-policy "${AR_REPO_VM}" --location="${REGION}" --format=yaml | grep github-actions-deployer

# tasksupport-demo が専用のランタイム用SAで動いている
gcloud run services describe "${RUN_SERVICE}" --region="${REGION}" \
  --format='value(spec.template.spec.serviceAccountName)'
```

実際にGitHubから認証できること・できないこと（PRや他ブランチから拒否されること）は、後続タスクの
workflow追加後に、masterへのpushとプルリクエストの両方で確認します。

---

## Vercel側の設定

### V-1. GitHub Actions用のトークンを発行する

1. Vercelにログインし、<https://vercel.com/account/settings/tokens> を開く。
2. 「Create Token」で次のとおり作成する。
   - Token Name: `github-actions-tasksupport`
   - Scope: 2プロジェクトが属するチーム（ID `team_QrGhVoQu9Cohe9vL6l9sWxaz`）**だけ**を選ぶ（「Full Account」は選ばない）
   - Expiration: 期限付き（例: 1年）。期限が来たら発行し直してH-1の `VERCEL_TOKEN` を更新する
3. 表示されたトークンは**画面からそのまま手順H-1の `gh secret set` の入力にだけ使い**、ファイル・チャット・
   ドキュメント・シェルの履歴には残さない（このドキュメントにも値は書かない）。

- 確認: トークン一覧に `github-actions-tasksupport` が表示され、Scopeがチームになっていること。
- 取り消し: 同じ画面でトークンを「Delete」する（即座に無効になる）。あわせてH-1のSecretも削除する。

### V-2. 2プロジェクトの識別情報を確認する

Vercel CLIでのデプロイには、チーム（org）IDとプロジェクトIDが必要です。値は秘密情報ではありません。

| 項目 | 値 |
|---|---|
| チーム（org）ID | `team_QrGhVoQu9Cohe9vL6l9sWxaz` |
| デモ用 `frontend` のプロジェクトID | `prj_uL7v5KvvXzu3vMsRjKtMHgYJYbmT` |
| 個人用 `tasksupport-personal-frontend` のプロジェクトID | `prj_3u4SA2oOclU28nEX5CQyo0OVbMvw` |

確認方法（どちらか）:

- Vercelのダッシュボードで各プロジェクトの「Settings」→「General」の「Project ID」、チームの「Settings」→「General」の「Team ID」を見る。
- ローカルで `vercel link` 済みのディレクトリなら `.vercel/project.json` の `projectId` / `orgId` を見る
  （`frontend/.vercel/project.json` はデモ用 `frontend` にリンクされている。`.vercel/` はgit管理外）。

あわせて、後続タスクのworkflowを書く前に各プロジェクトについて次を確認しておきます（状態は変えない）。

- 「Settings」→「Build and Deployment」の **Root Directory**（CLIをリポジトリルートと `frontend/` のどちらで実行するかが決まる）
- 「Settings」→「Environment Variables」で Production の `VITE_API_BASE_URL` が設定済みであること
  （デモ用はCloud RunのURL、個人用はVMのURL。workflowは `vercel pull --environment=production` でこれを取得してビルドする）

- 取り消し: 不要（読み取りのみ）。

---

## GitHub側の設定

`gh auth login` 済み（リポジトリの管理者権限あり）の端末で実行します。

### H-1. Secretを登録する

```bash
# 値を引数に書かず、プロンプトに貼り付けて入力する（画面に表示されず、シェル履歴にも残らない）
gh secret set VERCEL_TOKEN --repo shino0415/TaskSupport
```

- 確認: `gh secret list --repo shino0415/TaskSupport` に `VERCEL_TOKEN` が表示されること（値は表示されない）。
- 取り消し: `gh secret delete VERCEL_TOKEN --repo shino0415/TaskSupport`。

### H-2. Variablesを登録する

```bash
gh variable set VERCEL_ORG_ID              --repo shino0415/TaskSupport --body "team_QrGhVoQu9Cohe9vL6l9sWxaz"
gh variable set VERCEL_PROJECT_ID_DEMO     --repo shino0415/TaskSupport --body "prj_uL7v5KvvXzu3vMsRjKtMHgYJYbmT"
gh variable set VERCEL_PROJECT_ID_PERSONAL --repo shino0415/TaskSupport --body "prj_3u4SA2oOclU28nEX5CQyo0OVbMvw"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo shino0415/TaskSupport \
  --body "projects/769416410713/locations/global/workloadIdentityPools/github-actions/providers/github"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo shino0415/TaskSupport \
  --body "github-actions-deployer@tasksupport-portfolio.iam.gserviceaccount.com"
```

- 確認: `gh variable list --repo shino0415/TaskSupport` に5つの名前と値が表示されること。
- 取り消し: `gh variable delete <名前> --repo shino0415/TaskSupport`（5つそれぞれ）。

### H-3. Actionsの設定を確認する（状態は変えない）

- 「Settings」→「Actions」→「General」の「Fork pull request workflows」で、フォークからのPRにSecretsを
  渡す設定（「Send secrets and variables to workflows from fork pull requests」）が**オフ**であること
  （既定でオフ。GCP側はG-4の条件でフォークを拒否するが、`VERCEL_TOKEN` はGitHub側の設定で守られる）。
- 「Workflow permissions」が「Read repository contents and packages permissions」（読み取りのみ）であること。

---

## 全体の取り消し（自動デプロイをやめる場合）

上から順に行えば、外部サービスの状態をこの手順の実行前に戻せます。

1. GitHub: `gh secret delete VERCEL_TOKEN` と `gh variable delete`（5つ）を実行（H-1・H-2）。
2. Vercel: トークン `github-actions-tasksupport` を削除（V-1）。
3. GCP: G-12 → G-11 → G-10 → G-9 の順に `remove-iam-policy-binding`、G-5のデプロイ用SAを削除、
   G-4のプロバイダ・G-3のプールを削除。G-1で有効化したAPIは必要に応じて無効化。
   自動デプロイ専用リポジトリ（G-8）は、Cloud Runを既存の `tasksupport/backend:latest` に戻してから削除する（G-8の取り消し参照）。
   リポジトリを残す場合は、G-8aのクリーンアップポリシーも必要に応じて削除する（リポジトリごと削除するならポリシーも一緒に消える）。
4. GCP（ランタイム用SAも元に戻す場合だけ）: G-7の取り消しで `tasksupport-demo` を元のSAに戻し、動作確認してから
   G-6の専用ランタイム用SAを削除する。専用SAはロールを持たないので、自動デプロイをやめるだけなら残しておいても害は無い。

既存の手動デプロイ（[`../cloud-run/README.md`](../cloud-run/README.md) の `gcloud builds submit` / `gcloud run deploy`、
Vercelへの手動デプロイ）はユーザー自身の権限で行うため、上記を取り消しても影響を受けません。

## 実行記録

（未実行）
