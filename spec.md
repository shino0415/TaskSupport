# 案件・選考トラッカー API 仕様書

個人用ツール。CrowdWorks等の受注案件の稼働時間管理と時給換算、就活の選考進捗管理を行う。
完全に独立した2つのドメイン（案件系／選考系）を1つのAPIにまとめる。

## 技術構成

- FastAPI + Pydantic
- SQLite + SQLAlchemy（`Base.metadata.create_all`で初期化、Alembic不使用）
- 認証: 簡易API Key方式（本人専用ツールのため）
- テスト: pytest（ステータス遷移の警告ロジックの単体テスト、FastAPI TestClientでのエンドポイントテスト）
- CI/CD: GitHub Actions（lint: ruff → test: pytest → build: Dockerマルチステージ → deploy）
- フロントエンド: React + Vite + TypeScript のSPA。同一リポジトリの `frontend/` 配下に配置するモノレポ構成（本ドキュメントの対象に含む）
- フロントエンドはAPIとは別オリジンで動作するため、バックエンド側にCORS設定が必要。許可オリジンは環境変数でカンマ区切り指定（未設定時は許可なし）

## 全体設計方針

- **案件系（Project/Task/WorkLog）と選考系（Company/InterviewStep）は完全に独立したドメイン**。relationやロジックの共有はない
- 削除は全テーブル共通で **is_deleted フラグによる論理削除**（物理削除はしない。ヒューマンエラー対策）
  - 全GET系エンドポイントはデフォルトで `is_deleted=false` のレコードのみ返す
- 親の詳細取得（`GET /projects/{id}` 等）では **子テーブルの情報を含めない**。子一覧が必要な場合は別エンドポイントを叩く
- ステータス変更は **ブロックしない**。不自然な逆行遷移を検知した場合のみ、レスポンスに `warning` フィールドを含めて200を返す（入力ミス訂正の妨げにならないようにするため）

## テーブル設計

### Project（案件）

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER (PK) | |
| name | TEXT | 案件名 |
| client_name | TEXT | クライアント名 |
| status | TEXT | 提案中/契約中/納品済み/完了/見送り |
| reward | INTEGER | 固定報酬額（時給制案件は対象外） |
| applied_date | DATE | 応募日 |
| deadline | DATE (nullable) | 納期 |
| platform | TEXT | CrowdWorks等、経由プラットフォーム |
| memo | TEXT (nullable) | |
| is_deleted | BOOLEAN | デフォルト false |

relation: `project (1) --- (多) task`

### Task（タスク、Projectに1対多）

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER (PK) | |
| project_id | INTEGER (FK → project.id) | |
| name | TEXT | タスク名 |
| status | TEXT | 未着手/処理中/完了 |
| memo | TEXT (nullable) | |
| is_deleted | BOOLEAN | デフォルト false |

relation: `task (1) --- (多) work_log`

将来の拡張候補（未実装）: 表示順序用の `order` (INTEGER) カラム。間隔を空けた採番（10, 20, 30...）を推奨。優先度低、必要になったタイミングで着手。

### WorkLog（稼働ログ、Taskに1対多）

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER (PK) | |
| task_id | INTEGER (FK → task.id) | |
| started_at | DATETIME (nullable) | 計測開始ボタン押下時刻 |
| ended_at | DATETIME (nullable) | 計測終了ボタン押下時刻。NULLの間は「進行中」を意味する |
| memo | TEXT (nullable) | |
| is_deleted | BOOLEAN | デフォルト false |

- 稼働時間は保存せず `ended_at - started_at` で都度計算する（`started_at`修正時の不整合を避けるため）
- 同一タスク内での多重start（進行中ログが複数存在すること）を許可する
- 案件間・タスク間の同時進行も許可する

### Company（企業）

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER (PK) | |
| name | TEXT | 企業名 |
| is_deleted | BOOLEAN | デフォルト false |

relation: `company (1) --- (多) interview_step`

### InterviewStep（選考ステップ、Companyに1対多）

| カラム | 型 | 説明 |
|---|---|---|
| id | INTEGER (PK) | |
| company_id | INTEGER (FK → company.id) | |
| type | TEXT | 書類選考/一次面接/二次面接/最終面接など |
| date | DATE (nullable) | 予定日 |
| prep_status | TEXT | 準備中/準備万端/完了 |
| result | TEXT | 未定/通過/不通過 |
| memo | TEXT (nullable) | |
| is_deleted | BOOLEAN | デフォルト false |

## ステータス遷移の警告ロジック

ブロックはせず、逆行遷移を検知したら `warning` メッセージ付きで200を返す。共通の純粋関数として実装する。

「見送り」「不通過」のような分岐的な結果ステータスを1本の順序リストに無理やり押し込まないよう、**各ステータスから遷移してよい先（forward_edges）を個別に定義する状態遷移グラフ**として持つ。判定は単純なindex比較ではなく、グラフ上の到達可能性で行う。

```python
def check_backward_transition(
    forward_edges: dict[str, list[str]], from_status: str, to_status: str
) -> str | None:
    """明確な逆行遷移（to_statusがfrom_statusの前段階であるとグラフ上で判別できる場合）のみ
    警告メッセージを返す。順当な遷移（隣接・複数段飛び越え含む）や、
    枝分かれ先同士の無関係な遷移ではNoneを返す。"""
    if to_status == from_status:
        return None
    if _is_reachable(forward_edges, from_status, to_status):
        return None
    if _is_reachable(forward_edges, to_status, from_status):
        return f"{from_status} から {to_status} への変更です。意図的な変更か確認してください。"
    return None


def _is_reachable(forward_edges: dict[str, list[str]], start: str, goal: str) -> bool:
    """startからgoalへforward_edgesを辿って到達できるか（幅優先探索等で判定）"""
```

適用箇所と状態遷移グラフ（確定）:

- `Project.status`:
  - 提案中 → [契約中, 見送り]
  - 契約中 → [納品済み, 見送り]
  - 納品済み → [完了]
  - 完了 → []（終端）
  - 見送り → []（終端）
- `Task.status`（分岐なし、線形）:
  - 未着手 → [処理中]
  - 処理中 → [完了]
  - 完了 → []（終端）
- `InterviewStep.prep_status`（分岐なし、線形）:
  - 準備中 → [準備万端]
  - 準備万端 → [完了]
  - 完了 → []（終端）
- `InterviewStep.result`:
  - 未定 → [通過, 不通過]
  - 通過 → []（終端）
  - 不通過 → []（終端）

既知のトレードオフ（意図的な仕様）: グラフ上どちらの方向にも到達不可能な「枝分かれ先同士」の遷移（例: `完了`→`見送り`）は、明確な逆行とは判定できないため警告対象外となる。入力ミス訂正を妨げないという設計方針を優先した結果であり、バグではない。

pytestでの単体テストの対象として、この関数の境界値（同一ステータス、隣接遷移、飛び越え遷移、明確な逆行、枝分かれ先同士の無関係な遷移）を網羅する。

## エンドポイント一覧

### 案件系（Project）

| Method | Path | 説明 |
|---|---|---|
| POST | `/projects` | 案件作成 |
| GET | `/projects` | 案件一覧（`is_deleted=false`のみ、ステータスでフィルタ可） |
| GET | `/projects/{id}` | 案件詳細（自テーブルのみ、子は含めない） |
| PATCH | `/projects/{id}` | 案件更新（ステータス逆行時は`warning`フィールド付きで200） |
| DELETE | `/projects/{id}` | 論理削除（`is_deleted=true`） |
| GET | `/projects/{id}/hourly-rate` | 時給換算（reward ÷ 配下タスクの合計稼働時間） |

### タスク系（Task）

| Method | Path | 説明 |
|---|---|---|
| POST | `/projects/{id}/tasks` | タスク作成 |
| GET | `/projects/{id}/tasks` | その案件のタスク一覧 |
| PATCH | `/tasks/{id}` | タスク更新（ステータス逆行時warning） |
| DELETE | `/tasks/{id}` | 論理削除 |

### 稼働ログ系（WorkLog）

| Method | Path | 説明 |
|---|---|---|
| POST | `/tasks/{id}/work-logs/start` | 計測開始（新規レコード作成、`started_at`に現在時刻。多重start許可） |
| PATCH | `/work-logs/{id}/stop` | 計測終了（`ended_at`に現在時刻） |
| GET | `/tasks/{id}/work-logs` | そのタスクの稼働ログ一覧 |
| DELETE | `/work-logs/{id}` | 論理削除（誤start取り消し用） |

### 選考系（Company / InterviewStep）

| Method | Path | 説明 |
|---|---|---|
| POST | `/companies` | 企業登録 |
| GET | `/companies` | 企業一覧 |
| GET | `/companies/{id}` | 企業詳細（自テーブルのみ） |
| DELETE | `/companies/{id}` | 論理削除 |
| POST | `/companies/{id}/interview-steps` | 選考ステップ追加 |
| GET | `/companies/{id}/interview-steps` | その企業の選考ステップ一覧 |
| PATCH | `/interview-steps/{id}` | 更新（逆行時warning） |
| DELETE | `/interview-steps/{id}` | 論理削除 |

### 横断系

| Method | Path | 説明 |
|---|---|---|
| GET | `/interview-steps/upcoming` | 日付が近い選考ステップ一覧（締切管理） |
| GET | `/work-logs/running` | 現在進行中（`ended_at IS NULL`）の全ログ一覧 |

## 決定事項

以下はユーザーの判断により確定した。各エンドポイントのリクエスト/レスポンスのPydanticスキーマやバリデーションルールの具体的な書き方はこの分類には含めず、実装時にgeneratorが判断してよい技術的詳細として扱う。デプロイ先（Railway/Fly.io等）の選定は今回の開発サイクルでは扱わない。

### API Key認証の方式（確定: 環境変数の固定キー）

環境変数に単一の固定キーを設定し、リクエストヘッダー（例: `X-API-Key`）で照合するシンプルな方式を採用する。1人専用ツールとして運用する前提のため、キーのローテーションや複数発行の機能は設けない。将来ログイン認証（パスワード等）へ差し替える可能性を考慮し、認証チェックはFastAPIの`Depends`等を用いて業務ロジックから独立した1箇所の関門として実装し、差し替えコストを低く保つ。

### ステータス遷移の状態順序と分岐ステータスの位置づけ（確定: 状態遷移グラフ方式）

順序リストへの追加ではなく、状態遷移をグラフとして表現する方式を採用した。詳細は「## ステータス遷移の警告ロジック」セクションを参照。

### CORSの許可オリジン指定方針（確定: 環境変数へのカンマ区切り列挙、未設定時は許可なし）

許可するオリジンを環境変数（例: `CORS_ALLOW_ORIGINS`）にカンマ区切りで列挙する方式を採用する。API Key認証と同じく環境変数で運用することで、開発環境（ローカルの開発サーバー）と本番環境を設定値の差し替えだけで切り替えられる。環境変数が未設定・空の場合はどのオリジンも許可しない fail-closed とし、設定漏れが「全オリジン許可」という危険側に倒れないようにする。ワイルドカードによる全許可を既定にはしない。

### フロントエンドのスタック（確定: React + Vite + TypeScript のSPA）

フロントエンドはReact + Vite + TypeScriptによるSPAとして実装する。既存のAPIをそのまま利用するクライアントであり、サーバーサイドレンダリングを必要とする要件（SEO等）が無いこと、型でAPIのレスポンス構造を扱えることを重視した選定。

### フロントエンドのコード配置（確定: 同一リポジトリの `frontend/` 配下、モノレポ構成）

フロントエンドは別リポジトリに分けず、本リポジトリの `frontend/` 配下に置くモノレポ構成とする。1人で開発・運用する個人用ツールであり、APIとフロントエンドの変更が同時に発生することが多いため、履歴とレビュー単位を1つに保てる利点を優先した。バックエンド側のCIジョブ・Dockerビルドの対象範囲に影響が出ないよう、ビルド成果物や依存関係ディレクトリは適切に除外する。

### フロントエンドで実装する画面の範囲（確定: 案件系・選考系の全機能）

案件CRUD・タスク管理・稼働計測・時給換算・企業/選考ステップ管理・横断一覧（upcoming / running）まで、「## エンドポイント一覧」に定義した既存APIを一通り画面から操作できる範囲を対象とする。一部機能のみのプロトタイプには留めない。

### API Keyのブラウザ側での扱い（確定: 画面で入力し sessionStorage に保持）

フロントエンドはAPI Keyをソースコードやビルド時の環境変数に埋め込まず、画面上の入力欄でユーザーが入力する方式とする。入力されたキーは `sessionStorage` に保持し、リロード後は再入力なしで使えるがタブを閉じると破棄される状態にする。永続化（`localStorage`）は、ブラウザを閉じても残る分だけ端末共有時やXSS発生時の漏洩範囲が広がるため採用しない。メモリのみの保持は最も安全だがリロードのたびに再入力が必要で、日常的に稼働計測を行う用途には手間が勝ると判断した。ビルド時の環境変数への埋め込みは、配布されたJSを読めば誰でもキーを取得できるため採用しない。

### フロントエンドのUI方針（確定: UIライブラリを導入する）

一覧・フォーム・ダイアログが中心の画面構成であり、テーブルや入力系コンポーネントを自作するコストを避けるため、UIライブラリ（MUI等）を導入する。依存は重くなるが、案件系・選考系の全機能という画面範囲を素早く形にすることを優先した。具体的なライブラリの選定・バージョンは実装時の技術的詳細として扱う。

## 実装タスク

### タスク: DBモデル定義とDB初期化
- status: 完了
- 概要: 案件系・選考系の全5テーブル（Project/Task/WorkLog/Company/InterviewStep）をテーブル設計通りに永続化できるようにし、アプリ起動時にDBファイルとテーブルが自動生成される状態を作る。
- 受け入れ条件:
  - [ ] アプリケーション起動時、DBファイルやテーブルが存在しなければ自動生成される
  - [ ] 各テーブルの列がテーブル設計の型・nullable・デフォルト値の通りに定義されている
  - [ ] is_deletedカラムが全テーブルに存在し、デフォルトでfalseになっている
  - [ ] Project→Task、Task→WorkLog、Company→InterviewStepの親子関係が外部キーとして表現されている
- セキュリティエバリュエーターのフィードバック: Critical/High相当の問題なし。app/database.py, app/models.py, app/main.py, tests/test_db_init.py、.gitignore、pyproject.tomlを確認。生SQL文字列結合なし（全てSQLAlchemy ORM経由）、DB接続情報はハードコードされておらずDATABASE_URL環境変数から取得（デフォルトはローカルsqliteファイルのみ）、APIキー等の秘密情報のハードコード・ログ出力なし、`.gitignore`に`.env`・`*.db`・`*.sqlite3`・`.venv`が適切に除外設定済み。全テーブルでis_deletedがnullable=False・default=False・server_default=false()でDBレベルのデフォルトも保証されており（test_is_deleted_defaults_to_false_at_db_levelで検証済み）、論理削除方針に沿っている。本タスクの範囲にはエンドポイント・認証・CORS設定は含まれておらず（別タスクで対応予定のため妥当）、FastAPIアプリのdebugモードやSQLAlchemy engineのecho=Trueも有効化されておらず、この時点で情報漏洩の経路はない。テストも9件すべてpass。
  - 補足（ブロッキングではない参考情報）: SQLiteは`PRAGMA foreign_keys=ON`を明示しない限りデフォルトで外部キー制約を実行時に強制しない。本タスクの受け入れ条件（外部キーとして表現されていること）はモデル定義・スキーマレベルでは満たされておりテストでも検証済みだが、今後CRUDエンドポイント実装時に参照整合性を担保したい場合はPRAGMA有効化を検討してもよい（本人専用・論理削除のみの運用のため直ちにセキュリティ上の問題にはならない）。
  - 再評価（性能エバリュエーターによる差し戻し対応後）: 性能エバリュエーターの指摘を受けてgeneratorが`tests/test_db_init.py`にカラム型の`isinstance`アサーション（全5テーブル）と、`is_deleted`のDBレベルデフォルト検証の対象拡大（Project/Companyの2テーブルのみ→全5テーブル）を追加したことを確認。差分はテストファイルのみ（`app/database.py`・`app/models.py`・`app/main.py`に変更なし）だが、念のため4ファイルおよび`.gitignore`・`pyproject.toml`を再確認した。追加されたinsert文もSQLAlchemyのORM経由（`insert(models.X.__table__).values(...)`）でパラメータ化されており生SQL結合なし。ハードコードされた秘密情報・ログ出力なし。`is_deleted`は全5テーブルで`nullable=False, default=False, server_default=false()`かつDBレベルのデフォルト適用がテストで検証済み。`uv run pytest -v`で9件全てpass。Critical/High相当の問題は引き続きなし。
- 性能エバリュエーターのフィードバック: `uv run pytest -v`は9件全てpass、`uv run ruff check`も違反なし。既存テストへの回帰もなし。ただし以下2点で受け入れ条件がテストにより完全には裏付けられていないため差し戻す。
  - 受け入れ条件「各テーブルの列がテーブル設計の型・nullable・デフォルト値の通りに定義されている」について、`tests/test_db_init.py`の`test_*_columns_match_spec`系テストは`nullable`のみを検証しており、カラムの型（Integer/String/Date/DateTime/Boolean等）を検証するアサーションが一切存在しない。SQLAlchemy inspectorで実際の型を確認した限り実装自体は妥当（reward=INTEGER、applied_date/deadline/date=DATE、started_at/ended_at=DATETIME、is_deleted=BOOLEAN等）だが、将来のリグレッション（例: カラム型の誤り）をテストで検知できない状態。型に対するアサーションの追加を推奨。
  - 受け入れ条件「is_deletedカラムが全テーブルに存在し、デフォルトでfalseになっている」について、DBレベルで実際にデフォルト値falseが適用されることを確認する`test_is_deleted_defaults_to_false_at_db_level`はProjectとCompanyの2テーブルのみを対象としており、Task/WorkLog/InterviewStepの3テーブルはnullable=Falseの確認のみでDBレベルのデフォルト値挿入は未検証。5テーブル全てを対象に拡大することを推奨。
  - 対応: `tests/test_db_init.py`の`test_*_columns_match_spec`系5テスト全てに、SQLAlchemy inspectorの型（`INTEGER`/`VARCHAR`/`TEXT`/`DATE`/`DATETIME`/`BOOLEAN`）に対する`isinstance`アサーションを追加した。また`test_is_deleted_defaults_to_false_at_db_level`をTask/WorkLog/InterviewStepにも拡大し、5テーブル全てでis_deletedを明示せずINSERTしてDBレベルのデフォルトfalseが適用されることを検証するようにした。`uv run pytest`（9件）・`uv run ruff check`ともに通過を確認済み。
  - 再々評価（修正後の再検証、承認）: `tests/test_db_init.py`を確認し、指摘した2点が反映済みであることを確認した。`test_project_columns_match_spec`/`test_task_columns_match_spec`/`test_work_log_columns_match_spec`/`test_company_columns_match_spec`/`test_interview_step_columns_match_spec`の5テスト全てで、各カラムに`nullable`検証に加え`isinstance(..., INTEGER/VARCHAR/TEXT/DATE/DATETIME/BOOLEAN)`の型検証が追加されている。`test_is_deleted_defaults_to_false_at_db_level`もProject/Task/WorkLog/Company/InterviewStepの5テーブル全てを対象に、is_deletedを明示せずINSERTしてDBレベルのデフォルトfalseが適用されることを検証している。`uv run pytest -v`は9件全てpass（回帰なし）、`uv run ruff check`も違反なし。受け入れ条件4点（DB自動生成／型・nullable・デフォルト値／is_deletedデフォルトfalse全5テーブル／外部キーによる親子関係表現）は全てテストで裏付けられている。アプリケーションコード・テストコードへの変更は行っていない（確認のみ）。
- 差し戻し回数: 1

### タスク: API Key認証の仕組み
- status: 完了
- 概要: 環境変数に設定した単一の固定キーを`X-API-Key`ヘッダー等で照合する認証チェックを、業務ロジックから独立した1箇所の関門（FastAPIの`Depends`等）として実装し、全エンドポイントに適用する。本人専用ツールとして未認証アクセスを弾けるようにする。
- 受け入れ条件:
  - [ ] 有効なAPI Keyを付与したリクエストは正常に処理される
  - [ ] API Keyが付与されていない、または不正な場合は認証エラー（401等）が返り、以降の処理が実行されない
  - [ ] 認証チェックが全エンドポイントに一貫して適用されている
- セキュリティエバリュエーターのフィードバック: app/auth.py, app/main.py, tests/test_auth.pyを確認。以下の問題があり差し戻す。
  - **[High] `/docs`・`/redoc`・`/openapi.json` がAPI Key認証をバイパスできる**: `app/main.py`では`FastAPI(dependencies=[Depends(verify_api_key)])`でグローバル依存関係を登録しているが、これはFastAPIの`APIRoute`（`add_api_route`/`include_router`経由で追加されるルート）にのみ適用される。一方、FastAPIのSwagger UI（`/docs`）・ReDoc（`/redoc`）・OpenAPIスキーマ（`/openapi.json`）は`FastAPI.setup()`内で`self.add_route(...)`（Starletteの素のルート登録、依存性注入の対象外）として登録されるため、グローバル`dependencies`の効果を受けない。実際に`TestClient`で検証したところ、`API_KEY`環境変数を設定した状態でも`X-API-Key`ヘッダーなしで`GET /openapi.json`・`GET /docs`・`GET /redoc`が全て200を返し、APIの全エンドポイント一覧・パスパラメータ・スキーマ構造を認証なしに閲覧できることを確認した。これは受け入れ条件「認証チェックが全エンドポイントに一貫して適用されている」に反する。今後業務エンドポイントが増えるほどOpenAPIスキーマ経由で内部構造（フィールド名等）の露出範囲が広がるため、対応を推奨する。対応案: `FastAPI(docs_url=None, redoc_url=None, openapi_url=None)`として自動公開を無効化する、または`docs_url`等を維持したいならこれらのパスに対しても`verify_api_key`相当のチェックを個別に効かせる（例: 独自のdocsルートを`Depends`付きで実装する）等。個人専用ツールという前提であればまず前者（無効化）がシンプル。
  - **[Medium/参考] `app/auth.py:20`のキー比較がタイミング攻撃に対して素朴**: `x_api_key != expected_key`は単純な文字列等価比較であり、`secrets.compare_digest`のような定数時間比較関数を使っていない。ネットワーク越しの実運用ではジッターの影響で悪用は容易ではなく、fail-closed設計・エラーメッセージへのキー非漏洩など他の実装は妥当なため、これ単体では差し戻しの主因にはしないが、`secrets.compare_digest(x_api_key, expected_key)`（`x_api_key`が`None`の場合のガードを添えて）への変更を推奨する。
  - 確認して問題なしと判断した点: fail-closed設計（`API_KEY`未設定時は`not expected_key`が真になり、いかなる入力でも401を返すことを`test_verify_api_key_rejects_any_key_when_env_var_unset`で検証済み。実挙動もTestClientで再確認した）。401レスポンスの`detail`は固定文字列`"Invalid or missing API Key"`のみで、期待キー・入力キーいずれの値も含まれずログ出力もない。`X-API-Key`ヘッダー名やヘッダー値の扱いはFastAPI/Starletteの標準的なヘッダーパース経由でありインジェクションの余地はない。生SQL・mass assignment等は本タスクの範囲外（対象コード無し）。`uv run pytest`は17件全てpass、`uv run ruff check`も違反なし。
  - 対応（差し戻しへの修正）:
    - [High] `app/main.py`の`FastAPI(...)`に`docs_url=None, redoc_url=None, openapi_url=None`を追加し、`/docs`・`/redoc`・`/openapi.json`を無効化した。本人専用ツールでありドキュメントUI公開の必要性が薄いため、フィードバックで提示された2案のうち無効化の方針を採用（個別ルートへの認証実装は行っていない）。`tests/test_auth.py`に、これら3パスがAPI Keyなし・ありいずれの場合も404になる（＝無効化されておりバイパス経路が存在しない）ことを検証するテストを追加した。
    - [Medium/参考] `app/auth.py`のキー比較を`x_api_key != expected_key`から`secrets.compare_digest(x_api_key, expected_key)`（`x_api_key is None`の場合は比較前に401とするガード付き）に変更し、定数時間比較とした。既存の単体テスト（有効/欠落/不正/未設定環境変数の4パターン）に加え、`expected_key`が空文字列の場合でもfail-closedが機能することを確認するテストを追加した。
    - `uv run pytest`は24件全てpass（新規追加7件含む）、`uv run ruff check`も違反なし。差し戻し回数はそのまま据え置き。
  - 再評価（修正後の再検証、承認）: `app/auth.py`・`app/main.py`・`tests/test_auth.py`を再確認した。
    - [High] `app/main.py`で`FastAPI(docs_url=None, redoc_url=None, openapi_url=None)`が設定されていることを確認。FastAPI/Starletteの`applications.py`の`setup()`実装を確認したところ、`openapi_url`が`None`の場合は`/openapi.json`用の`add_route`自体が呼ばれず、`docs_url`用ルート（およびそこに従属する`swagger_ui_oauth2_redirect_url`ルート）・`redoc_url`用ルートも同様にガード条件`if self.openapi_url and self.docs_url:`等が偽になり一切登録されない。したがって該当ルートは「認証なしで200を返す」状態から「そもそも存在せず404になる」状態に変わっており、バイパス経路は解消済みと判断した。`tests/test_auth.py`の`test_docs_routes_are_disabled_and_not_accessible_without_api_key`・`test_docs_routes_are_disabled_even_with_valid_api_key`（`/docs`・`/redoc`・`/openapi.json`をAPI Keyなし/ありの両方で検証）も実際に404であることを確認しており妥当。他にFastAPI標準で自動登録されるルート（static mount等）や、`app.get`/`include_router`等による独自ルートが本タスク時点でapp/以下に存在しないことも`grep`で確認済みで、他のバイパス経路は見当たらない。
    - [Medium] `app/auth.py`のキー比較が`secrets.compare_digest(x_api_key, expected_key)`に変更されていることを確認。`if not expected_key or x_api_key is None or not secrets.compare_digest(x_api_key, expected_key):`という短絡評価の順序により、`x_api_key`が`None`の場合は`compare_digest`が呼ばれる前に401となるため、`compare_digest(None, str)`によるTypeErrorも発生しない。追加された`test_verify_api_key_rejects_none_header_even_if_expected_key_is_empty_string`で、`expected_key`が空文字列（falsy）でもfail-closedが機能することも検証されている。
    - `uv run pytest -v`を実行し24件全てpass（回帰なし）、`uv run ruff check`も違反なしを確認した。差分はapp/auth.py・app/main.py・tests/test_auth.pyのみで、他ファイルへの変更はない。Critical/High/Medium相当の問題は解消されており、本タスクを承認する。
- 性能エバリュエーターのフィードバック: `uv run pytest -v`は24件全てpass（既存テストへの回帰なし）、`uv run ruff check`も違反なし。app/auth.py・app/main.py・tests/test_auth.pyを確認し、受け入れ条件3点それぞれについて対応するテストが存在し実際にパスしていることを確認した。
  - 「有効なAPI Keyを付与したリクエストは正常に処理される」: `test_valid_api_key_is_processed_normally`で200・レスポンス内容・ダミーエンドポイントの実行（`call_log`）まで検証済み。
  - 「API Keyが付与されていない、または不正な場合は認証エラー（401等）が返り、以降の処理が実行されない」: `test_missing_api_key_returns_401_and_does_not_run_endpoint`・`test_invalid_api_key_returns_401_and_does_not_run_endpoint`で401かつ`call_log`が空（業務ロジック未実行）であることまで検証済み。単体レベルでも`test_verify_api_key_rejects_missing_key`・`test_verify_api_key_rejects_invalid_key`・`test_verify_api_key_rejects_any_key_when_env_var_unset`・`test_verify_api_key_rejects_none_header_even_if_expected_key_is_empty_string`でfail-closedの境界（キー欠落／不正／環境変数未設定／expected_keyが空文字列）を網羅している。
  - 「認証チェックが全エンドポイントに一貫して適用されている」: 本タスク時点で業務エンドポイントは未実装（`grep`で`app/`配下に`@app.`・`APIRouter`・`include_router`の使用なしを確認）のため、`FastAPI(dependencies=[Depends(verify_api_key)])`というグローバル依存関係の仕組みそのものを検証する構成は妥当。`test_dependency_is_applied_at_app_level_so_future_routes_are_protected`でグローバル依存関係への登録を確認し、`client`フィクスチャで一時追加したダミールートでも保護されることを実地検証している。加えてセキュリティエバリュエーターが指摘した`/docs`・`/redoc`・`/openapi.json`のバイパス問題（グローバルdependenciesの対象外になるStarlette素のルート）についても、`docs_url=None, redoc_url=None, openapi_url=None`による無効化とその404確認テスト（`test_docs_routes_are_disabled_and_not_accessible_without_api_key`・`test_docs_routes_are_disabled_even_with_valid_api_key`、キーなし/ありの両方）が揃っており、実際に`TestClient`で`API_KEY`を設定した状態でも`/openapi.json`がキーなし・ありいずれも404であることを再現確認した（バイパス経路が解消済み）。
  - 追加のエッジケース確認: `secrets.compare_digest`への変更後も`x_api_key is None`のガードが比較前に短絡することを確認済みで、`compare_digest(None, str)`によるTypeErrorのリスクもない。
  - 不足・懸念点は見当たらなかった。受け入れ条件3点はすべて対応するテストで裏付けられており、pytest・ruffともに全通過。
- 差し戻し回数: 1

### タスク: ステータス遷移警告ロジックとその単体テスト
- status: 完了
- 概要: 「## ステータス遷移の警告ロジック」で確定した状態遷移グラフ方式に基づき、逆行遷移を検知して警告メッセージを返す共通ロジック（`check_backward_transition`と到達可能性判定）を実装する。4つの適用箇所（Project.status, Task.status, InterviewStep.prep_status, InterviewStep.result）すべてのグラフ定義を対象に、境界値を網羅したpytestテストを整備する。
- 受け入れ条件:
  - [ ] 同一ステータスへの変更では警告が発生しない
  - [ ] 隣接ステータスへの順当な遷移では警告が発生しない
  - [ ] 複数段飛び越える順当な遷移では警告が発生しない
  - [ ] 明確な逆行遷移では警告メッセージが返る
  - [ ] 枝分かれ先同士の無関係な遷移（例: Project.statusの完了→見送り）では警告が発生しない
  - [ ] 上記5パターンがProject.status・Task.status・InterviewStep.prep_status・InterviewStep.resultそれぞれについて（該当するパターンのみ）pytestでテストされ、全て通過する
- セキュリティエバリュエーターのフィードバック: 問題なし（Critical/High/Mediumなし）。確認観点と結果は以下の通り。
  - DoS/無限ループ: `_is_reachable`はBFSで`visited`集合により訪問済みノードを除外しているため、仮にグラフに循環が持ち込まれても無限ループしない。現行4グラフはいずれも非巡回で、ノード数も5以下と小さくDoS要因なし。
  - グラフ定義の矛盾: 4グラフとも、edgeの遷移先が全てそのグラフ自身のキーとして定義されており、到達不能な宙ぶらりんノードや矛盾は見当たらない。
  - 外部入力を辞書キーに使う際のKeyError耐性: `_is_reachable`は`forward_edges[current]`ではなく`forward_edges.get(current, [])`を使用しており、`from_status`/`to_status`が将来エンドポイント経由でグラフに存在しない未知の文字列であってもKeyErrorを送出せず、単に「到達不可」＝警告なしとして安全にフォールバックする設計になっている。
  - 参考（設計メモ、ブロッキングではない）: 警告メッセージは`from_status`/`to_status`をf-stringでそのまま埋め込んでいる。現状はJSON APIのプレーンテキストとして返す想定でHTML描画は行わないため問題ないが、将来フロントエンドで生HTMLとして描画する経路を作る場合はエスケープを検討すること。また`PROJECT_STATUS_GRAPH`等のモジュールグローバルなdictは`_is_reachable`内では読み取りのみで変更されておらず、現時点で共有可変状態の破損リスクはない。
  - 純粋関数のみでDB/HTTPアクセスなしのため、認証・SQLインジェクション・mass assignment・論理削除・CORS・シークレット管理の観点は本タスクの対象外（該当なし）。
- 性能エバリュエーターのフィードバック: 承認。`app/status_transitions.py`・`tests/test_status_transitions.py`を確認し、`uv run pytest -v`で41件全てpass（既存テストへの回帰なし）、`uv run ruff check`も違反なしを確認した。
  - 受け入れ条件6点全てについて対応するテストが存在し実際にパスしていることを確認した。「同一ステータス」「隣接遷移」「明確な逆行遷移」は`Project.status`/`Task.status`/`InterviewStep.prep_status`/`InterviewStep.result`の4グラフ全てで検証済み。「複数段飛び越え遷移」は`Project.status`/`Task.status`/`InterviewStep.prep_status`の3グラフで検証済みで、`InterviewStep.result`は深さ2のグラフで隣接遷移と区別がつかないため対象外（テストのdocstringに根拠が明記されておりspec.md 144行目の記述とも整合、妥当な除外と判断）。「枝分かれ先同士の無関係な遷移」は`Project.status`（完了⇄見送り）と`InterviewStep.result`（通過⇄不通過）で検証済みで、`Task.status`/`InterviewStep.prep_status`は線形グラフで分岐が存在しないため対象外（妥当）。
  - `_is_reachable`のBFS実装が単純なindex比較ではなくグラフ上の到達可能性判定になっていること、`.get(current, [])`によるKeyError耐性、4グラフの定義がspec.md「## ステータス遷移の警告ロジック」の確定内容と一致していることも確認した。純粋関数でDB/HTTPアクセスがないため負荷・性能上の懸念はない。
  - 参考（ブロッキングではない）: Task/prep_status/resultの逆行遷移テストは`is not None`のみを確認しており、Projectのように警告メッセージの内容（from/to両方の文字列を含むこと）までは検証していない。また`_is_reachable`が未知のステータス文字列を渡された場合の単体テストはない。いずれも受け入れ条件には含まれておらず、差し戻し理由にはしない。
- 差し戻し回数: 0

### タスク: Project作成・参照・削除エンドポイント
- status: 完了
- 概要: 案件の登録、一覧取得（ステータス絞り込み含む）、詳細取得、論理削除ができるようにする。ステータス更新（PATCH）は別タスクで扱う。
- 受け入れ条件:
  - [ ] 案件を作成すると、その内容がレスポンスに反映される
  - [ ] 案件一覧取得では is_deleted=false の案件のみが返る
  - [ ] 案件一覧をステータスで絞り込むと、該当ステータスの案件のみが返る
  - [ ] 案件詳細取得では自テーブルの情報のみが返り、配下タスクの情報は含まれない
  - [ ] 案件を削除すると is_deleted が true になり、以降の一覧・詳細取得結果に含まれなくなる
  - [ ] 存在しない案件idを指定した場合はエラー（404等）が返る
- セキュリティエバリュエーターのフィードバック: 承認（Critical/High/Medium相当の問題なし）。`app/schemas.py`・`app/routers/projects.py`・`app/main.py`（差分）・`app/models.py`・`app/database.py`・`tests/test_projects.py`・`pyproject.toml`（差分）を確認した。
  - **認証**: `app/main.py`で`FastAPI(dependencies=[Depends(verify_api_key)])`がグローバル依存関係として登録されており、`app.include_router(projects.router)`で追加された`/projects`配下の4エンドポイント（POST/GET一覧/GET詳細/DELETE）は個別の`Depends`を持たずともこのグローバル依存関係を継承するため全て保護される。実際に`grep`でも各ルート定義に個別の認証バイパス（`dependencies=[]`等での上書き）がないことを確認した。`verify_api_key`自体（`app/auth.py`）は前タスクで承認済みのfail-closed設計・`secrets.compare_digest`による定数時間比較のままで変更なし。`test_endpoints_require_api_key`でAPI Keyなしの`GET /projects`が401になることをテストで確認済み（POST/GET詳細/DELETEは個別テストはないが、グローバル依存関係という実装方式上、全エンドポイントに一様に効く）。
  - **mass assignment**: `app/schemas.py`の`ProjectCreate`に`id`・`is_deleted`フィールドが含まれていないことを確認した。`create_project`は`models.Project(**payload.model_dump())`で`ProjectCreate`にないフィールドはそもそもdictに現れないため二重に安全。Pydantic v2のデフォルト（`extra`未指定＝`ignore`）により、リクエストボディに`is_deleted: true`や`id`を含めても無視されることを`test_create_project_rejects_mass_assignment_of_is_deleted`で実地検証済み（実行してpassを確認）。リクエスト用スキーマ（`ProjectCreate`）とレスポンス用スキーマ（`ProjectRead`、`from_attributes=True`）が分離されている。
  - **論理削除の徹底**: `list_projects`・`_get_active_project_or_404`（`get_project`/`delete_project`が共通利用）とも`models.Project.is_deleted.is_(False)`でフィルタしており、削除済みデータの漏洩経路はない。`delete_project`は`project.is_deleted = True; db.commit()`のみで物理削除（`DELETE FROM`相当）は行っていない。`test_list_projects_excludes_deleted`・`test_get_project_detail_not_found_after_deletion`・`test_delete_project_marks_is_deleted_and_excludes_from_list`・`test_delete_project_is_idempotent_not_found_on_second_call`で実地検証済み。
  - **インジェクション**: 全クエリがSQLAlchemy ORMの`db.query(...).filter(...)`経由でパラメータ化されており、生SQL文字列結合は一切ない。`status`クエリパラメータ（`project_status`）も`models.Project.status == project_status`というORM比較でバインドパラメータ化されるため、SQLインジェクションの余地はない。ユーザー入力（`platform`・`memo`等のTEXTカラム）がログ出力や外部コマンドに渡っている箇所もない。
  - **エラーハンドリング**: 404は`HTTPException(status_code=404, detail="Project not found")`という固定文字列のみで、スタックトレース・SQLクエリ文字列・内部パス等の漏洩はない。`app/database.py`のengineも`echo`未設定（デフォルトFalse）で、FastAPIアプリも`debug`モードを有効化していない。
  - **CORS**: 本タスクの差分（`app/main.py`は`include_router`追加のみ）にCORS関連の変更はなく、`CORSMiddleware`自体がプロジェクト全体で未導入。spec.mdではフロントエンドが別オリジンから叩かれる想定でCORS設定が必要と記載されているが、現時点でCORSヘッダーが一切返らないことはブラウザからのクロスオリジンアクセスをデフォルトで拒否する安全側の状態であり、`allow_origins=["*"]`かつ`allow_credentials=True`のような危険な組み合わせも存在しないため、本タスクを差し戻す理由にはならない（参考: spec.mdの実装タスク一覧にCORS設定を対象とする独立タスクが見当たらないため、将来的に追加を検討してもよい）。
  - **シークレット管理**: 本タスクの差分にAPIキー・DB接続情報のハードコードはなく、テストコードの`TEST_API_KEY = "test-secret-key"`はテスト専用の値で`monkeypatch.setenv`経由のみに使われログ出力もない。`.gitignore`（前タスクで確認済み）や本番用のシークレット管理方針に変更はない。
  - `uv run pytest -v`は52件全てpass（新規`tests/test_projects.py`10件含む、既存への回帰なし）、`uv run ruff check`も違反なし。`pyproject.toml`の差分（ruffの`B008`無視設定）はFastAPIの`Depends(...)`イディオムに対する公式に妥当な設定でセキュリティ上の懸念なし。
- 性能エバリュエーターのフィードバック: 承認。`uv run pytest -v`は52件全てpass（既存テストへの回帰なし）、`uv run ruff check`も違反なし。`app/schemas.py`・`app/routers/projects.py`・`app/main.py`・`tests/test_projects.py`を確認し、受け入れ条件6点それぞれについて対応するテストが存在し実際にパスしていることを確認した。
  - 「案件を作成すると、その内容がレスポンスに反映される」: `test_create_project_reflects_input_in_response`でリクエストペイロードの全フィールドがレスポンスと一致すること、`is_deleted=False`・`id`が整数で採番されることまで検証済み。
  - 「案件一覧取得では is_deleted=false の案件のみが返る」: `test_list_projects_excludes_deleted`で削除済みIDが一覧に含まれず未削除IDが含まれることを検証済み。
  - 「案件一覧をステータスで絞り込むと、該当ステータスの案件のみが返る」: `test_list_projects_filters_by_status`で異なるステータスの案件を2件作成し、絞り込み後の結果が全て指定ステータスであること・対象IDが含まれることを検証済み（フィルタが効いていなければ`all(...)`が失敗する構成になっており実効性がある）。
  - 「案件詳細取得では自テーブルの情報のみが返り、配下タスクの情報は含まれない」: `test_get_project_detail_does_not_include_child_task_info`で`"tasks" not in body`を確認済み。`app/models.py`のProjectにrelationshipが定義されておらず（Task CRUDは別タスクで未実装）、`ProjectRead`スキーマも自テーブルのフィールドのみで構成されているため、現時点の実装スコープと整合している。
  - 「案件を削除すると is_deleted が true になり、以降の一覧・詳細取得結果に含まれなくなる」: `test_delete_project_marks_is_deleted_and_excludes_from_list`（一覧側）と`test_get_project_detail_not_found_after_deletion`（詳細側）の組み合わせで両方検証済み。`test_delete_project_is_idempotent_not_found_on_second_call`で2回目のDELETEが404になることも確認されており、`delete_project`が`_get_active_project_or_404`経由で削除済みレコードを再取得できない実装と整合する。
  - 「存在しない案件idを指定した場合はエラー（404等）が返る」: `test_get_project_detail_not_found_for_unknown_id`（GET詳細）・`test_delete_project_not_found_for_unknown_id`（DELETE）で検証済み。
  - 境界値・エッジケースの確認: 本タスクはCRUD基本4エンドポイントのみでステータス警告ロジック・WorkLog・時給換算は対象外（該当タスクは別途`未着手`）のため、それらの境界値確認は本タスクの評価範囲外と判断した。論理削除の除外確認・親詳細エンドポイントの子情報非包含は上記の通り確認済み。
  - 不足・懸念点は見当たらなかった。受け入れ条件6点全てが対応するテストで裏付けられており、pytest・ruffともに全通過。コード変更は行っていない（確認のみ）。
- 差し戻し回数: 0

### タスク: Projectステータス更新エンドポイント
- status: 完了
- 概要: 案件のステータスを含む各項目更新と、Project.statusの状態遷移グラフ（提案中→契約中→納品済み→完了、見送りは提案中・契約中から分岐）に基づく逆行遷移時の警告付与を実装する。
- 受け入れ条件:
  - [ ] 案件の各項目（ステータス含む）を更新できる
  - [ ] 状態遷移グラフに基づき明確な逆行と判定される変更を行うと、200とともに警告フィールドが返る
  - [ ] 順当な遷移（隣接・飛び越え・見送りへの分岐を含む）では警告フィールドは含まれない（またはnull）
  - [ ] 完了→見送りのような枝分かれ先同士の遷移では警告フィールドは含まれない
- セキュリティエバリュエーターのフィードバック: Critical/High相当の問題なし。承認する。`app/schemas.py`（`ProjectUpdate`・`ProjectPatchResponse`）、`app/routers/projects.py`（`PATCH /projects/{project_id}`）、`tests/test_projects.py`（PATCH関連テスト）を確認し、実際に`TestClient`で複数のペイロードを送信して挙動を実地検証した。
  - **認証**: `PATCH /projects/{project_id}`は個別の`dependencies`指定を持たず、`app/main.py`の`FastAPI(dependencies=[Depends(verify_api_key)])`というグローバル依存関係をそのまま継承する。`grep`で本エンドポイントを含む`app/routers/projects.py`全体に認証バイパス（空の`dependencies=[]`等での上書き）がないことを確認した。PATCH固有の401テストは`tests/test_projects.py`に追加されていないが（既存の`test_endpoints_require_api_key`はGET一覧のみ対象）、認証がルーター単位ではなくアプリ全体のグローバル依存関係として実装されている以上、個別エンドポイントごとにバイパス経路が生まれる余地はなく、前タスク（Project作成・参照・削除）と同じ判断で問題としない。
  - **mass assignment**: `ProjectUpdate`に`id`・`is_deleted`フィールドは含まれていない。実際に`PATCH`リクエストボディへ`{"id": 99999, "is_deleted": true, "name": "変更後"}`を送信して検証したところ、レスポンス・DB上とも`id`は変わらず`is_deleted`も`False`のままで、`name`のみが更新されることを確認した（Pydantic v2のデフォルト`extra="ignore"`により、スキーマ未定義フィールドはそもそも`model_dump()`に現れないため）。`update_data`は`payload.model_dump(exclude_unset=True)`で作られ、`setattr`のループもこの辞書のキー（`ProjectUpdate`で定義された8フィールドのみ）に限定されているため、二重の意味で安全。リクエスト用（`ProjectUpdate`）とレスポンス用（`ProjectRead`を継承した`ProjectPatchResponse`）のスキーマも分離されている。
  - **SQLインジェクション**: 新規コードもすべて`db.query(...)`（`_get_active_project_or_404`の再利用）とORMの`setattr`によるものであり、生SQL文字列結合は一切ない。`status`等のユーザー入力がログ出力や外部コマンドに渡っている箇所もない。
  - **論理削除の徹底**: `update_project`は`_get_active_project_or_404`（既存の一覧・詳細・削除エンドポイントと共通）を経由しており、`is_deleted=true`の案件はPATCH対象として取得できず404になる。物理削除相当の操作はこのエンドポイントには含まれない。
  - **状態遷移警告ロジックの再利用**: `check_backward_transition(PROJECT_STATUS_GRAPH, project.status, update_data["status"])`は、DBから読み込んだ更新前の`project.status`と、リクエストの新しい`status`を正しい順序で渡しており、`setattr`によるフィールド更新より前に呼び出されているため、比較対象が意図せず新値同士になるような不具合はない。`status`が更新データに含まれない場合や新旧が同一の場合は呼び出し自体をスキップしており、`tests/test_projects.py`の`test_update_project_status_backward_transition_returns_warning`・`test_update_project_status_forward_transition_has_no_warning`（同一/隣接/飛び越え/分岐遷移）・`test_update_project_status_branch_to_branch_transition_has_no_warning`・`test_update_project_without_status_change_has_no_warning`で境界値が一通り実地検証されている。
  - **エラーハンドリング**: 404は既存の固定文字列`"Project not found"`のみを再利用しており新規の情報漏洩経路はない。
  - **CORS・シークレット管理**: 本タスクの差分に該当する変更はなく、既存タスクでの評価から変化なし。
  - **[Medium/参考、ブロッキングではない] `ProjectUpdate`のフィールド型が実DBのNOT NULL制約と一致していない**: `app/schemas.py`の`ProjectUpdate`は`name`・`client_name`・`status`・`reward`・`applied_date`・`platform`（DB上はいずれも`nullable=False`）も含め全フィールドを`X | None = None`として定義している。`exclude_unset=True`によって「未指定」と「明示的なnull」を区別する設計自体は`deadline`・`memo`（DB上`nullable=True`）については適切だが、他の必須フィールドについても同じ型定義になっているため、クライアントが例えば`{"name": null}`や`{"reward": null}`を送るとPydanticバリデーションは通過し、`setattr(project, "name", None)`後の`db.commit()`でSQLAlchemyの`IntegrityError`（`NOT NULL constraint failed`）が捕捉されずに送出される。実際に`TestClient`で検証したところ、この場合APIは`HTTPException`ではなく未処理の例外としてHTTP 500を返した。ただし`app/main.py`は`debug`モードを有効化しておらず、レスポンスボディは`"Internal Server Error"`という固定文字列のみでスタックトレース・SQL文字列・内部パス等は一切含まれず、認証済みの本人操作の範囲内でDBの整合性が崩れることもない（コミット前にエラーとなるため書き込みは反映されない）ため、情報漏洩・データ破壊・認可バイパスのいずれにも該当しない。従って本タスクを差し戻す理由にはしないが、クリーンな422/400を返せるよう、必須フィールドは`ProjectUpdate`側で「送られたら空にできない」ことを表現する（例: 該当フィールドを`str | None`ではなく非Optionalにする、または`IntegrityError`を捕捉して400番台に変換する）ことを推奨する。
  - `uv run pytest -v`は63件全てpass（新規`tests/test_projects.py`のPATCH関連8件含む、既存への回帰なし）、`uv run ruff check`も違反なし。コード変更は行っていない（確認・実地検証のみ）。
- 性能エバリュエーターのフィードバック: 承認。`uv run pytest -v`は63件全てpass（既存テストへの回帰なし）、`uv run ruff check`も違反なし。`app/schemas.py`・`app/routers/projects.py`・`tests/test_projects.py`を確認し、受け入れ条件4点それぞれについて対応するテストが存在し実際にパスしていることを確認した。
  - 「案件の各項目（ステータス含む）を更新できる」: `test_update_project_updates_fields`（name・rewardの複数フィールド同時更新、未更新項目が元の値のまま保持されること）、`test_update_project_can_clear_nullable_field`（deadlineをnullでクリア）、`test_update_project_without_status_change_has_no_warning`（memo単独更新）、および各種status更新テストで、statusを含む複数フィールドが更新可能なことが確認できている。実装（`update_data = payload.model_dump(exclude_unset=True)`をループして`setattr`）はフィールド非依存の汎用ロジックであり、代表的なフィールドでの検証で妥当と判断した。
  - 「状態遷移グラフに基づき明確な逆行と判定される変更を行うと、200とともに警告フィールドが返る」: `test_update_project_status_backward_transition_returns_warning`（納品済み→契約中）で200・`warning`にfrom/to両方の文字列が含まれることまで検証済み。
  - 「順当な遷移（隣接・飛び越え・見送りへの分岐を含む）では警告フィールドは含まれない」: `test_update_project_status_forward_transition_has_no_warning`のparametrizeで、同一ステータス（提案中→提案中）・隣接（提案中→契約中）・飛び越え（提案中→納品済み）・分岐（提案中→見送り、契約中→見送り）の5パターン全てで`warning`が含まれない（または`None`）ことを確認済み。
  - 「完了→見送りのような枝分かれ先同士の遷移では警告フィールドは含まれない」: `test_update_project_status_branch_to_branch_transition_has_no_warning`（完了→見送り）で確認済み。
  - 境界値確認: `check_backward_transition`への呼び出し順序（更新前`project.status`→新`status`）が`setattr`より前であること、`status`が更新対象に含まれない場合・新旧同一の場合に呼び出し自体がスキップされること（`test_update_project_without_status_change_has_no_warning`、および同一ステータスのparametrizeケース）を実装・テスト両面で確認した。
  - セキュリティエバリュエーターがMedium/参考事項として指摘した「`ProjectUpdate`の必須フィールド（name等）にnullを渡すとIntegrityErrorが捕捉されずHTTP 500になる」点について、`TestClient`（`raise_server_exceptions=False`）で実際に`PATCH /projects/{id}`へ`{"name": null}`を送信して再現確認した。レスポンスは`500 Internal Server Error`（本文`"Internal Server Error"`固定文字列のみ）であり、セキュリティエバリュエーターの指摘内容と一致する。ただし本タスクの受け入れ条件4点はいずれもこの必須フィールドnull送信のケースを対象としておらず、既存のテストスイートにもこのケースをカバーするテストは存在しないが、受け入れ条件外であるため今回はテスト不足として差し戻しの理由にはしない。セキュリティエバリュエーター同様、情報漏洩やデータ破壊（コミット前にIntegrityErrorとなるため書き込みは反映されない）には該当しないと判断した。クリーンな422/400を返すための対応（非Optional化またはIntegrityErrorの捕捉）を推奨する点はセキュリティエバリュエーターの提言に同意する。
  - 不足・懸念点: 受け入れ条件4点はすべて対応するテストで裏付けられている。上記の必須フィールドnull送信の挙動は受け入れ条件外の参考情報として記録するに留める。コード変更は行っていない（確認・実地検証のみ）。
- 完了後の修正（レビュー指摘対応）: セキュリティ・性能両エバリュエーターがMedium/参考として指摘した「`ProjectUpdate`の必須フィールド（name/client_name/status/reward/applied_date/platform）に明示的なnullを送るとIntegrityErrorが未捕捉のままHTTP 500になる」問題を修正した。
  - 対応方法: `app/schemas.py`の`ProjectUpdate`に`model_validator(mode="after")`を追加し、`model_fields_set`（exclude_unsetと同じ情報源）を見て、DB上nullable=Falseな必須フィールドが明示的に`None`として送られていた場合に`ValueError`を送出するようにした。Pydanticのバリデータ内で送出された`ValueError`はFastAPIによって自動的に422（`RequestValidationError`）に変換されるため、`app/routers/projects.py`側の変更やtry/except追加は不要だった。`deadline`・`memo`（DB上nullable=True）は従来通り明示的なnullでのクリアを許可する。既存の`exclude_unset`によるPATCHセマンティクス（未指定フィールドは変更しない）は変更していない。
  - テスト: `tests/test_projects.py`に`test_update_project_rejects_explicit_null_for_required_field`（name/client_name/status/reward/applied_date/platformの6フィールドをparametrizeし、いずれも422を返すことを検証）を追加した。既存の`test_update_project_can_clear_nullable_field`（deadlineのnullクリア）は無変更のまま引き続きpassすることを確認済み。
  - セルフチェック: `uv run pytest -v`は69件全てpass（新規6件含む、既存への回帰なし）、`uv run ruff check`も違反なし。`TestClient`で実地検証し、`PATCH /projects/{id}`に`{"name": null}`を送ると`500`ではなく`422`（`detail`にスタックトレースやSQL文字列を含まない`ValueError`由来のメッセージのみ）が返ることを確認した。
  - 再評価のため一時的にstatusを「セキュリティ評価待ち」に戻す。
- セキュリティエバリュエーターのフィードバック（再評価・修正差分に対するレビュー）: Critical/High相当の問題なし。承認する。`git diff`で変更範囲が`app/schemas.py`（`ProjectUpdate`への`model_validator`追加）・`tests/test_projects.py`（テスト追加）・`spec.md`のみであることを確認したうえで、`app/models.py`のカラム定義、`app/routers/projects.py`、`app/main.py`（認証・CORS設定）と突き合わせ、さらに実際に`TestClient`で`PATCH /projects/{id}`へ複数パターンのペイロードを送信して実地検証した。
  - **対象フィールドの妥当性**: `_PROJECT_REQUIRED_UPDATE_FIELDS`（name/client_name/status/reward/applied_date/platform）は`app/models.py`の`Project`モデルで`nullable=False`と定義されている6カラムと過不足なく一致している。`deadline`・`memo`（`nullable=True`）はこのタプルに含まれておらず、明示的なnullでのクリアが引き続き許可されることを`test_update_project_can_clear_nullable_field`（既存・無変更）で確認、実際に`uv run pytest`実行でもpassしていることを確認した。バリデータ内の判定は`field in self.model_fields_set and getattr(self, field) is None`であり、これは`app/routers/projects.py`側の`payload.model_dump(exclude_unset=True)`と同じ「明示的に送られたか」を示す情報源（Pydantic v2の`model_fields_set`）を参照しているため、「未指定フィールドは変更しない」というPATCHの既存セマンティクスとの不整合はない。
  - **エラーハンドリング（本タスクの主眼）**: 実際に`PATCH /projects/{id}`へ`{"name": null}`を送信し、レスポンスが`500`ではなく`422`になり、ボディが`{"detail": [{"type": "value_error", "loc": ["body"], "msg": "Value error, 次のフィールドにnullは指定できません: name", "input": {"name": null}, "ctx": {"error": {}}}]}`であることを確認した。スタックトレース・内部ファイルパス・SQL文字列（`IntegrityError`由来の`NOT NULL constraint failed`等）はいずれも含まれておらず、`input`にはクライアント自身が送信したリクエストボディがそのままエコーされているだけで新規の情報漏洩はない。`app/main.py`は`docs_url`/`redoc_url`/`openapi_url`を無効化したままで変更はなく、デバッグモードも有効化されていない。
  - **認証・mass assignment**: `app/schemas.py`の差分は`ProjectUpdate`へのバリデータ追加のみで、`ProjectCreate`・`ProjectRead`・`ProjectPatchResponse`の定義やフィールド一覧（`id`・`is_deleted`を含まない点）に変更はない。`app/routers/projects.py`・`app/main.py`にも差分はなく、グローバル依存関係（`Depends(verify_api_key)`）や`_get_active_project_or_404`経由の論理削除フィルタにも影響はない。
  - **SQLインジェクション・CORS・シークレット管理**: 本修正差分はPydanticスキーマ層のみの変更であり、生SQL・外部コマンド呼び出し・CORS設定・シークレットのハードコードはいずれも関係しない。既存タスクでの評価から変化なし。
  - `uv run pytest -q`で69件全てpassすることを実行して確認した（新規6件のparametrizeケース含む）。コード変更は行っていない（確認・実地検証のみ）。
- 性能エバリュエーターのフィードバック（再評価・修正差分「500→422」に対する検証）: 承認。`uv run pytest -v`は69件全てpass（既存テストへの回帰なし）、`uv run ruff check`も違反なし。`git diff HEAD`で今回の差分が`app/schemas.py`・`tests/test_projects.py`（および`spec.md`自体）のみであることを確認したうえで、`app/schemas.py`の`ProjectUpdate`（`model_validator(mode="after")`と`_PROJECT_REQUIRED_UPDATE_FIELDS`）・`tests/test_projects.py`の新規テストを確認し、`TestClient`で追加の実地検証も行った。
  - **必須フィールドへの明示null送信で422になること**: `_PROJECT_REQUIRED_UPDATE_FIELDS = (name, client_name, status, reward, applied_date, platform)`は`app/models.py`の`Project`で`nullable=False`の6カラムと一致している。`test_update_project_rejects_explicit_null_for_required_field`が6フィールド全てをparametrizeし、いずれも422を返すことを検証・pass済み。実地検証でも`{"name": null}`送信時に`500`ではなく`422`（`detail`はPydanticの`value_error`メッセージのみでスタックトレース・SQL文字列を含まない）が返ることを確認した。
  - **nullable項目（deadline/memo）のnullクリアが引き続き動作すること**: `test_update_project_can_clear_nullable_field`で`deadline`のnullクリアが200で通ることを確認済み。一方`memo`については既存テスト（`test_update_project_without_status_change_has_no_warning`等）が`memo`を非null文字列に更新するケースのみで、`memo`を明示的に`null`へクリアする専用テストは存在しない（`grep`で確認）。挙動自体は実地検証（`TestClient`で`{"memo": null}`を送信）で200・`memo: null`が返ることを確認しており、`_PROJECT_REQUIRED_UPDATE_FIELDS`に`memo`が含まれない実装上、`deadline`と全く同じ経路（バリデータのチェック対象外→`exclude_unset`でそのまま`setattr`）を通るため機能的なリグレッションリスクは低いと判断したが、`memo`の明示nullクリアを直接検証するテストケースの追加を推奨する（次回差し戻し理由にはしない軽微な指摘）。
  - **回帰確認**: PATCHの既存受け入れ条件4点（複数項目更新・逆行遷移警告・順当遷移で警告なし・分岐先同士で警告なし）は本修正差分（バリデータ追加のみ）の影響を受けない実装であることをコードレベルで確認し、対応する既存テスト（`test_update_project_updates_fields`ほか）も引き続き全てpassしている。
  - 結論: pytest・ruffともに全通過し、今回の修正意図（必須フィールドへのnull明示送信で422、nullable項目のnullクリア継続）は主要な観点でテストに裏付けられている。上記memoの軽微なテスト不足を除き、指摘なし。コード変更は行っていない（確認・実地検証のみ）。
- 追加修正（性能エバリュエーターの軽微な指摘への対応）: `memo`フィールドを明示的にnullでクリアできることを検証するテストが`tests/test_projects.py`に存在しなかったため、既存の`test_update_project_can_clear_nullable_field`（deadline対象）を`field`/`initial_value`でparametrize化し、`deadline`と`memo`の両方をカバーするようにした。実装コードの変更はなし（テスト追加のみ）。`uv run pytest -v`は70件全てpass、`uv run ruff check`も違反なし。
- 差し戻し回数: 0

### タスク: Task CRUD一式
- status: 完了
- 概要: 案件配下のタスクの作成・一覧取得・更新（ステータス逆行警告含む）・論理削除ができるようにする。Task.statusの順序（未着手→処理中→完了）は確定済みのため決定待ちなしで実装できる。
- 受け入れ条件:
  - [ ] 案件配下にタスクを作成できる
  - [ ] 案件配下のタスク一覧取得では is_deleted=false のタスクのみが返る
  - [ ] タスクの各項目（ステータス含む）を更新できる
  - [ ] ステータスを逆行させて更新すると、200とともに警告フィールドが返る
  - [ ] 順当な遷移では警告フィールドは含まれない
  - [ ] タスクを削除すると is_deleted が true になり、以降の一覧取得結果に含まれなくなる
  - [ ] 存在しない案件id・タスクidを指定した場合はエラー（404等）が返る
- セキュリティエバリュエーターのフィードバック: Critical/High相当の問題なし。承認する。`app/schemas.py`（`TaskStatus`・`TaskBase`/`TaskCreate`/`TaskRead`/`TaskUpdate`/`TaskPatchResponse`）、`app/routers/tasks.py`（新規）、`app/main.py`（差分）、`tests/test_tasks.py`（新規）を確認し、`uv run pytest -v`・`uv run ruff check`を実行して裏付けを取った。
  - **認証**: `app/main.py`の`app.include_router(tasks.router)`で追加された`/projects/{project_id}/tasks`（POST/GET）・`/tasks/{task_id}`（PATCH/DELETE）は個別の`dependencies`指定を持たず、`FastAPI(dependencies=[Depends(verify_api_key)])`というグローバル依存関係をそのまま継承する。`grep`で`app/`配下に個別ルートの認証バイパス（空の`dependencies=[]`等での上書き）が存在しないことを確認した。`test_endpoints_require_api_key`でAPI KeyなしのGET一覧が401になることを確認済み（POST/PATCH/DELETEの個別401テストはないが、認証がグローバル依存関係で実装されている以上バイパス経路が生まれる余地はなく、Project CRUDタスクと同じ判断で問題としない）。`verify_api_key`自体（fail-closed設計・`secrets.compare_digest`）に変更はない。
  - **mass assignment**: `TaskCreate`（`name`/`memo`/`status`）・`TaskUpdate`（`name`/`status`/`memo`）とも`id`・`project_id`・`is_deleted`を含まない。`create_task`は`models.Task(project_id=project_id, **payload.model_dump())`で、`project_id`はパスパラメータから明示的に渡し`TaskCreate`側には定義がないため、リクエストボディに`project_id`や`is_deleted`を含めても二重に無視される（Pydantic v2の`extra`デフォルト`ignore`＋そもそも`model_dump()`にキーが現れない）。`test_create_task_rejects_mass_assignment_of_is_deleted`で実地検証済み。`update_task`も`payload.model_dump(exclude_unset=True)`のキーが`TaskUpdate`で定義された3フィールドに限定されるため、`id`/`project_id`/`is_deleted`をPATCHボディに含めても`setattr`ループの対象にならない（スキーマ構造上安全。ただしProjectタスクにあったような「PATCHボディに`id`/`is_deleted`を混入させて実地検証する」専用テストは`tests/test_tasks.py`には無く、この点はテストカバレッジの軽微な差分として後述）。リクエスト用（`TaskCreate`/`TaskUpdate`）とレスポンス用（`TaskRead`/`TaskPatchResponse`、`from_attributes=True`）のスキーマも分離されている。
  - **インジェクション**: 全クエリが`db.query(...).filter(...)`によるSQLAlchemy ORM経由でパラメータ化されており、生SQL文字列結合は一切ない。`name`・`memo`等のユーザー入力がログ出力や外部コマンドに渡っている箇所もない。
  - **論理削除の徹底**: `list_tasks`は`models.Task.project_id == project_id, models.Task.is_deleted.is_(False)`で、`_get_active_task_or_404`（`update_task`/`delete_task`が共通利用）は`models.Task.is_deleted.is_(False)`でフィルタしており、削除済みタスクの漏洩経路はない。`delete_task`は`task.is_deleted = True; db.commit()`のみで物理削除（`DELETE FROM`相当）は行っていない。`create_task`・`list_tasks`はいずれも`_get_active_project_or_404`を経由するため、親案件が削除済みの場合はタスク作成・一覧取得ともに404になる（`test_create_task_not_found_for_deleted_project`・`test_list_tasks_not_found_for_deleted_project`で実地検証済み）。`test_list_tasks_excludes_deleted`・`test_delete_task_marks_is_deleted_and_excludes_from_list`・`test_delete_task_is_idempotent_not_found_on_second_call`も確認した。
  - **状態遷移警告ロジックの再利用**: `check_backward_transition(TASK_STATUS_GRAPH, task.status, update_data["status"])`は、DBから読み込んだ更新前の`task.status`と新しい`status`を正しい順序で渡しており、`setattr`によるフィールド更新より前に呼び出されているため、比較対象が意図せず新値同士になる不具合はない。`status`が更新データに含まれない、または新旧同一の場合は呼び出し自体をスキップしている。`test_update_task_status_backward_transition_returns_warning`（完了→処理中）・`test_update_task_status_forward_transition_has_no_warning`（同一/隣接/飛び越えの3パターン）・`test_update_task_without_status_change_has_no_warning`で境界値が実地検証されている。`TASK_STATUS_GRAPH`はspec.mdの確定グラフ（未着手→処理中→完了の線形）と一致している。
  - **必須フィールドのnull送信422パターン**: `_TASK_REQUIRED_UPDATE_FIELDS = ("name", "status")`は`app/models.py`の`Task`モデルで`nullable=False`と定義されている`name`/`status`と一致しており（`project_id`はTaskUpdateに存在しないため対象外で妥当）、`memo`（`nullable=True`）は対象外でnullクリアが許可される。`test_update_task_rejects_explicit_null_for_required_field`（name/statusをparametrize）・`test_update_task_can_clear_nullable_memo`で実地検証済み。Projectで確立した「明示的なnullは`model_validator(mode="after")`でValueError→FastAPIが自動的に422に変換」というパターンが正しく踏襲されている。
  - **エラーハンドリング**: 404は`HTTPException(status_code=404, detail="Project not found")`／`"Task not found"`という固定文字列のみで、スタックトレース・SQLクエリ文字列・内部パス等の漏洩はない。422のバリデーションエラーもPydanticの`value_error`メッセージのみでDB内部情報は含まない。
  - **CORS・シークレット管理**: 本タスクの差分（`app/main.py`は`include_router`追加のみ）にCORS・シークレット関連の変更はなく、既存タスクでの評価から状態は変わっていない。
  - **[設計判断の検討] PATCH/DELETE `/tasks/{task_id}`が親案件（project）のis_deleted状態を見ない実装について**: 実装（`_get_active_task_or_404`はタスク自身の`is_deleted`のみをフィルタし、親projectの状態は一切参照しない）を確認した。この設計を以下の観点で検討した。
    - **信頼境界の観点**: 本システムは単一の認証済み本人専用ツールであり、API Key認証は「本人か否か」のみを区別する（マルチテナントでのIDOR・権限昇格のような、別ユーザーのリソースに対する不正アクセスの懸念は存在しない）。したがって親案件が削除済みであっても、それを更新・削除できるタスクの`task_id`を知っているのは本人のみであり、この実装によって新たな認可バイパスや情報漏洩（他者のデータへのアクセス）が生じるわけではない。
    - **エンドポイント設計との整合性**: spec.mdの「タスク系（Task）」表では、`PATCH /tasks/{id}`・`DELETE /tasks/{id}`は`project_id`をパスに含まない設計になっており（案件配下であることを示すのはPOST/GETのみ）、実装（`update_task`/`delete_task`が`task_id`のみを受け取り、親projectを経由しない）はこの表と整合している。受け入れ条件にも「親案件が削除済みの場合にPATCH/DELETEが404になること」は含まれていない。
    - **情報漏洩の観点**: `TaskRead`/`TaskPatchResponse`は自テーブルの情報（`project_id`含む）のみを返し、親project自体の詳細情報（`name`・`client_name`等）を含まない。親が削除済みでも、レスポンスから新たに漏洩する情報はない。
    - **結論**: この設計は、本タスクの受け入れ条件・spec.mdのエンドポイント設計表と矛盾せず、単一ユーザー前提の信頼境界においてCritical/High相当のセキュリティ上の欠陥ではないと判断する。ただし業務ロジック・データ一貫性の観点（削除済み案件配下のタスクが更新・削除操作の対象として生き続けること、削除済み案件を復元する手段がないため「孤立したタスク」が事実上永続する可能性があること）は論点として残るため、性能エバリュエーター・将来のgeneratorの参考情報として記録する（差し戻し理由にはしない）。
  - **[参考、ブロッキングではない] PATCHでのmass assignment実地検証テストの欠落**: Projectタスクでは`PATCH`ボディに`{"id": ..., "is_deleted": true, ...}`を混入させて実際に無視されることを検証するテストがあったが、`tests/test_tasks.py`には`update_task`（PATCH）に対する同様のテストがない（POST側の`test_create_task_rejects_mass_assignment_of_is_deleted`のみ存在）。`TaskUpdate`スキーマに`id`/`project_id`/`is_deleted`フィールドが定義されていないためコード構造上は安全（本レビューでも`app/schemas.py`を確認しフィールド不在を確認済み）だが、Projectタスクとのテストカバレッジの一貫性の観点で、同様のPATCH実地検証テストの追加を推奨する。差し戻し理由にはしない。
  - `uv run pytest -v`は92件全てpass（新規`tests/test_tasks.py`20件含む、既存への回帰なし）、`uv run ruff check`も違反なし。コード変更は行っていない（確認・実地検証のみ）。
- 性能エバリュエーターのフィードバック: 承認。`uv run pytest -v`は92件全てpass（既存テストへの回帰なし）、`uv run ruff check`も違反なし。`app/schemas.py`・`app/routers/tasks.py`・`app/main.py`・`tests/test_tasks.py`を確認し、受け入れ条件7点それぞれについて対応するテストが存在し実際にパスしていることを確認した。
  - 「案件配下にタスクを作成できる」: `test_create_task_reflects_input_in_response`でリクエストペイロード全項目がレスポンスに反映され、`project_id`が正しく設定され、`is_deleted=False`・`id`が整数採番されることまで検証済み。
  - 「案件配下のタスク一覧取得では is_deleted=false のタスクのみが返る」: `test_list_tasks_excludes_deleted`で削除済みタスクIDが一覧に含まれず未削除IDが含まれることを検証済み。
  - 「タスクの各項目（ステータス含む）を更新できる」: `test_update_task_updates_fields`（name・memoの同時更新、未更新項目statusが元の値のまま保持）と、後述のstatus遷移テスト群（status単独更新）を合わせて、name/status/memoの全項目が更新可能であることを確認した。
  - 「ステータスを逆行させて更新すると、200とともに警告フィールドが返る」: `test_update_task_status_backward_transition_returns_warning`（完了→処理中）で200・`warning`にfrom/to両方の文字列（完了・処理中）が含まれることまで検証済み。
  - 「順当な遷移では警告フィールドは含まれない」: `test_update_task_status_forward_transition_has_no_warning`のparametrizeで、同一ステータス（未着手→未着手）・隣接（未着手→処理中）・飛び越え（未着手→完了）の3パターン全てで`warning`が含まれない（None）ことを確認済み。Task.statusは線形3段グラフで枝分かれが存在しないため「枝分かれ先同士の遷移」パターンは該当なし（spec.md「## ステータス遷移の警告ロジック」の記述と整合、妥当な除外）。
  - 「タスクを削除すると is_deleted が true になり、以降の一覧取得結果に含まれなくなる」: `test_delete_task_marks_is_deleted_and_excludes_from_list`で一覧からの除外を確認済み。Task系にはGET詳細エンドポイント（`GET /tasks/{id}`）自体がspec.mdのエンドポイント一覧に存在しない（一覧取得のみ）ため、一覧除外の確認で受け入れ条件を満たすと判断した。
  - 「存在しない案件id・タスクidを指定した場合はエラー（404等）が返る」: 案件id側は`test_create_task_not_found_for_unknown_project_id`・`test_list_tasks_not_found_for_unknown_project_id`（および削除済み案件を対象にした`test_create_task_not_found_for_deleted_project`・`test_list_tasks_not_found_for_deleted_project`）、タスクid側は`test_update_task_not_found_for_unknown_id`・`test_update_task_not_found_after_deletion`・`test_delete_task_not_found_for_unknown_id`・`test_delete_task_is_idempotent_not_found_on_second_call`で網羅されている。
  - 境界値・エッジケース確認（本役割の観点）: ステータス警告ロジックの4パターンのうち「同一ステータス」「隣接遷移」「飛び越え遷移」「逆行遷移」はTask.status（線形3段グラフ）の範囲内で全て検証済み（「飛び越えて逆行」に相当するケースは3段グラフのため隣接逆行と同一になり別途のテストは不要と判断）。論理削除については一覧からの除外を確認済み（詳細取得エンドポイントが存在しないため対象外）。親詳細エンドポイントの子情報混入については、Task自体に詳細取得エンドポイントがなく`TaskRead`/`TaskPatchResponse`も自テーブルのフィールドのみで構成されているため該当なし。WorkLog・時給換算は別タスク（未着手）のため本タスクの評価範囲外とした。
  - セキュリティエバリュエーターが参考情報として挙げた2点について確認した。
    - 「PATCH/DELETE /tasks/{id}が親案件のis_deleted状態を見ない設計」: spec.mdのエンドポイント設計表（`PATCH /tasks/{id}`・`DELETE /tasks/{id}`はパスに`project_id`を含まない）と実装（`_get_active_task_or_404`はタスク自身の`is_deleted`のみを見る）は整合しており、本タスクの受け入れ条件にも「親案件削除済み時にPATCH/DELETEが404になること」は含まれていない。したがって受け入れ条件未達には該当せず、差し戻し理由にはしない。データ一貫性上の論点（削除済み案件配下のタスクが操作対象として残り続ける点）は将来のgenerator向け参考情報として引き続き記録するに留める。
    - 「PATCHでのmass assignment実地検証テストの欠落」: `TaskUpdate`スキーマ（`app/schemas.py`）に`id`/`project_id`/`is_deleted`フィールドが定義されていないことを確認し、構造上安全であると判断した。本タスクの受け入れ条件にmass assignment検証は含まれておらず、Projectタスクとのテストカバレッジの一貫性という観点での軽微な指摘に留まるため、差し戻し理由にはしない（generatorが今後追加を検討してもよい）。
  - 不足・懸念点: 受け入れ条件7点全てが対応するテストで裏付けられている。上記2点は参考情報としての記録に留め、差し戻し理由とはしない。コード変更は行っていない（確認・実地検証のみ）。
- 差し戻し回数: 0

### タスク: WorkLog計測系エンドポイント
- status: 完了
- 概要: タスクの稼働時間計測（開始・終了）、稼働ログ一覧取得、誤操作時の取り消し（論理削除）ができるようにする。同一タスク内の多重start、案件間・タスク間の同時進行を許可する。
- 受け入れ条件:
  - [ ] タスクに対して計測を開始すると、新規の稼働ログが作成され、開始時刻が記録される
  - [ ] 既に進行中（終了時刻未設定）のログがある状態で再度計測を開始しても、別レコードとして作成される
  - [ ] 進行中の稼働ログに対して計測終了を行うと、終了時刻が記録される
  - [ ] タスクの稼働ログ一覧取得では is_deleted=false のログのみが返る
  - [ ] 稼働ログを削除すると is_deleted が true になり、以降の一覧取得結果に含まれなくなる
  - [ ] 存在しないタスクid・稼働ログidを指定した場合はエラー（404等）が返る
- セキュリティエバリュエーターのフィードバック: Critical/High相当の問題なし。承認する。`app/routers/work_logs.py`（新規）・`app/schemas.py`（`WorkLogRead`追加分）・`app/main.py`（差分）・`tests/test_work_logs.py`（新規）・`app/models.py`（`WorkLog`定義、既存）を確認し、`uv run pytest -v`（108件全てpass、既存への回帰なし）・`uv run ruff check`（違反なし）で裏付けを取った。
  - **認証**: `app/main.py`で`app.include_router(work_logs.router)`が追加されているが、`work_logs.router = APIRouter(tags=["work-logs"])`は個別の`dependencies`指定を持たず、`FastAPI(dependencies=[Depends(verify_api_key)])`というグローバル依存関係をそのまま継承する。`grep`で`app/routers/work_logs.py`全体に`dependencies=`によるバイパス・上書きがないことを確認した。`test_endpoints_require_api_key`でAPI KeyなしのGET一覧が401になることを確認済み。`verify_api_key`自体（fail-closed設計・`secrets.compare_digest`による定数時間比較）に変更はない。
  - **mass assignment**: 本タスクの設計上の特徴として、`POST /tasks/{id}/work-logs/start`・`PATCH /work-logs/{id}/stop`はいずれもリクエストボディ用のPydanticスキーマを持たず、パスパラメータ（`task_id`／`work_log_id`）のみを受け取る関数シグネチャになっている（`def start_work_log(task_id: int, db: Session = Depends(get_db))`／`def stop_work_log(work_log_id: int, db: Session = Depends(get_db))`）。FastAPIは宣言されていないリクエストボディを解析対象にしないため、クライアントがボディに`started_at`・`ended_at`・`task_id`・`is_deleted`等をどう詰め込んでも一切読み取られず、`started_at`はサーバー側で`datetime.now()`により、`ended_at`も`stop`時にサーバー側で`datetime.now()`により設定される。mass assignmentの入力経路自体が存在しない設計であり、Project/TaskのようなPATCH用スキーマの`id`/`is_deleted`混入検証テストは本タスクの構造上不要と判断した（該当スキーマが存在しないため）。レスポンス用の`WorkLogRead`（`from_attributes=True`）もリクエスト入力とは独立している。
  - **インジェクション**: 全クエリが`db.query(...).filter(...)`によるSQLAlchemy ORM経由でパラメータ化されており、生SQL文字列結合は一切ない。`memo`カラムは本タスクの新規エンドポイントからは書き込まれておらず（`start_work_log`は`task_id`と`started_at`のみを設定）、ユーザー入力がログ出力や外部コマンドに渡っている箇所もない。
  - **論理削除の徹底**: `_get_active_task_or_404`・`_get_active_work_log_or_404`はいずれも対象自身の`is_deleted.is_(False)`でフィルタしている。`start_work_log`・`list_work_logs`は`_get_active_task_or_404`経由で親タスクが削除済みの場合404になる（`test_start_work_log_not_found_for_deleted_task`・`test_list_work_logs_not_found_for_deleted_task`で実地検証済み）。`stop_work_log`・`delete_work_log`は`_get_active_work_log_or_404`経由でログ自身が削除済みの場合404になる（`test_stop_work_log_not_found_after_deletion`・`test_delete_work_log_is_idempotent_not_found_on_second_call`で確認済み）。`list_work_logs`も`models.WorkLog.is_deleted.is_(False)`でフィルタしており削除済みログの漏洩経路はない（`test_list_work_logs_excludes_deleted`で確認済み）。`delete_work_log`は`work_log.is_deleted = True; db.commit()`のみで物理削除（`DELETE FROM`相当）は行っていない。
  - **エラーハンドリング**: 404は`HTTPException(status_code=404, detail="Task not found")`／`"WorkLog not found"`、409は`detail="WorkLog already stopped"`という固定文字列のみで、スタックトレース・SQLクエリ文字列・内部パス・タイムスタンプ等の内部状態の漏洩はない。
  - **[設計判断の確認] 既に終了済みログへの再stopを409 Conflictとする設計**: 妥当と判断する。理由は以下の通り。
    - 情報漏洩の観点: レスポンスボディは固定文字列`"WorkLog already stopped"`のみで、既存の`ended_at`の値やその他の内部状態は一切含まれない。認証済み本人のみがアクセスできる前提のため、既に終了済みであるという事実自体を返すこと自体も情報漏洩に該当しない。
    - 不整合な状態遷移の防止という観点: 実装（`if work_log.ended_at is not None: raise HTTPException(409, ...)`）により、2回目以降の`stop`呼び出しで`ended_at`が上書きされることはなく、最初の計測終了時刻が保持される。稼働時間は`ended_at - started_at`で都度計算する設計（spec.md該当箇所）のため、`ended_at`が意図せず上書きされることはデータの正確性を損なう（実際の稼働時間より不当に長い／短い時間が記録される）リスクに直結する。409によるブロックはこのリスクを防ぐ安全側の設計であり、Project/TaskのPATCHにおける「ステータス変更はブロックしない」という方針（ユーザーの入力ミス訂正を妨げないため）とは対象が異なる（あちらは業務ステータスの遷移可否の警告、こちらは一度確定した計測終了時刻の不可逆性を守るための衝突検知）ため、方針の矛盾はないと判断した。
    - べき等性に関する参考情報（ブロッキングではない）: 2回目の`stop`が200ではなく409を返す設計はRESTのべき等性の一般的な期待（同じ操作を複数回行っても同じ結果になる）とは厳密には一致しないが、受け入れ条件にはこの点への言及がなく、業務要件（誤って2回stopボタンを押しても最初の終了時刻を保護したい）を優先した意図的な設計と解釈できるため、セキュリティ上の欠陥として差し戻す理由にはしない。
  - **[設計判断の確認] DELETEを2回呼んだ場合に2回目が404になる設計**: Project/Taskの既存パターン（`_get_active_*_or_404`が`is_deleted=false`のレコードのみを対象にするため、既に削除済みのレコードは「存在しない」ものとして扱われる）を踏襲しており一貫性がある。物理削除ではなく論理削除フラグの二重設定を防ぐだけの結果であり、データ破壊・情報漏洩のいずれにも該当しない。`test_delete_work_log_is_idempotent_not_found_on_second_call`で実地検証済み。
  - **CORS・シークレット管理**: 本タスクの差分にCORS関連の変更はなく、`CORSMiddleware`は引き続き未導入（安全側のデフォルト、既存タスクでの評価から変化なし）。APIキー・DB接続情報のハードコードはなく、`tests/test_work_logs.py`の`TEST_API_KEY = "test-secret-key"`はテスト専用値で`monkeypatch.setenv`経由のみに使われログ出力もない。
  - コード変更は行っていない（確認・実地検証のみ）。
- 性能エバリュエーターのフィードバック: 承認。`uv run pytest -v`は108件全てpass（新規`tests/test_work_logs.py`14件含む、既存への回帰なし）、`uv run ruff check`も違反なし。`app/routers/work_logs.py`・`app/schemas.py`（`WorkLogRead`）・`app/main.py`・`tests/test_work_logs.py`を確認し、受け入れ条件6点それぞれについて対応するテストが存在し実際にパスしていることを確認した。
  - 「タスクに対して計測を開始すると、新規の稼働ログが作成され、開始時刻が記録される」: `test_start_work_log_creates_record_with_started_at`で201・`task_id`一致・`started_at`が設定済み・`ended_at`が`None`・`is_deleted=False`・`id`整数採番まで確認済み。
  - 「既に進行中（終了時刻未設定）のログがある状態で再度計測を開始しても、別レコードとして作成される」: `test_start_work_log_allows_multiple_running_logs_for_same_task`で2回startして両方201・IDが異なり・一覧取得で両方のIDが含まれることまで確認済み。
  - 「進行中の稼働ログに対して計測終了を行うと、終了時刻が記録される」: `test_stop_work_log_records_ended_at`で200・`ended_at`が設定されることを確認済み。
  - 「タスクの稼働ログ一覧取得では is_deleted=false のログのみが返る」: `test_list_work_logs_excludes_deleted`で削除済みログIDが一覧から除外され未削除IDが含まれることを確認済み。
  - 「稼働ログを削除すると is_deleted が true になり、以降の一覧取得結果に含まれなくなる」: `test_delete_work_log_marks_is_deleted_and_excludes_from_list`で204・一覧からの除外を確認済み。
  - 「存在しないタスクid・稼働ログidを指定した場合はエラー（404等）が返る」: タスクid側は`test_start_work_log_not_found_for_unknown_task_id`・`test_start_work_log_not_found_for_deleted_task`・`test_list_work_logs_not_found_for_unknown_task_id`・`test_list_work_logs_not_found_for_deleted_task`、稼働ログid側は`test_stop_work_log_not_found_for_unknown_id`・`test_stop_work_log_not_found_after_deletion`・`test_delete_work_log_not_found_for_unknown_id`・`test_delete_work_log_is_idempotent_not_found_on_second_call`で網羅されている。
  - 境界値・エッジケース確認（本役割の観点）:
    - ステータス警告ロジックの4パターン（同一/隣接/飛び越え/逆行）: WorkLogにはstatusフィールド自体が存在せず（テーブル設計にも無い）、本タスクの評価対象外と判断した。
    - 論理削除のDELETE後の除外: 一覧取得からの除外を確認済み（`GET /work-logs/{id}`という単体詳細取得エンドポイント自体がspec.mdのエンドポイント一覧に存在しないため、一覧除外の確認で受け入れ条件を満たすと判断）。
    - 親詳細エンドポイントが子情報を含まないか: WorkLogに親にあたる「詳細取得」対象はTask/Projectだが、Task自体にGET単体エンドポイントが存在せず、`GET /projects/{id}`は既存タスクで検証済み（子task情報を含まないことを確認済み）。本タスクの差分に親詳細エンドポイントの変更はないため対象外。
    - 同一タスク内の多重start: `test_start_work_log_allows_multiple_running_logs_for_same_task`で確認済み。
    - 複数タスク・複数案件の同時進行: `test_start_work_log_allows_concurrent_logs_across_tasks_and_projects`で、別々の案件配下の別々のタスクに対してほぼ同時にstartしても両方201になることを確認済み。
    - `ended_at`が`NULL`の間は稼働時間計算が「進行中」として扱われるか: 本タスクのスコープには稼働時間の計算・表示ロジック自体が含まれていない（`WorkLogRead`は`started_at`/`ended_at`の生値をそのまま返すのみで、経過時間・duration・進行中フラグ等の派生フィールドを持たない）。稼働時間計算は次タスク「時給換算エンドポイント」（現status: 未着手）の受け入れ条件「進行中（終了時刻未設定）のログの扱いが一貫している」で扱われる範囲であり、本タスクの受け入れ条件6点にも稼働時間計算への言及はないため、本タスクでは評価対象外と判断した（次タスクのレビュー時に重点確認する）。
  - セキュリティエバリュエーターが検討した2つの設計判断（既に終了済みログへの再stopで409、DELETE2回目が404）はいずれも実装・テストと整合しており、業務要件（計測終了時刻の不可逆性を守る／論理削除の一貫性）に照らして妥当と判断する。追加の懸念はない。
  - 不足・懸念点: 受け入れ条件6点全てが対応するテストで裏付けられている。コード変更は行っていない（確認・実地検証のみ）。
- 差し戻し回数: 0

### タスク: 時給換算エンドポイント
- status: 完了
- 概要: 案件の固定報酬額を配下タスクの合計稼働時間で割った時給換算値を返せるようにする。
- 受け入れ条件:
  - [x] 案件の時給換算結果が、報酬額と配下タスクの合計稼働時間から算出されて返る
  - [x] is_deleted=true のタスク・稼働ログは合計稼働時間の計算対象に含まれない
  - [x] 配下タスクの合計稼働時間が0の場合でも、エラーで落ちずに一貫したレスポンスが返る
  - [x] 進行中（終了時刻未設定）のログの扱いが一貫している
- 実装メモ（技術判断とその理由）:
  - **進行中ログ（ended_at IS NULL）の扱い**: 合計稼働時間の集計対象から除外する（現在時刻までの経過時間としては計算しない）。理由: 終了時刻が確定していないログを「現在時刻までの経過」として含めると、同じ案件に対するGETのたびに時給換算値が変動し続け、一覧のキャッシュや比較が困難になる。また稼働時間は「`ended_at - started_at`で都度計算する」という既存方針（WorkLogテーブル設計）と平仄を合わせ、両者が確定しているログのみを信頼できる実績として扱う方が一貫性がある。
  - **合計稼働時間が0の場合の`hourly_rate`の値**: `null`を返す（0円/時ではなく、無限大でもない）。理由: 0で割ると数学的に未定義であり、`0`を返すと「時給0円」という誤った実績を示すことになる。無限大はJSONの数値型として表現できず文字列化するとクライアント側の型処理が複雑になる。`null`は「まだ計算不能（稼働実績なし）」であることを明確に表せる。
  - レスポンススキーマ（`HourlyRateRead`）は`project_id`・`reward`・`total_work_hours`・`hourly_rate`の4項目とした。
- セキュリティエバリュエーターのフィードバック: Critical/High相当の問題なし。承認する。`app/routers/projects.py`（`get_hourly_rate`差分）・`app/schemas.py`（`HourlyRateRead`追加分）・`app/models.py`・`app/auth.py`・`app/main.py`・`tests/test_hourly_rate.py`（新規）を確認し、`uv run pytest -v`（116件全てpass、既存への回帰なし）・`uv run ruff check`（違反なし）で裏付けを取った。
  - **認証**: `get_hourly_rate`は`projects.router`（`prefix="/projects"`）に定義されており、`app/main.py`の`FastAPI(dependencies=[Depends(verify_api_key)])`というグローバル依存関係をそのまま継承する。エンドポイント自体・ルーター自体に個別`dependencies`によるバイパス・上書きはない（grep差分で確認）。`test_hourly_rate_requires_api_key`でAPI KeyなしのGETが401になることを実地確認済み。`verify_api_key`自体（fail-closed・`secrets.compare_digest`による定数時間比較）に変更はない。
  - **インジェクション**: `db.query(models.WorkLog).join(models.Task, models.WorkLog.task_id == models.Task.id).filter(...)`はSQLAlchemy ORM経由で完全にパラメータ化されており、生SQL文字列結合は一切ない。ユーザー入力（`project_id`のパスパラメータのみ）がログ出力や外部コマンドに渡っている箇所もなく、`platform`・`memo`等のTEXTカラムはこのエンドポイントで参照すらされていない。
  - **mass assignment**: 本エンドポイントはGET専用でリクエストボディ用スキーマを持たず、レスポンススキーマ`HourlyRateRead`（`project_id`/`reward`/`total_work_hours`/`hourly_rate`の4フィールドのみ、`from_attributes`指定もなくコンストラクタ引数として明示的に値を渡している）は入力とは独立している。mass assignmentの入力経路自体が存在しない。
  - **論理削除の徹底**: JOINクエリのfilterに`models.Task.is_deleted.is_(False)`と`models.WorkLog.is_deleted.is_(False)`の両方が含まれており、親プロジェクトも`_get_active_project_or_404`（`Project.is_deleted.is_(False)`）で判定される。`test_hourly_rate_excludes_deleted_tasks_and_work_logs`で「同一タスク内の削除済みログ」「削除済みタスク配下の（削除フラグの立っていない）ログ」の両方が集計から除外され、合計が1時間・時給10000円になることを実地検証済み。DELETE相当の操作はこのエンドポイントには存在せず（GETのみ）、物理削除の懸念もない。
  - **情報漏洩**: レスポンス（`HourlyRateRead`）は`project_id`・`reward`・`total_work_hours`・`hourly_rate`という集計値4項目のみを返し、配下タスクのid・name・status・memoや稼働ログの`started_at`/`ended_at`/`memo`等の個別明細は一切含まれない。親案件詳細取得（`GET /projects/{id}`）が配下task情報を含まない設計と同様、集計エンドポイントとしても子リソースの詳細情報を漏らさない設計になっている。
  - **0除算・null処理**: `hourly_rate = project.reward / total_work_hours if total_work_hours > 0 else None`により、`total_work_hours == 0`の場合は除算自体を行わず`None`を返すため`ZeroDivisionError`は発生しない。`total_seconds = sum(... for log in completed_logs if log.started_at is not None)`により、万一`started_at`が`NULL`のレコードが混入していても`TypeError`（`None`と`datetime`の減算）は起きず単に加算対象から除外される（フェイルセーフ）。例外が発生してスタックトレースやSQLがレスポンスに漏れる経路はない。`test_hourly_rate_zero_total_hours_returns_consistent_response_without_error`・`test_hourly_rate_zero_total_hours_when_no_tasks`で200・`hourly_rate=None`のレスポンスを実地確認済み。
  - **エラーハンドリング**: 存在しない/削除済みプロジェクトIDに対しては`_get_active_project_or_404`が固定文字列`detail="Project not found"`の404を返すのみで、内部パス・SQLクエリ文字列・スタックトレースの漏洩はない。`test_hourly_rate_not_found_for_unknown_project_id`・`test_hourly_rate_not_found_for_deleted_project`で確認済み。
  - **[技術判断の確認] 進行中ログ（ended_at IS NULL）を合計稼働時間の集計から除外する設計**: セキュリティ上の懸念はないと判断する。除外対象の判定は`WorkLog.is_deleted.is_(False)`という既存の論理削除フィルタと独立した条件（`ended_at.isnot(None)`）であり、論理削除の徹底を弱めるものではない。またこの判断によって非表示になるのは「進行中ログの経過時間」という集計上の一値のみで、個別ログの内容（`started_at`等）が別経路で漏れるわけでもない。`test_hourly_rate_running_log_excluded_from_total`で実地検証済み。
  - **[技術判断の確認] 合計稼働時間0の場合に`hourly_rate`をnullで返す設計**: セキュリティ上の懸念はないと判断する。0や無限大を返す代替案と比較して、`null`はクライアント側の型処理を複雑にせず、かつ「時給0円」という誤情報を示すこともない。数値型の不正な値（`Infinity`等、JSON非準拠）がレスポンスに混入するリスクを避けている点でむしろ堅牢な設計。
  - **CORS・シークレット管理**: 本タスクの差分にCORS関連の変更はなく、`CORSMiddleware`は引き続き未導入（既存タスクからの評価と同じく安全側のデフォルト）。APIキー・DB接続情報のハードコードはなく、`tests/test_hourly_rate.py`の`TEST_API_KEY = "test-secret-key"`はテスト専用値で`monkeypatch.setenv`経由のみに使われログ出力もない。
  - コード変更は行っていない（確認・実地検証のみ）。
- 性能エバリュエーターのフィードバック: 承認。`uv run pytest -v`は116件全てpass（既存テストへの回帰なし）、`uv run ruff check`も違反なし。`app/schemas.py`（`HourlyRateRead`）・`app/routers/projects.py`（`get_hourly_rate`）・`tests/test_hourly_rate.py`を確認し、受け入れ条件4点それぞれについて対応するテストが存在し実際にパスしていることを確認した。
  - 「案件の時給換算結果が、報酬額と配下タスクの合計稼働時間から算出されて返る」: `test_hourly_rate_computed_from_reward_and_total_task_hours`でreward=10000・1時間の稼働ログ2件（合計2時間）から`total_work_hours=2.0`・`hourly_rate=5000.0`が算出されることを確認済み。
  - 「is_deleted=true のタスク・稼働ログは合計稼働時間の計算対象に含まれない」: `test_hourly_rate_excludes_deleted_tasks_and_work_logs`で、(a) 有効なタスク内の削除済みWorkLog（3時間）、(b) 削除済みタスク配下の（フラグ自体は立っていない）WorkLog（5時間）の両パターンが除外され、有効な1時間分のみが集計される（`total_work_hours=1.0`・`hourly_rate=10000.0`）ことを確認済み。
  - 「配下タスクの合計稼働時間が0の場合でも、エラーで落ちずに一貫したレスポンスが返る」: `test_hourly_rate_zero_total_hours_returns_consistent_response_without_error`（タスクはあるが稼働ログなし）・`test_hourly_rate_zero_total_hours_when_no_tasks`（タスク自体なし）の両方で200・`total_work_hours=0`・`hourly_rate=None`が返ることを確認済み。実装（`hourly_rate = reward / total_work_hours if total_work_hours > 0 else None`）は0除算を発生させない構造になっており、セキュリティエバリュエーターが承認した技術判断（0円という誤情報を避けるためnullを返す）と整合している。
  - 「進行中（終了時刻未設定）のログの扱いが一貫している」: `test_hourly_rate_running_log_excluded_from_total`で、完了済み1時間ログ＋進行中ログ（`ended_at`未設定）が混在する場合でも`total_work_hours`が1.0のまま変化しないことを確認済み。実装は`WorkLog.ended_at.isnot(None)`で進行中ログをクエリ段階から除外しており、GETのたびに値が変動する不安定な挙動にならないことをコードレベルでも確認した。セキュリティエバリュエーターが承認した技術判断（進行中ログは集計から除外）とも整合している。
  - 境界値・エッジケース確認（本役割の観点）: 論理削除の除外は「同一タスク内の削除ログ」「削除済みタスク配下のログ」の2パターンともテストされている。時給換算エンドポイントに親子関係の詳細情報混入はない（`HourlyRateRead`は`project_id`/`reward`/`total_work_hours`/`hourly_rate`の集計値4項目のみで、配下タスク・稼働ログの個別明細を含まない）ことをスキーマ定義から確認した。認証（`test_hourly_rate_requires_api_key`）・404（`test_hourly_rate_not_found_for_unknown_project_id`・`test_hourly_rate_not_found_for_deleted_project`）も確認済み。
  - 参考（ブロッキングではない軽微な指摘）: 「進行中ログのみが存在し完了済みログが0件」という組み合わせ（`total_work_hours`が0になる具体的な原因の一つとして依頼元から名指しされたパターン）を単体で明示的に検証するテストケースは存在しない。ただし、これは「進行中ログは集計から除外される」（`test_hourly_rate_running_log_excluded_from_total`で検証済み）と「完了済みログが0件なら合計は0でnullを返す」（`test_hourly_rate_zero_total_hours_returns_consistent_response_without_error`で検証済み）という既にテスト済みの2つの挙動から論理的に導かれる帰結であり、新たなコードパスを踏むものではないため、差し戻し理由にはしない。テストカバレッジの一貫性向上のため、余裕があれば専用ケースの追加を推奨する程度に留める。
  - 不足・懸念点: 受け入れ条件4点全てが対応するテストで裏付けられている。上記の軽微な指摘を除き懸念なし。コード変更は行っていない（確認・実地検証のみ）。
- 差し戻し回数: 0

### タスク: Company CRUD一式
- status: 完了
- 概要: 選考先企業の登録・一覧取得・詳細取得・論理削除ができるようにする。
- 受け入れ条件:
  - [ ] 企業を登録できる
  - [ ] 企業一覧取得では is_deleted=false の企業のみが返る
  - [ ] 企業詳細取得では自テーブルの情報のみが返り、配下の選考ステップ情報は含まれない
  - [ ] 企業を削除すると is_deleted が true になり、以降の一覧・詳細取得結果に含まれなくなる
  - [ ] 存在しない企業idを指定した場合はエラー（404等）が返る
- セキュリティエバリュエーターのフィードバック: Critical/High相当の問題なし。承認する。`git diff`/`git status`で変更範囲が`app/routers/companies.py`（新規）・`app/schemas.py`（`CompanyBase`/`CompanyCreate`/`CompanyRead`追加）・`app/main.py`（`companies.router`追加のみ）・`tests/test_companies.py`（新規）であることを確認したうえで、以下を検証した。
  - **認証**: `app/main.py`で`verify_api_key`がFastAPIアプリ全体のグローバル依存関係として登録されており、`companies.router`はその後に`include_router`されているだけで独自の認証バイパス経路は追加していない。実際に`test_endpoints_require_api_key`（APIキー無しで401）がpassすることを`pytest`実行で確認済み。`verify_api_key`自体（`app/auth.py`）は前タスクから変更なく、`secrets.compare_digest`による定数時間比較・fail closed設計のまま。
  - **mass assignment**: `CompanyCreate(CompanyBase)`は`name`のみを持ち、`id`・`is_deleted`は含まれない。`create_company`は`models.Company(**payload.model_dump())`でモデルを生成しており、`is_deleted`はDBカラムのデフォルト（`default=False, server_default=false()`）に委ねられextra入力から上書きされない。`test_create_company_rejects_mass_assignment_of_is_deleted`で`is_deleted=True`を送っても`False`のまま生成されることを確認済み。`CompanyRead`は独立した出力スキーマであり、入力スキーマ（`CompanyCreate`）とは分離されている。
  - **SQLインジェクション**: `app/routers/companies.py`は生SQL文字列結合を一切使わず、全クエリが`db.query(models.Company).filter(...)`のSQLAlchemy ORM経由。ユーザー入力（`name`）をログ出力・外部コマンドに渡す箇所もない。
  - **論理削除の徹底**: 一覧（`list_companies`）・詳細（`_get_active_company_or_404`経由の`get_company`）ともに`models.Company.is_deleted.is_(False)`フィルタが存在し、`delete_company`も`company.is_deleted = True`のみでレコードを物理削除する`db.delete()`等は使われていない。`test_list_companies_excludes_deleted`・`test_get_company_detail_not_found_after_deletion`・`test_delete_company_marks_is_deleted_and_excludes_from_list`・`test_delete_company_is_idempotent_not_found_on_second_call`がいずれもpassし、削除済み企業が一覧・詳細のどちらからも参照できないことを確認済み。
  - **詳細取得の情報漏洩（配下の選考ステップ）**: `models.Company`に`relationship`は定義されておらず（`app/models.py`のdocstring通りProject系/選考系ドメインは意図的に無関係）、`CompanyRead`のフィールドも`name`/`id`/`is_deleted`のみで`interview_steps`等は含まれない。`get_company`のSQLも`Company`単体へのクエリでJOINは行っていない。`test_get_company_detail_does_not_include_child_interview_step_info`がpassすることを確認済み。
  - **エラーハンドリング**: 存在しない/削除済みIDに対しては`HTTPException(404, detail="Company not found")`のみを返し、スタックトレースや内部パス、SQLクエリ文字列は含まれない。FastAPIの`debug`モードやSQLAlchemy engineの`echo=True`も有効化されていない（前タスクからの評価と変化なし）。
  - **既存パターンからの逸脱有無**: `app/routers/projects.py`と1対1で比較し、`_get_active_project_or_404`と同型の`_get_active_company_or_404`ヘルパー、`response_model`の使い分け、POST/GET一覧/GET詳細/DELETEの実装構造いずれも既存パターンを踏襲しており、認証・論理削除・スキーマ分離の観点で逸脱は見られなかった。
  - **CORS・シークレット管理**: 本タスクの差分にCORS関連の変更はなく、`CORSMiddleware`は引き続き未導入（既存タスクからの評価と同じく安全側のデフォルト、フロントエンド/CORS設定は別タスクで対応予定）。APIキー・DB接続情報のハードコードはなく、`tests/test_companies.py`の`TEST_API_KEY = "test-secret-key"`はテスト専用値で`monkeypatch.setenv`経由のみに使われログ出力もない。
  - `pytest tests/test_companies.py`を実行し10件すべてpassすることを確認済み。
- 性能エバリュエーターのフィードバック: 承認。`uv run pytest -v`で126件全てpass（既存テストへの回帰なし）、`uv run ruff check`も違反なしを確認した。`app/routers/companies.py`・`app/schemas.py`（`CompanyBase`/`CompanyCreate`/`CompanyRead`）・`app/main.py`（`companies.router`のinclude_router）・`tests/test_companies.py`（10件）を確認し、受け入れ条件5点それぞれに対応するテストが存在し実際にパスしていることを確認した。
  - 「企業を登録できる」: `test_create_company_reflects_input_in_response`でPOST→201・name反映・`is_deleted=False`・id採番を確認済み。
  - 「企業一覧取得ではis_deleted=falseの企業のみが返る」: `test_list_companies_excludes_deleted`で削除済みIDが一覧から除外され未削除IDのみ含まれることを確認済み。
  - 「企業詳細取得では自テーブルの情報のみが返り、配下の選考ステップ情報は含まれない」: `test_get_company_detail_does_not_include_child_interview_step_info`でレスポンスボディに`interview_steps`キーが存在しないことを確認済み。`models.Company`に`relationship`定義がなくJOINも行われておらず実装とも整合している。
  - 「企業を削除するとis_deletedがtrueになり、以降の一覧・詳細取得結果に含まれなくなる」: `test_delete_company_marks_is_deleted_and_excludes_from_list`（一覧から除外）と`test_get_company_detail_not_found_after_deletion`（詳細取得404）の2テストで一覧・詳細両方の除外を確認済み。加えて`test_delete_company_is_idempotent_not_found_on_second_call`で2回目のDELETEも404になることを確認済み。
  - 「存在しない企業idを指定した場合はエラー（404等）が返る」: `test_get_company_detail_not_found_for_unknown_id`・`test_delete_company_not_found_for_unknown_id`で確認済み。
  - 認証: `test_endpoints_require_api_key`でAPIキーなしのGET一覧が401になることを確認済み。グローバル依存関係（`Depends(verify_api_key)`）の仕組み自体は`tests/test_auth.py`で網羅済みであり、既存承認済みタスク（Project CRUD等）と同一の検証パターンを踏襲しているため妥当と判断した。
  - mass assignment: `test_create_company_rejects_mass_assignment_of_is_deleted`で`is_deleted=True`を入力してもDBデフォルトの`False`のまま生成されることを確認済み。
  - 不足・懸念点は見当たらなかった。受け入れ条件5点はすべて対応するテストで裏付けられており、pytest・ruffともに全通過。
- 差し戻し回数: 0

### タスク: InterviewStep作成・参照・削除エンドポイント
- status: 完了
- 概要: 企業配下の選考ステップの追加、一覧取得、論理削除ができるようにする。更新（PATCH）は別タスクで扱う。
- 受け入れ条件:
  - [x] 企業配下に選考ステップを追加できる
  - [x] 企業配下の選考ステップ一覧取得では is_deleted=false のステップのみが返る
  - [x] 選考ステップを削除すると is_deleted が true になり、以降の一覧取得結果に含まれなくなる
  - [x] 存在しない企業id・選考ステップidを指定した場合はエラー（404等）が返る
- 実装メモ（技術判断とその理由）:
  - **作成時のprep_status・resultの扱い（確定: デフォルト値を設定し、リクエストでは任意項目とする）**: `InterviewStepCreate`で`prep_status`のデフォルトを「準備中」、`result`のデフォルトを「未定」とした。理由: この2項目は「## ステータス遷移の警告ロジック」で確定した状態遷移グラフ上、いずれも他のどのノードからも遷移してこない起点ノード（`準備中`・`未定`）であり、新規に選考ステップを追加する時点では常にこの起点状態から始まるのが自然な業務フロー（選考ステップを登録した直後は「まだ準備していない」「結果はまだ未定」）だからである。Project.status／Task.statusは`ProjectCreate`／`TaskCreate`で必須項目としているが、これらは案件・タスクを作成する時点で既に契約中や処理中など複数の初期状態がありうる（例: 既に契約済みの案件を後からシステムに登録する）ため必須にしている一方、InterviewStepのprep_status・resultには作成時点でこの起点以外の状態を選ぶ業務的な必然性がなく、クライアントに毎回同じ値の指定を求めるのは冗長と判断した。なお`type`はテーブル設計上「書類選考/一次面接/二次面接/最終面接など」（"など"で例示であり列挙が確定していない）ため、Literal型による列挙制約は設けずプレーンな`str`とした。
  - 既存の`_get_active_project_or_404`（tasks.py）・`_get_active_company_or_404`（companies.py）と同型の`_get_active_company_or_404`（interview_steps.py内、企業の存在・削除済みチェック）・`_get_active_interview_step_or_404`ヘルパーを踏襲し、Task CRUDと同じ「親配下の子リソースの作成・一覧・削除」パターンで実装した。PATCHは別タスクのため未実装。
  - **実装上の技術的注意点（既存コードの潜在バグの回避）**: `app/schemas.py`にInterviewStepBaseの`date`フィールドを追加する際、Pythonの仕様上「`date: date | None = None`」のようにフィールド名と型名が同じ場合、クラス本体の実行順序（値の代入 → 注釈評価の順）により注釈評価時に型名`date`がフィールド自身の値（None）に上書きされ`TypeError`になることが判明した（`app/models.py`のInterviewStep.dateでも同じ構造だが、SQLAlchemyの`mapped_column()`が返すオブジェクトが`__or__`を実装しているためエラーにならず、結果として`Mapped[BooleanClauseList]`という無意味な注釈になっているだけで実害はない潜在バグ。DBカラム型は`mapped_column(Date, ...)`の明示引数で決まるため機能的な問題はなく、本タスクの範囲外のため修正していない）。今回はエイリアスimport（`from datetime import date as _Date`）を追加し、`date: _Date | None = None`とすることで回避した。
- セキュリティエバリュエーターのフィードバック: Critical/High相当の問題なし。承認する。`git status`/`git diff`で変更範囲が`app/schemas.py`（`InterviewStepPrepStatus`/`InterviewStepResult`/`InterviewStepBase`/`InterviewStepCreate`/`InterviewStepRead`追加、`date`エイリアスimport追加）・`app/routers/interview_steps.py`（新規）・`app/main.py`（`interview_steps.router`のinclude_routerのみ）・`tests/test_interview_steps.py`（新規）であることを確認したうえで、以下を検証した。
  - **認証**: `app/routers/interview_steps.py`の`router = APIRouter(tags=["interview-steps"])`は個別の`dependencies`指定を持たず、`app/main.py`の`FastAPI(dependencies=[Depends(verify_api_key)])`というグローバル依存関係をそのまま継承する。`grep`で`app/routers/`配下に個別ルートの認証バイパス（`dependencies=`によるオーバーライド）が一切存在しないことを確認した。`test_endpoints_require_api_key`（APIキーなしのGET一覧が401）が実際にpassすることを`uv run pytest`で確認済み。`verify_api_key`自体（`app/auth.py`）は前タスクから変更なく、fail-closed設計・`secrets.compare_digest`による定数時間比較のまま。
  - **mass assignment**: `InterviewStepCreate`（`InterviewStepBase`の`type`/`date`/`memo`に`prep_status`/`result`のデフォルト値付きフィールドを追加）を確認したところ、`id`・`company_id`・`is_deleted`のいずれも含まれない。`create_interview_step`は`models.InterviewStep(company_id=company_id, **payload.model_dump())`で、`company_id`はパスパラメータから明示的に渡し、`is_deleted`はDBカラムのデフォルト（`default=False, server_default=false()`）に委ねられる。Pydantic v2のデフォルト（`extra`未指定＝`ignore`）により、リクエストボディに`company_id`や`is_deleted: true`を含めても無視されることを`test_create_interview_step_rejects_mass_assignment_of_is_deleted`で実地検証済み（実行してpassを確認）。リクエスト用（`InterviewStepCreate`）とレスポンス用（`InterviewStepRead`、`from_attributes=True`）のスキーマも分離されている。
  - **インジェクション**: `app/routers/interview_steps.py`の全クエリが`db.query(...).filter(...)`によるSQLAlchemy ORM経由でパラメータ化されており、生SQL文字列結合は一切ない。ユーザー入力（`type`・`memo`等のTEXTカラム）がログ出力や外部コマンドに渡っている箇所もない。
  - **論理削除の徹底（企業側・選考ステップ側の両方）**: `_get_active_company_or_404`（企業の存在・削除済みチェック）は`create_interview_step`・`list_interview_steps`の両方から呼ばれており、親企業が削除済みの場合は選考ステップの作成・一覧取得ともに404になる（`test_create_interview_step_not_found_for_deleted_company`・`test_list_interview_steps_not_found_for_deleted_company`で実地検証済み）。`list_interview_steps`は`models.InterviewStep.company_id == company_id, models.InterviewStep.is_deleted.is_(False)`でフィルタしており、削除済みステップの漏洩経路はない（`test_list_interview_steps_excludes_deleted`で確認済み）。`_get_active_interview_step_or_404`（`delete_interview_step`が利用）も`is_deleted.is_(False)`でフィルタしている。`delete_interview_step`は`interview_step.is_deleted = True; db.commit()`のみで、物理削除（`DELETE FROM`相当）は行っていない。`test_delete_interview_step_marks_is_deleted_and_excludes_from_list`・`test_delete_interview_step_is_idempotent_not_found_on_second_call`で実地検証済み。
  - **エラーハンドリング**: 404は`HTTPException(status_code=404, detail="Company not found")`／`"InterviewStep not found"`という固定文字列のみで、スタックトレース・SQLクエリ文字列・内部パス等の漏洩はない。FastAPIの`debug`モードやSQLAlchemy engineの`echo=True`も有効化されていない（既存タスクからの評価と変化なし、`docs_url`/`redoc_url`/`openapi_url`も引き続き無効化されたまま）。
  - **CORS・シークレット管理**: 本タスクの差分にCORS関連の変更はなく、`CORSMiddleware`は引き続き未導入（安全側のデフォルト、フロントエンド/CORS設定は別タスクで対応予定）。APIキー・DB接続情報のハードコードはなく、`tests/test_interview_steps.py`の`TEST_API_KEY = "test-secret-key"`はテスト専用値で`monkeypatch.setenv`経由のみに使われログ出力もない。
  - **既存パターンからの逸脱有無**: `app/routers/tasks.py`・`app/routers/companies.py`と1対1で比較し、`_get_active_company_or_404`（本ファイル内、companies.pyのものと同一実装だが独立して定義されており親テーブルの参照先を誤るリスクはない）・`_get_active_interview_step_or_404`ヘルパー、POST/GET一覧/DELETEの実装構造いずれも既存パターン（Task CRUD）を踏襲しており、認証・論理削除・スキーマ分離の観点で逸脱は見られなかった。
  - **generatorが報告した既存バグ（`app/models.py`のInterviewStep.date）の確認**: 実際に検証した。フィールド名と型名が同じ`date: Mapped[date | None] = mapped_column(Date, nullable=True)`という構造で、Pythonのクラス本体実行順序（値の代入によりクラス名前空間の`date`が`mapped_column(...)`の返り値で上書きされた後にアノテーション式`date | None`が評価される）により、素の`date`型ではなく`mapped_column()`の返り値（`MappedColumn`相当のオブジェクト）に対して`| None`が評価されることを、実際に同型の再現コード（`class Foo: date: Mapped[date | None] = mapped_column(Date, nullable=True)`）を実行して確認した。このオブジェクトは`__or__`を実装しているため`TypeError`にはならず、`Foo.__annotations__['date']`は`Mapped[<BooleanClauseList オブジェクト>]`という無意味な型注釈になることも実際に確認した。一方、`sqlalchemy.inspect(models.InterviewStep).columns['date'].type`は`DATE`であり、`models.InterviewStep.date == None`も正しく`interview_step.date IS NULL`というSQL式を生成することを実行確認した。これは`mapped_column(Date, nullable=True)`のように型を明示引数で渡している場合、SQLAlchemyは列の実際の型をこの明示引数から決定し、（壊れた）クラスアノテーションの中身は列マッピング処理では使用されないためである。したがって、generatorの報告（TypeErrorにならない理由・実害がないという結論）は正確であると判断した。セキュリティ上のリスク（インジェクション・認可バイパス・データ漏洩等）には該当しない。型安全上のリスクとしては、将来`mapped_column()`の型引数を省略してアノテーション由来の型推論に切り替えるような変更が行われた場合に、この列だけ型推論が壊れたオブジェクトから行われてSQLAlchemyのマッピングエラーを引き起こす可能性がある「潜在的な将来のフットガン」である点、また静的型チェッカー（mypy等）にとっても`Mapped[date | None]`という意図した型情報が実質的に失われている点は留意事項として記録するが、本タスクのスコープ外の既存コードであり、実害もないため差し戻し理由にはしない。
  - `uv run pytest -v`は138件全てpass（新規`tests/test_interview_steps.py`11件含む、既存への回帰なし）、`uv run ruff check`も違反なし。コード変更は行っていない（確認・実地検証のみ）。
- 性能エバリュエーターのフィードバック: `uv run pytest -v`は138件全てpass（新規`tests/test_interview_steps.py`11件含む、既存への回帰なし）、`uv run ruff check`も違反なし。受け入れ条件4点はいずれも対応するテストが存在し実際にパスしていることを確認した。
  - 「企業配下に選考ステップを追加できる」: `test_create_interview_step_reflects_input_in_response`でPOST後のレスポンス内容（`type`/`date`/`memo`/`company_id`/`is_deleted`/`id`）を検証済み。PASS。
  - 「企業配下の選考ステップ一覧取得では is_deleted=false のステップのみが返る」: `test_list_interview_steps_excludes_deleted`で削除済みステップが一覧から除外され未削除ステップのみ残ることを検証済み。PASS。
  - 「選考ステップを削除すると is_deleted が true になり、以降の一覧取得結果に含まれなくなる」: `test_delete_interview_step_marks_is_deleted_and_excludes_from_list`（一覧除外）・`test_delete_interview_step_is_idempotent_not_found_on_second_call`（2回目のDELETEが404になる＝実際にis_deleted=trueへ更新されている）で検証済み。PASS。
  - 「存在しない企業id・選考ステップidを指定した場合はエラー（404等）が返る」: 企業id側は`test_create_interview_step_not_found_for_unknown_company_id`・`test_create_interview_step_not_found_for_deleted_company`・`test_list_interview_steps_not_found_for_unknown_company_id`・`test_list_interview_steps_not_found_for_deleted_company`で存在しないid・論理削除済みidの両パターンを網羅。選考ステップid側は`test_delete_interview_step_not_found_for_unknown_id`で網羅（本タスクの範囲にはGET単体エンドポイントがなくPATCHは別タスクのため、選考ステップidが登場するのはDELETEのみで妥当）。PASS。
  - **不足指摘（差し戻し理由）**: generatorの技術判断「prep_status/resultにデフォルト値（準備中/未定）を設定し、リクエストでは任意項目にした」について、`test_create_interview_step_defaults_prep_status_and_result`は**省略時にデフォルト値が適用されること**のみを検証しており、「任意項目」のもう一方の意味である**クライアントが明示的に非デフォルト値（例: `prep_status: "準備万端"`, `result: "通過"`）を指定した場合にその値がそのまま作成・反映されること**を検証するテストが存在しない。現状のテストスイートでは、将来`InterviewStepCreate`や`create_interview_step`の実装が変わり明示指定値が無視されてデフォルト値に固定されてしまうような回帰が発生してもテストで検知できない。この技術判断が実装意図通り機能していることを担保するテストの追加を推奨する。
  - 対応（差し戻しへの修正）: `tests/test_interview_steps.py`に`test_create_interview_step_reflects_explicit_non_default_prep_status_and_result`を追加した。POST時に`prep_status: "準備万端"`・`result: "通過"`（いずれも非デフォルト値）を明示指定した場合、レスポンスにその値がそのまま反映されることを検証する。実装コード（`app/schemas.py`・`app/routers/interview_steps.py`）は`model_dump()`経由でリクエスト値をそのまま`InterviewStep`モデルに渡す既存実装で対応済みのため変更不要と判断し、変更していない。`uv run pytest -v`は139件全てpass（新規1件追加、既存への回帰なし）、`uv run ruff check`も違反なし。
- 性能エバリュエーターの再検証（差し戻し2回目後の再確認）: `uv run pytest -v`は139件全てpass（`test_interview_steps.py`は13件、新規`test_create_interview_step_reflects_explicit_non_default_prep_status_and_result`含め全てPASS、既存への回帰なし）、`uv run ruff check`も"All checks passed!"で違反なし。アプリケーションコードの差分は無いことを確認した（今回の修正はテスト追加のみ）。受け入れ条件4点を再確認した。
  - 「企業配下に選考ステップを追加できる」: `test_create_interview_step_reflects_input_in_response`でPASS。加えて、前回差し戻し理由だった「prep_status/resultへの明示的な非デフォルト値指定がレスポンスに正しく反映されるか」が新規`test_create_interview_step_reflects_explicit_non_default_prep_status_and_result`（`prep_status: "準備万端"`, `result: "通過"`を明示指定しレスポンスにそのまま反映されることを確認）でPASSしており、指摘は解消された。
  - 「企業配下の選考ステップ一覧取得では is_deleted=false のステップのみが返る」: `test_list_interview_steps_excludes_deleted`でPASS。
  - 「選考ステップを削除すると is_deleted が true になり、以降の一覧取得結果に含まれなくなる」: `test_delete_interview_step_marks_is_deleted_and_excludes_from_list`・`test_delete_interview_step_is_idempotent_not_found_on_second_call`でPASS。
  - 「存在しない企業id・選考ステップidを指定した場合はエラー（404等）が返る」: `test_create_interview_step_not_found_for_unknown_company_id`・`test_create_interview_step_not_found_for_deleted_company`・`test_list_interview_steps_not_found_for_unknown_company_id`・`test_list_interview_steps_not_found_for_deleted_company`・`test_delete_interview_step_not_found_for_unknown_id`でPASS。
  - 追加の不足指摘は無し。受け入れ条件4点全てが対応するテストで裏付けられ、既存テストへの回帰も無いためstatusを「完了」とする。
- 差し戻し回数: 1

### タスク: InterviewStep更新エンドポイント
- status: 完了
- 概要: 選考ステップの項目更新と、prep_status・result双方の状態遷移グラフに基づく逆行遷移時の警告付与を実装する（resultは未定→通過・不通過の分岐構造）。
- 受け入れ条件:
  - [x] 選考ステップの各項目を更新できる
  - [x] prep_statusを逆行させて更新すると、200とともに警告フィールドが返る
  - [x] resultを未定より前に戻すような明確な逆行を行うと、200とともに警告フィールドが返る
  - [x] 通過→不通過のような枝分かれ先同士の遷移では警告フィールドは含まれない
  - [x] 順当な遷移では警告フィールドは含まれない
- 実装メモ（技術判断とその理由）:
  - **1つのPATCHでprep_status・resultの2つの状態遷移グラフを独立判定する実装（確定: 個別に判定し、複数警告時は1つのwarning文字列に結合）**: `app/routers/interview_steps.py`の`update_interview_step`で、`INTERVIEW_STEP_PREP_STATUS_GRAPH`・`INTERVIEW_STEP_RESULT_GRAPH`それぞれに対し`check_backward_transition`を個別に呼び出し、両方が警告を返した場合は`" / "`で連結して単一の`warning: str | None`フィールドに格納する。`ProjectPatchResponse`・`TaskPatchResponse`が既に`warning: str | None`という単一文字列の型で確立されているため、InterviewStepだけ`list[str] | None`等の別型にするとクライアント側のレスポンス処理が項目ごとに分岐して煩雑になる（既存PatchResponse群との一貫性を優先）。将来的にwarningの発生源（prep_status由来かresult由来か）をクライアントが機械的に区別する要件が生じた場合は、`prep_status_warning`・`result_warning`のような個別フィールドへの分割が代替案になりうるが、現時点の受け入れ条件はwarningフィールドの有無のみを要求しており、文字列内にfrom/to両方のステータス名が含まれていればテストで十分検証できるため、シンプルさを優先し単一文字列結合とした。
  - 既存の`app/routers/projects.py`（`update_project`）・`app/routers/tasks.py`（`update_task`）のPATCHパターン（`ProjectUpdate`/`TaskUpdate`の`model_validator`による必須フィールド明示null拒否、`exclude_unset=True`によるPATCHセマンティクス、`check_backward_transition`の呼び出し順序）をそのまま踏襲した。`InterviewStepUpdate`の必須項目（DB上`nullable=False`）は`type`/`prep_status`/`result`、nullクリア許可項目は`date`/`memo`。
  - `tests/test_interview_steps.py`にPATCH関連テスト18件を追加（全項目更新、date/memoのnullクリア、必須項目への明示null送信で422、存在しないid、prep_status単独の逆行/順当/同一遷移、result単独の逆行/順当/分岐遷移、prep_status・result同時逆行時の警告文字列結合、ステータス変更なしでwarningなし）。
- セキュリティエバリュエーターのフィードバック: Critical/High相当の問題なし。承認する。`git diff`で変更範囲が`app/schemas.py`（`InterviewStepUpdate`/`InterviewStepPatchResponse`追加）・`app/routers/interview_steps.py`（`update_interview_step`追加）・`tests/test_interview_steps.py`（テスト18件追加）・`spec.md`のみであることを確認したうえで、以下を検証した。
  - **認証**: `PATCH /interview-steps/{id}`は個別のdependenciesを持たないが、`app/main.py`で`verify_api_key`が`FastAPI(dependencies=[Depends(verify_api_key)])`としてアプリ全体のグローバル依存関係に登録されており、新規追加された本エンドポイントも自動的に対象になる（実地検証: `X-API-Key`ヘッダーなしでPATCHを送信し401を確認）。`verify_api_key`自体は`secrets.compare_digest`による定数時間比較を継続使用しており、単純な`==`比較への後退はない。
  - **mass assignment**: `InterviewStepUpdate`スキーマに`id`・`company_id`・`is_deleted`フィールドは定義されておらず、ルータ側も`payload.model_dump(exclude_unset=True)`で得たキーのみを`setattr`しているため、これらのフィールドはPydantic側で黙って無視される。実地検証として`{"id": 999, "company_id": 88888, "is_deleted": True, "type": "改ざん"}`をPATCHで送信したところ、`type`のみ反映され`id`・`company_id`・`is_deleted`は元の値のまま変化しなかったことを確認した。レスポンススキーマも`InterviewStepPatchResponse`（`InterviewStepRead`を継承）として出力専用に分離されており、入力スキーマと混同していない。
  - **SQLインジェクション**: `update_interview_step`はSQLAlchemy ORM（`db.query`によるフィルタ、`setattr`によるモデル属性更新、`db.commit`）のみを使用しており生SQL文字列結合はない。`memo`に`'; DROP TABLE interview_step; --`のような文字列を送信して実地検証したところ、単なるTEXTデータとして保存され、後続の一覧取得・テーブル状態に異常は見られなかった。
  - **論理削除の徹底**: 更新対象の取得は`_get_active_interview_step_or_404`経由で`is_deleted.is_(False)`フィルタを通っており、論理削除済みレコードをPATCHで復活・改ざんできない。PATCH自体は`is_deleted`を操作しない（上記mass assignment項目参照）。
  - **必須フィールドへの明示null送信**: `InterviewStepUpdate`の`model_validator`が`type`/`prep_status`/`result`への明示的null送信を422で拒否することを確認（テスト3件+実地検証、DBの`nullable=False`カラムと整合）。`date`/`memo`はnullable=Trueカラムに対応し、nullクリアが許可される設計も`app/models.py`の列定義と一致している。
  - **状態遷移警告ロジック**: `prep_status`・`result`それぞれについて、更新データに当該フィールドが含まれかつ現在値と異なる場合にのみ`check_backward_transition`を個別に呼び出しており、既存の`INTERVIEW_STEP_PREP_STATUS_GRAPH`・`INTERVIEW_STEP_RESULT_GRAPH`（`app/status_transitions.py`で確定済み、本タスクでの変更なし）を正しく再利用している。2グラフが完全に独立して判定されるため、一方の判定がもう一方に影響しない設計を確認した。
  - **" / "区切りの警告結合について**: 情報表現として妥当と判断する。結合対象の`from_status`/`to_status`は`InterviewStepPrepStatus`/`InterviewStepResult`という固定Literal型（`INTERVIEW_STEP_PREP_STATUS_GRAPH`/`INTERVIEW_STEP_RESULT_GRAPH`のキー由来）に制約されており、自由入力の`type`/`memo`のような任意文字列は警告メッセージに含まれない。そのため区切り文字` / `自体が万一ステータス名に含まれていて2つの警告の境界が曖昧になる、といったログ偽装・メッセージ混入系のリスクはない。またこの警告文字列はクライアントへの表示用メッセージであり、認可判定や後続のロジック分岐に使われるトークンでもないため、単一文字列への結合は情報漏洩やなりすましのリスクを生まない。既存`ProjectPatchResponse`/`TaskPatchResponse`との型的一貫性を優先する設計判断も、セキュリティ上のトレードオフは伴わない。
  - **エラーハンドリング**: 存在しないidへのPATCHは404、不正なLiteral値（例: `prep_status`に未定義の文字列）は422で、いずれもFastAPI標準のバリデーションエラー形式のみを返し、スタックトレースや内部パス、SQLクエリ文字列の漏洩は確認されなかった。
  - **CORS・シークレット管理**: 本タスクの差分にCORS関連の変更はなく、`CORSMiddleware`は引き続き未導入（既存タスクからの評価と同じく安全側のデフォルト、フロントエンド/CORS設定は別タスクで対応予定）。APIキー・DB接続情報のハードコードはなく、`tests/test_interview_steps.py`の`TEST_API_KEY = "test-secret-key"`はテスト専用値で`monkeypatch.setenv`経由のみに使われログ出力もない。
  - `uv run pytest tests/test_interview_steps.py`で31件全てpassすることを確認済み。
- 性能エバリュエーターのフィードバック: 承認する。`uv run pytest -v`は157件全てpass（既存テストへの回帰なし）、`uv run ruff check`も違反なし。`app/schemas.py`（`InterviewStepUpdate`/`InterviewStepPatchResponse`）、`app/routers/interview_steps.py`（`update_interview_step`）、`tests/test_interview_steps.py`（PATCH関連18件、作成・一覧含め全体31件）を確認し、受け入れ条件5点を以下の通りテストで裏付け済みと判断した。
  - 「各項目を更新できる」: `test_update_interview_step_updates_fields`（type/memo）、`test_update_interview_step_can_clear_nullable_field`（date/memoのnullクリア）、各status系テストでのprep_status/result更新で網羅。
  - 「prep_status逆行でwarning付き200」: `test_update_interview_step_prep_status_backward_transition_returns_warning`（完了→準備中）で確認。
  - 「result逆行でwarning付き200」: `test_update_interview_step_result_backward_transition_returns_warning`（通過→未定）で確認。
  - 「通過⇔不通過など枝分かれ先同士でwarningなし」: `test_update_interview_step_result_branch_to_branch_transition_has_no_warning`（通過→不通過）で確認。逆方向（不通過→通過）は純粋関数レベルの`tests/test_status_transitions.py::test_result_unrelated_branch_no_warning`で両方向とも確認済み。
  - 「順当な遷移でwarningなし」: prep_status（同一/隣接/飛び越え）・result（同一/分岐先1/分岐先2）を`parametrize`で網羅。
  - 境界値（同一・隣接・飛び越え・逆行・枝分かれ）はエンドポイントレベルでも概ね網羅されており、純粋関数レベルでも別途カバーされている。論理削除済みレコードへのPATCHが404になることは既存の`_get_active_interview_step_or_404`経由の挙動として妥当（本タスクの差分に新規の論理削除周りの変更はなく、既存の企業/選考ステップ論理削除テストと矛盾なし）。
  - **指摘事項（非ブロッキング）**: `test_update_interview_step_both_prep_status_and_result_backward_returns_combined_warning`は、prep_status・result同時逆行時に`body["warning"]`へ4つのステータス名（完了/準備中/通過/未定）が全て含まれることをsubstringアサーションで検証しているが、承認済みの結合仕様である`" / "`区切り自体を直接検証するアサーション（例: `" / " in body["warning"]`や`body["warning"].split(" / ")`の要素数確認）が無い。そのため、仮に実装が区切り文字なしで連結する、または別の区切り文字（例: `", "`）に変わる退行が起きても、4つの部分文字列が引き続き含まれる限りこのテストはpassしてしまい、区切り文字の退行を検知できない。ただし本項目は正式な受け入れ条件そのものではなく実装メモレベルの技術判断（結合仕様）であり、結合機能自体（両警告のfrom/to情報が失われず反映されること）は検証されているため、完了のブロッカーとはしない。将来テストを追加する際は`" / "`区切りの厳密な検証を推奨する（テストコード自体の追加はgeneratorの役割のため本評価では追記しない）。
  - **追記（軽微な追加修正）**: 上記指摘を受け、`test_update_interview_step_both_prep_status_and_result_backward_returns_combined_warning`を`body["warning"] == f"{expected_prep_status_warning} / {expected_result_warning}"`という完全一致アサーションに変更し、`" / "`区切り自体の退行を検知できるようにした。実装コード（`app/routers/interview_steps.py`・`app/schemas.py`）の変更はなくテスト強化のみのため、セキュリティ・性能評価のやり直しは不要と判断した。
- 差し戻し回数: 0

### タスク: 選考ステップ横断一覧エンドポイント（upcoming）
- status: 完了
- 概要: 全企業を横断して、日付が近い順に選考ステップを一覧できるようにし、締切管理を可能にする。
- 受け入れ条件:
  - [x] 全企業の選考ステップが、予定日の近い順（昇順）に並んで返る
  - [x] is_deleted=true の選考ステップは含まれない
  - [x] 予定日が未設定の選考ステップの扱いが一貫している
- 実装メモ（技術判断とその理由）:
  - **予定日（date）が未設定の選考ステップの扱い（確定: 除外せず、一覧の末尾にまとめて含める）**: 締切管理という目的上、日付未設定のステップは「近い将来の締切」ではないため先頭には来ないが、除外してしまうと「まだ日程未定だが対応が必要な選考」がこの横断一覧から一切見えなくなり、締切管理ツールとしての網羅性が損なわれる。そのためSQLレベルで`ORDER BY (date IS NULL), date ASC`とし、日付ありのステップを昇順で先に並べたうえで、日付未設定のステップを（順序内で互いの前後関係は問わず）末尾にまとめて含める方式を採用した。
  - `GET /interview-steps/upcoming`は既存の`app/routers/interview_steps.py`に追加し、レスポンススキーマは既存の`InterviewStepRead`をそのまま再利用した（一覧専用の新規スキーマは不要と判断）。
  - **ルート定義順序について**: 本エンドポイントはGETのみで、既存の`/interview-steps/{interview_step_id}`はPATCH・DELETEのみが定義されておりGETは存在しないため、HTTPメソッドが異なり実際にはパスの競合は発生しない（FastAPIはメソッド単位でルートを解決するため）。念のため`list_upcoming_interview_steps`は既存のPATCH/DELETEより前の位置（`list_interview_steps`の直後）に定義し、可読性・保守性の観点でも固定パスを動的パスより前に置く慣習に沿わせた。
  - `tests/test_interview_steps.py`に5件追加（予定日昇順ソート、複数企業を横断すること、論理削除済みステップの除外、日付未設定ステップが末尾に含まれること、認証必須）。
- セキュリティエバリュエーターのフィードバック: Critical/High相当の問題なし。承認する。`git diff`で変更範囲が`app/routers/interview_steps.py`（`list_upcoming_interview_steps`追加のみ）・`tests/test_interview_steps.py`（テスト5件追加）であることを確認したうえで、以下を検証した。
  - **認証**: `list_upcoming_interview_steps`は個別の`dependencies`指定を持たず、`app/main.py`の`FastAPI(dependencies=[Depends(verify_api_key)])`というグローバル依存関係をそのまま継承する（他の`interview_steps.router`配下エンドポイントと同型）。実地検証として`uv run pytest tests/test_interview_steps.py -v`を実行し、新規`test_upcoming_interview_steps_requires_api_key`（APIキーなしで401）を含む36件全てpassすることを確認した。`app/auth.py`の`verify_api_key`自体は前タスクから変更なく、fail-closed設計・`secrets.compare_digest`による定数時間比較・`/docs`等の無効化も維持されている。
  - **ルート定義順序（生成者の報告の裏付け）**: `grep`で`app/routers/interview_steps.py`・`app/routers/companies.py`配下の全ルートデコレータを確認したところ、`GET /interview-steps/{interview_step_id}`という単体取得エンドポイント自体がそもそも存在せず（PATCH/DELETEのみ定義）、`GET /interview-steps/upcoming`とHTTPメソッドが重複するルートは存在しないことを確認した。FastAPI/Starletteはメソッドとパスの組み合わせで個別にルートを解決するため、パスセグメント`upcoming`が動的パラメータ`{interview_step_id}`と文字列として一致する可能性自体は問題にならない（GETという同一メソッドでの競合が存在しない以上、定義順序に依らず期待通りに解決される）。generatorの報告は正確と判断した。念のため実際に`uv run pytest`でエンドポイントが期待通り200を返すことも確認済み。
  - **SQLインジェクション**: `list_upcoming_interview_steps`は`db.query(models.InterviewStep).filter(models.InterviewStep.is_deleted.is_(False)).order_by(models.InterviewStep.date.is_(None), models.InterviewStep.date.asc()).all()`という実装で、`ORDER BY`句を含め生SQL文字列結合は一切なく、全てSQLAlchemyのORM式（`Column.is_()`/`.asc()`）経由でパラメータ化されている。ユーザー入力を受け取るパラメータは存在しない（クエリパラメータ・パスパラメータともになし）ため、この観点でのインジェクション経路はそもそも存在しない。
  - **論理削除の徹底**: `models.InterviewStep.is_deleted.is_(False)`フィルタが存在し、`test_upcoming_interview_steps_excludes_deleted`で論理削除済みステップが一覧から除外されることを実地検証済み（`uv run pytest`でpass）。物理削除（`DELETE FROM`相当）は本エンドポイントに存在しない（読み取り専用）。
  - **予定日未設定（NULL）ステップを除外せず末尾に含める設計判断について**: 情報漏洩や意図しないデータ露出には該当しないと判断した。理由は次の2点。(1) 本APIは本人専用ツールであり、全企業・全選考ステップは同一ユーザーの所有データである。このエンドポイントは`is_deleted=false`の自身のデータのみを返しており、他ユーザーのデータや本来非公開であるべき情報を露出させるものではない。(2) 除外せず含める設計は、企業配下の一覧取得エンドポイント（`GET /companies/{company_id}/interview-steps`）で元々アクセス可能な情報（日付未設定のステップも含む）を、横断的に集約して見せているだけであり、新たな情報の露出経路を追加するものではない。`spec.md`の実装メモに記載された設計判断・トレードオフも一貫しており、受け入れ条件「予定日が未設定の選考ステップの扱いが一貫している」を満たす。
  - **レスポンススキーマ**: 既存の`InterviewStepRead`（`id`/`company_id`/`type`/`date`/`prep_status`/`result`/`memo`/`is_deleted`）をそのまま再利用しており、新規フィールドの追加・スキーマの緩和は無い。mass assignmentの懸念は無い（本エンドポイントは読み取り専用でリクエストボディも受け取らない）。
  - **エラーハンドリング**: 本エンドポイントは404等の分岐を持たず、常に200・空配列を含むリストを返す実装であり、スタックトレースや内部パス、SQLクエリ文字列がレスポンスに含まれる経路はない。
  - **CORS・シークレット管理**: 本タスクの差分にCORS関連の変更はなく、`CORSMiddleware`は引き続き未導入（安全側のデフォルト、フロントエンド/CORS設定は別タスクで対応予定）。APIキー・DB接続情報のハードコードや新規のログ出力もない。
  - **補足（非ブロッキングの参考情報）**: 本エンドポイントは`Company.is_deleted`を一切チェックせず`InterviewStep`単体のみをクエリしているため、実地検証（`uv run pytest`外での手動テストコードによる検証、コード変更なし）したところ、企業を論理削除（`DELETE /companies/{id}`）した後もその企業配下の選考ステップ（`is_deleted=false`のまま）は本エンドポイントの一覧に引き続き表示されることを確認した。一方`GET /companies/{company_id}/interview-steps`は親企業が削除済みだと404になり、同じステップへ企業経由ではアクセスできなくなる。両者の間に「企業を削除した後もその配下データが別経路（横断一覧）では見え続ける」という一貫性の欠如があるが、(1) 本人専用ツールで同一所有者のデータであり認可バイパスではない、(2) 受け入れ条件「is_deleted=trueの選考ステップは含まれない」自体は満たしている、(3) 企業削除後に配下ステップを個別に整理するかは運用判断の余地があるため、Critical/High相当の問題とはしない。ただし「企業を削除したのに選考ステップの締切管理一覧には出続ける」という直感に反する挙動になりうるため、将来的に`join(models.Company).filter(models.Company.is_deleted.is_(False))`を追加する、または意図的な仕様として`spec.md`に明記することを推奨する。
  - `uv run pytest tests/test_interview_steps.py -v`で36件全てpass（新規5件含む、既存への回帰なし）。
- 性能エバリュエーターのフィードバック: 合格。実際に`uv run pytest -v`（プロジェクト全体）を実行し162件全てpass、warning出力は1件もないことを確認した（pyproject.tomlのpytest設定に`filterwarnings`指定は無く、warningが発生していれば通常表示されるはずだが該当なし）。既存テストへの回帰もなし。`uv run ruff check`も`All checks passed!`。受け入れ条件3点を実際にテストを実行して個別に確認した。
  - 「全企業の選考ステップが予定日の近い順（昇順）に並んで返る」: `test_upcoming_interview_steps_sorted_by_date_ascending`（1企業内3件の日付昇順）と`test_upcoming_interview_steps_spans_multiple_companies`（2企業を横断した日付昇順）の両方でPASS。
  - 「is_deleted=trueの選考ステップは含まれない」: `test_upcoming_interview_steps_excludes_deleted`でPASS。実装の`filter(models.InterviewStep.is_deleted.is_(False))`と一致。
  - 「予定日が未設定の選考ステップの扱いが一貫している」: `test_upcoming_interview_steps_with_unset_date_are_included_at_the_end`で、日付未設定ステップが除外されず日付ありステップより後ろに位置することを確認しPASS。実装の`ORDER BY (date IS NULL), date ASC`および実装メモの技術判断と整合している。
  - 認証必須（`test_upcoming_interview_steps_requires_api_key`）もPASS。
  - テスト件数も報告通り（`tests/test_interview_steps.py`合計36件、うち`upcoming`関連新規5件）であることを`-v`出力で確認した。
  - セキュリティエバリュエーターから参考情報として挙がっていた「企業を論理削除してもその配下の選考ステップがupcoming一覧に表示され続ける（`Company.is_deleted`未チェック）」という点は、本タスクの受け入れ条件3点（予定日昇順／論理削除ステップの除外／予定日未設定の扱いの一貫性）のいずれにも該当せず、かつセキュリティエバリュエーター自身も「本人専用ツールで認可バイパスに当たらずCritical/High相当ではない」と既に判定済みの非ブロッキング事項であるため、今回は差し戻し理由とはしなかった。将来的に企業横断の一貫性を仕様として明確にしたい場合は別タスク・別の受け入れ条件として扱うことを推奨する。
  - 受け入れ条件が全てテストで裏付けられ、pytest・ruffともに問題なしのため、statusを「完了」に更新する。
- 修正依頼への対応（企業論理削除後の一貫性の是正）: セキュリティエバリュエーターが「補足（非ブロッキングの参考情報）」として指摘していた、企業を論理削除（`DELETE /companies/{id}`）した後もその配下の選考ステップが`upcoming`一覧に表示され続ける問題について、`GET /companies/{company_id}/interview-steps`（親企業削除済みなら404）との一貫性を取るための修正依頼を受け対応した。
  - `app/routers/interview_steps.py`の`list_upcoming_interview_steps`のクエリに`models.Company`とのJOIN（`InterviewStep.company_id == Company.id`）を追加し、`Company.is_deleted.is_(False)`のフィルタを`InterviewStep.is_deleted.is_(False)`と併せて適用するように変更した。これにより論理削除済み企業配下の選考ステップは`upcoming`一覧から除外される。
  - `tests/test_interview_steps.py`に`test_upcoming_interview_steps_excludes_steps_of_deleted_company`を追加し、企業削除後にその配下ステップが一覧から除外され、他の有効な企業のステップは引き続き含まれることを検証した。
  - `uv run pytest -v`は163件（新規1件含む）全てpass、warning出力なし。`uv run ruff check`も`All checks passed!`。既存テストへの回帰なし。
  - statusをセキュリティ評価待ちに戻す。
- セキュリティエバリュエーターのフィードバック（修正対応の再評価）: Critical/High相当の問題なし。承認する。`git diff`で今回の変更範囲が`app/routers/interview_steps.py`の`list_upcoming_interview_steps`への`models.Company`とのJOIN追加・`Company.is_deleted.is_(False)`フィルタ追加、および`tests/test_interview_steps.py`へのテスト1件追加のみであることを確認したうえで、以下を検証した。
  - **JOINクエリのパラメータ化**: `db.query(models.InterviewStep).join(models.Company, models.InterviewStep.company_id == models.Company.id).filter(models.InterviewStep.is_deleted.is_(False), models.Company.is_deleted.is_(False))`はSQLAlchemyのORM式のみで構成されており、生SQL文字列結合は一切ない。パス・クエリパラメータともに存在せず、ユーザー入力を受け取る箇所自体が無いため、この観点でのSQLインジェクション経路はそもそも存在しない。
  - **JOINによる行の重複・消失リスク**: `app/models.py`で`InterviewStep.company_id`は`ForeignKey("company.id")`かつ`nullable=False`、`Company.id`はPKであるため、この結合は各`InterviewStep`行に対して`Company`行がちょうど1件対応する多対1関係であり、fan-outによる行の重複や意図しない行消失は起こり得ない。
  - **既存の論理削除フィルタ（`InterviewStep.is_deleted`）の継続動作**: 変更前と同じ条件式のまま`.filter()`内に維持されており、新規の`Company.is_deleted.is_(False)`とAND結合されている。既存の`test_upcoming_interview_steps_excludes_deleted`（ステップ単体の論理削除）と新規の`test_upcoming_interview_steps_excludes_steps_of_deleted_company`（企業の論理削除経由、他の有効企業のステップは引き続き含まれることも検証）の両方が実際に`uv run pytest`でpassすることを確認し、2つのフィルタが独立して機能していることを裏付けた。
  - **受け入れ条件・他エンドポイントへの影響**: 3つの受け入れ条件（昇順ソート・is_deleted除外・日付未設定の扱い）を検証する既存テスト（`test_upcoming_interview_steps_sorted_by_date_ascending`／`test_upcoming_interview_steps_spans_multiple_companies`／`test_upcoming_interview_steps_with_unset_date_are_included_at_the_end`）は全てpassしたままで退行なし。`GET /companies/{company_id}/interview-steps`等の他エンドポイントのコードは今回の差分に含まれておらず無変更。今回の修正は、前回のセキュリティレビューで指摘した「企業削除後もupcoming一覧にはその配下ステップが表示され続ける」という一貫性の欠如を是正するものであり、退行ではなく改善と判断した。
  - **認証・レスポンススキーマ・エラーハンドリング・CORS・シークレット管理**: 今回の差分に変更なし。`app/main.py`のグローバル`dependencies=[Depends(verify_api_key)]`は健在で、`list_upcoming_interview_steps`は個別`dependencies`指定なしでこれを継承する（`app/main.py`・`app/auth.py`を確認）。CORS関連コードもこの差分には含まれていない。
  - `uv run pytest -v`（プロジェクト全体）で163件全てpass（新規1件含む、既存への回帰なし）、`uv run ruff check .`も`All checks passed!`であることを実地確認した。
  - statusを「性能評価待ち」に更新する。
- 性能エバリュエーターのフィードバック（修正対応の再評価）: 合格。`git diff`ではなく実行環境そのものを対象に、`uv run pytest -v`（プロジェクト全体）を実行し163件全てpass、pytestの出力にwarnings summaryセクションは無く（DeprecationWarning等を含め）warning出力は1件も無いことを確認した（出力中に"warning"という文字列を含む行は`test_..._returns_warning`という既存のステータス警告ロジック検証用テスト名のみで、実際のwarning発生ではないことをgrepで裏付けた）。`uv run ruff check`も`All checks passed!`。
  - 既存の受け入れ条件3点への回帰無し: `test_upcoming_interview_steps_sorted_by_date_ascending`・`test_upcoming_interview_steps_spans_multiple_companies`（予定日昇順）、`test_upcoming_interview_steps_excludes_deleted`（is_deleted除外）、`test_upcoming_interview_steps_with_unset_date_are_included_at_the_end`（予定日未設定の扱い）の4件がいずれもPASSすることを`-k upcoming`指定で個別実行して確認した。
  - 今回の修正意図（削除済み企業配下の選考ステップがupcoming一覧から除外されること）: `test_upcoming_interview_steps_excludes_steps_of_deleted_company`がPASSしており、削除済み企業配下のステップ（`id_orphaned`）が一覧から除外される一方、別の有効な企業配下のステップ（`id_active`）は引き続き含まれることの両方を検証している。境界を無効側・有効側の両方でカバーしており、テストとして十分である。
  - 実装（`app/routers/interview_steps.py`の`list_upcoming_interview_steps`）を確認し、`join(models.Company, models.InterviewStep.company_id == models.Company.id)`と`Company.is_deleted.is_(False)`フィルタが`InterviewStep.is_deleted.is_(False)`と併せてANDで適用されていることを実装メモ・セキュリティエバリュエーターの指摘通りと確認した。
  - `uv run pytest tests/test_interview_steps.py -v -k upcoming`で6件（既存4件・新規1件・認証必須1件）全てPASS。
  - 受け入れ条件が全てテストで裏付けられ、pytest・ruffともに問題なし、warningも無いため、statusを「完了」に更新する。
- 差し戻し回数: 0

### タスク: 稼働ログ横断一覧エンドポイント（running）
- status: 完了
- 概要: 全案件・全タスクを横断して、現在進行中の稼働ログを一覧できるようにする。
- 受け入れ条件:
  - [x] 終了時刻未設定かつ is_deleted=false の稼働ログが、全案件・全タスク横断で一覧取得できる
  - [x] 各ログがどのタスク・案件に属するかが結果から判別できる
- 実装メモ（技術判断とその理由）:
  - **論理削除の3段チェック（確定: 直前タスクの教訓を最初から反映）**: `upcoming`エンドポイントで後から発覚した「親の論理削除状態を見ておらず削除済み親配下のデータが横断一覧に残り続ける」というバグを繰り返さないため、`list_running_work_logs`は最初から`WorkLog.is_deleted.is_(False)` かつ `WorkLog.ended_at.is_(None)` に加え、`Task`・`Project`それぞれとJOINして両方の`is_deleted.is_(False)`を同時にフィルタする実装にした。
  - **レスポンス構造（確定: 新規スキーマ`RunningWorkLogRead`を新設し、task_id/project_idに加えtask_name/project_nameも含める）**: 「各ログがどのタスク・案件に属するかが結果から判別できる」という受け入れ条件を満たす最小要件はtask_id・project_idのID2つで足りるが、横断一覧という性質上、呼び出し側がIDだけを頼りに個別に`GET /tasks/{id}/work-logs`等へ追加問い合わせをして名前を引く手間を減らせるよう、既存の`WorkLogRead`のフィールド（id/task_id/started_at/ended_at/memo/is_deleted）に`task_name`・`project_id`・`project_name`を加えた専用スキーマ`RunningWorkLogRead`を`app/schemas.py`に新設した。`WorkLog`・`Task`・`Project`をJOINした複数カラムのタプル結果を単一のORMオブジェクトとして`from_attributes`で変換できないため、専用スキーマ側はJOIN結果からフィールドを手動で組み立てる実装とした。
  - `GET /work-logs/running`は既存の`app/routers/work_logs.py`に追加した。ルート定義順序について、既存の動的パスは`PATCH /work-logs/{work_log_id}/stop`と`DELETE /work-logs/{work_log_id}`のみで、`GET /work-logs/{work_log_id}`（単体取得）自体が定義されていないため、`GET /work-logs/running`とHTTPメソッド単位で競合するルートはそもそも存在しない。念のため`list_running_work_logs`は既存のタスク別一覧`list_work_logs`の直後、動的パスの`delete_work_log`より前の位置に定義し、固定パスを動的パスより前に置く慣習に沿わせた。
  - `tests/test_work_logs.py`に7件追加（進行中ログのみ返ること、複数案件・複数タスクを横断すること、レスポンスにtask_id/task_name/project_id/project_nameが含まれること、稼働ログ自体の論理削除の除外、削除済みタスク配下ログの除外、削除済み案件配下ログの除外、認証必須）。
  - `uv run pytest`は170件全てpass（新規7件含む、既存への回帰なし）、`uv run ruff check`も`All checks passed!`。
- セキュリティエバリュエーターのフィードバック:
  - 【評価結果】Critical/High相当の問題なし。以下の観点を確認済み。
    - **認証**: `GET /work-logs/running`は`work_logs.router`経由で`app.include_router`されており、`app.main`の`FastAPI(dependencies=[Depends(verify_api_key)])`によりアプリ全体にグローバル適用される`verify_api_key`の対象。個別routeにdependencyを明示していないが漏れではない。`verify_api_key`自体もヘッダー未指定・環境変数未設定はfail closed、比較は`secrets.compare_digest`で定数時間比較になっており妥当。`test_list_running_work_logs_requires_api_key`で401を確認するテストも追加されており実挙動と一致。
    - **インジェクション**: 生SQL文字列結合は無く、`db.query(...).join(...).filter(...)`とSQLAlchemy ORMのみで完結。`platform`/`memo`等のユーザー入力もこのエンドポイントは受け取っておらず（パラメータなしGET）、注入経路は無い。
    - **論理削除の徹底**: `WorkLog.is_deleted.is_(False)`に加え、`Task`・`Project`双方を`join`した上で`Task.is_deleted.is_(False)`・`Project.is_deleted.is_(False)`も同時にfilterしており、直前の`upcoming`タスクで発覚した「親の論理削除チェック漏れ」と同種の問題は無い。`delete_project`/`delete_task`の実装（`project.is_deleted = True; db.commit()`、`task.is_deleted = True; db.commit()`）も物理削除ではなくフラグ更新のみであることをソースで確認し、テスト`test_list_running_work_logs_excludes_logs_of_deleted_task`/`_deleted_project`/`_deleted_work_log`の3件がこの3段チェックを実際に検証している。
    - **情報漏洩**: レスポンススキーマ`RunningWorkLogRead`は`id`/`task_id`/`task_name`/`project_id`/`project_name`/`started_at`/`ended_at`/`memo`/`is_deleted`のみで、`Project`の`client_name`・`reward`・`platform`・`memo`や`Task`側の`memo`など、このエンドポイントの目的（進行中ログがどのタスク・案件に属するか判別できること）に不要な項目は含まれておらず、既存の`WorkLogRead`と同等の`memo`（WorkLog自身のもの）以上の追加情報漏洩は無い。
    - **mass assignment**: GET専用エンドポイントでリクエストボディ・更新系スキーマは存在せず該当なし。
    - **ルート定義順序**: 既存ルートに`GET /work-logs/{work_log_id}`（単体取得）は存在せず、`GET /work-logs/running`と衝突しうる動的パスは無いことをソースで確認。念のため固定パスを動的パスより前に定義する配置になっている点も適切。
    - **エラーハンドリング**: このエンドポイントは404/例外を投げるパスが無く（クエリが空でも200で空配列を返す設計）、スタックトレースや内部情報を露出する箇所は無い。
  - 【軽微な所感（Critical/High未満、指摘としては計上しない）】`memo`カラムは自由記述のTEXTであり、将来的にこのAPIの結果をそのまま別ツールへ転記・ログ出力するような使い方をする場合はエスケープに注意（現状のFastAPI/JSONレスポンスとしては問題なし）。
- 性能エバリュエーターのフィードバック: 合格。`uv run pytest -v`（プロジェクト全体）を実行し170件全てpass、既存テストへの回帰なしを確認した。pytestの出力にwarnings summaryセクションは無く、DeprecationWarning等を含め実際のwarning出力は1件も無かった（出力中の"warning"文字列を含む行は全て`test_..._returns_warning`/`test_..._has_no_warning`というステータス警告ロジック検証用の既存テスト名のみで、実際のwarning発生ではないことをgrepで確認済み）。`uv run ruff check`も`All checks passed!`。
  - 受け入れ条件1（終了時刻未設定かつis_deleted=falseの稼働ログが全案件・全タスク横断で一覧取得できる）: `test_list_running_work_logs_returns_only_unstopped_logs`（進行中ログのみ返り停止済みログは除外）と`test_list_running_work_logs_spans_multiple_projects_and_tasks`（複数案件・複数タスクの進行中ログが両方含まれる）の2件がPASSしており裏付けられている。
  - 受け入れ条件2（各ログがどのタスク・案件に属するかが結果から判別できる）: `test_list_running_work_logs_includes_task_and_project_identifiers`がPASSしており、レスポンスに`task_id`/`task_name`/`project_id`/`project_name`の4項目全てが含まれ、かつ値が実際のタスク名・案件名と一致することを検証している。
  - 実装メモに記載された「論理削除の3段チェック」（WorkLog自身・Task・Project）は、`test_list_running_work_logs_excludes_deleted_work_log`／`test_list_running_work_logs_excludes_logs_of_deleted_task`／`test_list_running_work_logs_excludes_logs_of_deleted_project`の3件がそれぞれ独立して検証しており、直前の`upcoming`タスクで発覚した「親の論理削除チェック漏れ」の再発は無いことをテストで裏付け済み。`app/routers/work_logs.py`の`list_running_work_logs`実装（`models.Task`・`models.Project`とのJOIN＋`is_deleted.is_(False)`を3テーブル分AND条件でfilter）も実装メモ・テスト内容と一致していることをソースで確認した。
  - `test_list_running_work_logs_requires_api_key`で認証必須（未指定時401）もPASSしており、既存の`test_endpoints_require_api_key`（他エンドポイント群）との重複ではなく`/work-logs/running`固有の確認として妥当。
  - `git status --short`で今回の変更が`app/routers/work_logs.py`・`app/schemas.py`・`tests/test_work_logs.py`（および本spec.md）のみであることを確認し、それ以外の既存ファイルへの意図しない変更が無いことも確認した。
  - `uv run pytest tests/test_work_logs.py -v -k running`で新規7件（既存の`test_start_work_log_allows_multiple_running_logs_for_same_task`を含め計8件マッチ）全てPASSすることも個別に確認した。
  - `WorkLog.task_id`・`Task.project_id`は共に`nullable=False`のFKであり、`Task`・`Project`ともにPKとJOINしているため多対1関係でfan-outによる行重複・消失のリスクも無いことをモデル定義（`app/models.py`）で確認した。
  - 受け入れ条件が全てテストで裏付けられ、pytest・ruffともに問題なし、warningも無いため、statusを「完了」に更新する。
- 差し戻し回数: 0

### タスク: CI/CDパイプライン構築
- status: 完了
- 概要: コード品質チェック・自動テスト・コンテナイメージビルドを自動化する。実際のデプロイ（デプロイ先の決定・接続）はこのタスクの対象外とする。
- 受け入れ条件:
  - [x] コードのpushまたはpull request作成時にワークフローが自動実行される
  - [x] lintに違反があるとワークフローが失敗する
  - [x] テストに失敗があるとワークフローが失敗する
  - [x] Dockerマルチステージビルドでイメージが正常にビルドできる
  - [x] 実デプロイのステップは含まれない
- 実装メモ（技術判断とその理由）:
  - **ワークフロー構成（`.github/workflows/ci.yml`）**: `on: push` / `on: pull_request`（ブランチ指定なし＝全ブランチ・全PR対象）でトリガー。ジョブは`lint`（`uv run ruff check .`）→`test`（`uv run pytest`、`needs: lint`）→`build`（Dockerイメージビルド、`needs: test`）の順に`needs`で直列依存させ、「lint失敗時はテストも走らない／テスト失敗時はビルドも走らない」という失敗時の早期打ち切りにした（受け入れ条件の「lint/testの失敗でワークフローが失敗する」を満たしつつ、CI時間を無駄にしない一般的なパターン）。依存関係インストールはプロジェクトが`uv`ベースであることに合わせ`astral-sh/setup-uv@v4`＋`uv sync --locked`を使用（`--locked`により`uv.lock`との不整合があれば失敗し、依存関係の再現性を保証）。Pythonバージョンは`pyproject.toml`の`requires-python = ">=3.12"`・`.python-version`（3.12）に合わせて`3.12`を指定。
  - **testジョブの環境変数（確定: `API_KEY`をワークフローに明示設定するが、これは保険目的であり必須ではない）**: `tests/*.py`を確認したところ、`test_status_transitions.py`（純粋関数のみ）と`test_db_init.py`（認証不要のエンドポイントのみ使用）を除く全テストファイルが`monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)`で各テスト自身がAPI_KEYを設定しており、DBも`get_db`の依存関係オーバーライド＋`tmp_path`の一時ファイルDBで完結しているため、ワークフロー側で`API_KEY`や`DATABASE_URL`を設定しなくても`uv run pytest`はローカル同様に全件passすることを確認済み（実際に手元で無設定のまま`uv run pytest`を実行し170件pass）。ただし将来monkeypatchを使わないテストが追加された場合に無認証で失敗する事態を避けるため、`test`ジョブに`env: API_KEY: ci-test-api-key`を保険として明示した（`DATABASE_URL`は未設定＝`app/database.py`のデフォルト`sqlite:///./app.db`にフォールバックするが、テストは全て`get_db`オーバーライドで独自の一時ファイルDBを使うため実質参照されない）。
  - **Dockerfile（マルチステージ、ベースイメージ: `python:3.12-slim`）**: builderステージで`ghcr.io/astral-sh/uv:0.12.1`イメージから`uv`バイナリのみを`COPY --from`し、`pyproject.toml`・`uv.lock`を先にコピーして`uv sync --locked --no-install-project --no-dev`を実行後にアプリコードをコピーして`uv sync --locked --no-dev`する2段構成にした（依存関係定義のみ先にコピーすることで、アプリコードだけを変更した際に依存関係インストールのDockerレイヤーキャッシュが再利用され、ビルドが速くなる一般的な最適化パターン）。実行ステージは素の`python:3.12-slim`に`.venv`とアプリコードのみをコピーし、`uv`本体やビルドツール類を含まない最小構成にした。`CMD`は`uvicorn app.main:app --host 0.0.0.0 --port 8000`。ベースイメージに`python:3.12-slim`を選んだ理由は、`pyproject.toml`の`requires-python`と一致するPython 3.12系であり、`alpine`系（musl libc）よりSQLAlchemy等のC拡張ビルド済みwheelとの互換性が高くビルドが安定するため。
  - **`.dockerignore`**: `.venv`・`.git`・`.github`・`__pycache__`・`*.db`／`*.sqlite3`・`.env`・`tests`・`.claude`等、実行イメージに不要またはビルドコンテキスト送信を無駄に増やすものを除外。開発用DBファイル（`app.db`）がイメージに紛れ込まないことも兼ねる。
  - **buildジョブ**: `docker/setup-buildx-action@v3` + `docker/build-push-action@v6`で`push: false`を明示し、実際のレジストリへのpushは行わずビルドの成否のみを検証する構成にした。デプロイ先（レジストリ・ホスティング環境）は本タスクの対象外（決定事項セクション参照）のため、`deploy`ジョブ自体を作成していない。
  - **手元での検証**: Dockerが利用可能な環境だったため、`docker build -t project-tracker-api:local-check .`を実際に実行しビルド成功（マルチステージの両ステージとも正常に完了）を確認した。さらに`docker run`でコンテナを起動し、`curl -H "X-API-Key: ..." http://localhost:18000/projects`が200を返すこと（アプリが実際に起動しエンドポイントが応答すること）も確認した上でコンテナ・イメージを削除済み。GitHub Actions自体はこの場では実行できないため、YAMLの構文・ジョブ依存関係（`needs`）・ステップ内容の妥当性のレビューにとどめている。
  - ローカルで`uv run ruff check .`（`All checks passed!`）・`uv run pytest`（170 passed）を再実行し、ワークフローが呼び出すコマンドがそのまま成功することを確認済み。
  - **【追記】非rootユーザー実行への対応（セキュリティエバリュエーターのMedium指摘への追加修正）**: 実行ステージに`RUN useradd --create-home --shell /usr/sbin/nologin appuser`で非特権ユーザーを作成し、`USER appuser`でuvicornプロセスの実行ユーザーを切り替えた（コンテナエスケープ等が発生した場合の被害範囲を狭める多層防御目的）。`.venv`・`app`ディレクトリは所有者がroot（`COPY --from=builder`のデフォルト）のままだが、読み取り・実行権限は元々世界（other）に対して付与されているため`appuser`でも問題なく参照・実行できることを確認した。一方でデフォルトの`DATABASE_URL`（`sqlite:///./app.db`）はWORKDIR（`/app`）直下にSQLiteファイルを新規作成する必要があり、`/app`自体はroot所有のまま書き込み権限が無かったため`appuser`起動時に`unable to open database file`で起動失敗した。そのため`RUN chown appuser:appuser /app`を追加し、`/app`ディレクトリ自体の所有者のみ`appuser`に変更した（`.venv`・`app`配下は所有者そのままで読み取り・実行権限のみで足りるため変更していない）。修正後、`docker build`でビルド成功、`docker run`でコンテナ起動、`docker exec <container> whoami`／`cat /proc/1/status`のUidでPID 1（uvicornプロセス）が`appuser`（UID 1000、root=UID 0ではない）で動作していること、`curl`でAPIが200を返すことを確認した上でイメージ・コンテナを削除済み。`uv run pytest`（170 passed）も再実行し、Dockerfileの変更がアプリケーションコード・テストに影響しないことを確認済み。
  - **【追記2】DBディレクトリ分離によるHigh指摘の解消（セキュリティエバリュエーターの実機検証によるHigh指摘への修正）**: 追記1の`RUN chown appuser:appuser /app`は`/app`ディレクトリ全体を`appuser`書き込み可能にしてしまい、アプリケーションコード（`/app/app/*.py`）自体も`appuser`から書き込める状態だった。これにより、仮に任意ファイル書き込みが可能な脆弱性が生じた場合、攻撃者が`/app`直下に本物のライブラリ名を偽装したファイル（例: `fastapi.py`）を設置すると、uvicornのモジュール解決順序上それが本物より優先して読み込まれ、コンテナ再起動後も`appuser`権限で任意コードが実行され続けるHigh相当のリスクがあった。対応として、`RUN chown appuser:appuser /app`を廃止し、代わりに`RUN mkdir -p /app/data && chown appuser:appuser /app/data`でSQLiteファイル専用のディレクトリ（`/app/data`）のみを作成・`appuser`所有にした。`/app`・`/app/app`・`/app/.venv`は`COPY --from=builder`直後のroot所有のまま変更せず、`appuser`からは読み取り・実行のみ可能（書き込み不可）とした。あわせて、デフォルトの`DATABASE_URL`（`app/database.py`側の`sqlite:///./app.db`というデフォルト値自体は変更せず）をコンテナ内でのみ`ENV DATABASE_URL="sqlite:////app/data/app.db"`で上書きし、SQLiteファイルが`/app/data`配下に作成されるようにした。修正後、`docker build`でビルド成功を確認し、`docker run`でコンテナを起動して以下を実機検証した: (1) `POST /projects`で案件作成→`GET /projects`で取得でき、DBの書き込み・読み込みが機能していること（`X-API-Key`ヘッダ付きでいずれもレスポンス確認済み）、(2) `docker exec`で`/app`直下・`/app/app`配下（例: `fastapi.py`という偽装ファイル名）への書き込みがいずれも`Permission denied`で失敗すること、(3) `/app/.venv`への書き込みも`Permission denied`で失敗すること、(4) `/app/data`配下への書き込みは成功すること、(5) `docker exec ... id`で実行ユーザーが引き続き`appuser`（UID 1000、非root）であることを確認した上でイメージ・コンテナは削除済み。`uv run pytest`（170 passed）・`uv run ruff check`（`All checks passed!`）も再実行し、Dockerfile以外の変更が無いこと・既存のテスト結果に影響が無いことを確認済み。
- セキュリティエバリュエーターのフィードバック:
  - 【総評】Critical/High相当の問題は無し。合格（性能評価待ちへ進める）。ただしMedium/Low相当の改善提案が2件あるため記録する。
  - 【GitHub Actionsワークフロー（`.github/workflows/ci.yml`）】
    - シークレットの平文ログ出力: `secrets.*`の参照は本ファイルに一切無く、`test`ジョブの`env: API_KEY: ci-test-api-key`もテスト用のダミー文字列（実装メモの通り`monkeypatch`でテスト側が上書きするための保険であり実在のAPIキーではない）。実際のAPIキーやDB接続情報を参照・出力する箇所は無いことをソースで確認した。
    - `pull_request`トリガーでのfork PR権限昇格リスク: 本ワークフローはシークレットを一切使用しておらず、`build`ジョブも`push: false`でレジストリへの書き込みを行わないため、`pull_request`イベント（`pull_request_target`ではない）でforkからのPRが実行されても、盗用可能なシークレットや書き込み権限のあるトークンの悪用余地は無いことを確認した。
    - サードパーティActionのバージョン固定: `actions/checkout@v4`・`astral-sh/setup-uv@v4`・`docker/setup-buildx-action@v3`・`docker/build-push-action@v6`は全てメジャーバージョンのタグ参照であり、コミットSHA固定ではない。タグは書き換え可能なため厳密なサプライチェーン対策としてはSHA固定が望ましいが、いずれも著名で広く使われているActionであり、本ワークフローがシークレットを扱わずpushもしない（上記の通り被害範囲が限定的）ことを踏まえるとLow相当の改善余地として記録するに留める（Critical/Highには該当しない）。
    - 【Medium/Low】`permissions`ブロックが未設定: ワークフロー全体・各ジョブいずれにも`permissions:`の明示指定が無く、リポジトリのデフォルト設定に依存する形になっている。本ワークフローは`checkout`・依存関係インストール・pytest・Dockerビルド（push無し）のみで、コードのpush・PRコメント・パッケージ公開等`GITHUB_TOKEN`の書き込み権限を必要とする操作は行っていないため、`permissions: contents: read`のような最小権限を明示するのが望ましい（サードパーティAction経由のサプライチェーン攻撃が発生した場合の被害範囲を狭める防御多層化の観点）。ただしリポジトリ側のデフォルト設定次第では実害が生じるとは限らずMedium/Low相当であり、Critical/Highではないため差し戻しの対象にはしない。
  - 【Dockerfile】
    - ベースイメージ: `python:3.12-slim`（builder・実行イメージ両方）を採用しており、`pyproject.toml`の`requires-python = ">=3.12"`・`.python-version`（3.12）と整合。alpine系より若干イメージサイズは大きいが実装メモの通りC拡張wheel互換性を優先した判断であり妥当。
    - 不要ファイルの混入: `.dockerignore`で`.venv`・`.git`・`.github`・`.pytest_cache`・`.ruff_cache`・`__pycache__`・`*.py[oc]`・`*.db`・`*.sqlite3`・`.env`・`tests`・`spec.md`・`README.md`・`.claude`を除外しており、開発用DBファイル（`app.db`）・`.env`・テストコード・Git履歴が実行イメージ／ビルドコンテキストに含まれないことを確認した。Dockerfile自体も実行イメージ（`FROM python:3.12-slim`以降）に`COPY --from=builder /app/.venv`・`COPY --from=builder /app/app`の2つのみをコピーしており、`pyproject.toml`・`uv.lock`・`tests`等はコピーされていないことをソースで確認した。
    - マルチステージビルドとビルド専用依存関係の残留: builderステージでコピーした`uv`/`uvx`バイナリは実行イメージ（`FROM python:3.12-slim`以降、`COPY --from=builder`は`.venv`と`app`のみ）には含まれておらず、`RUN uv sync`によりインストールされる各種パッケージの実体は`.venv`配下のみであることを確認した。`apt-get install`等でコンパイラ（gcc等）を追加導入している箇所も無く、素の`python:3.12-slim`に含まれる範囲を超えるビルドツールが最終イメージに残る実装にはなっていない。
    - 【Medium】非rootユーザー実行: Dockerfileに`USER`命令が無く、`FROM python:3.12-slim`のデフォルトユーザー（root）のままアプリケーションプロセス（`uvicorn`）が実行される構成になっている。本人専用ツールでインターネット直接公開を前提としていない点は考慮するが、コンテナ内で万一RCE等が発生した場合の被害範囲を狭める多層防御の観点からは、非rootユーザー（例: `RUN useradd`等で作成した専用ユーザーへ`USER`で切り替え）での実行が本番相当のベストプラクティスとして望ましい。ただし受け入れ条件（lint/test失敗時の停止・マルチステージビルド成功・実デプロイステップ非包含）はいずれも満たされており、この指摘はCritical/Highには該当しないため差し戻しの対象にはしない。
    - 実デプロイステップの不在: `docker push`やレジストリ認証、実際のホスティング環境へのデプロイコマンドは`ci.yml`・Dockerfileいずれにも存在しないことを確認した（`build`ジョブは`docker/build-push-action@v6`に`push: false`を明示しており、ビルド成否の検証のみ）。受け入れ条件5「実デプロイのステップは含まれない」を満たしている。
  - 【シークレット管理】リポジトリ全体を確認したが、`.env`ファイルは存在せず（`find`で未検出）、APIキーやDB接続文字列のハードコードも`ci.yml`・Dockerfile・`.dockerignore`のいずれにも見当たらない。`.gitignore`に`.env`が含まれておりコミット対象からも除外されている。
  - 【結論】Critical/High相当の問題は無いため、statusを「性能評価待ち」に更新する。上記Medium 2件（非rootユーザー未実装、`permissions`未明示）・Low 1件（Action未SHA固定）は今回の差し戻し対象にはしないが、将来の改善候補として記録する。
- 性能エバリュエーターのフィードバック:
  - 【総評】合格。受け入れ条件5件全てを確認し、いずれも満たしていることを確認した。statusを「完了」に更新する。
  - 本タスクは通常のAPIエンドポイントと異なりpytestでの受け入れ条件検証が主目的ではないため、指示に従い各条件をYAML静的レビュー・実際のdocker build/run・既存pytestスイート全体の再実行で確認した。
  - 【トリガー】`ci.yml`の`on:`に`push:`・`pull_request:`が両方定義されており（ブランチフィルタなし＝全ブランチ対象）、「コードのpushまたはpull request作成時にワークフローが自動実行される」を満たす。
  - 【lintジョブ】`uv run ruff check .`を実行するのみで`continue-on-error`等の失敗握りつぶし設定は無く、ruffはlint違反があれば非ゼロ終了する標準的な挙動のため、ジョブ失敗としてワークフロー全体が停止する（`test`ジョブが`needs: lint`のため）。手元で`uv run ruff check`を再実行し`All checks passed!`（違反ゼロ）を確認済み。
  - 【testジョブ】`uv run pytest`を実行するのみで同様に失敗握りつぶし設定は無く、pytestはテスト失敗時に非ゼロ終了するため、ジョブ失敗としてワークフローが停止する（`build`ジョブが`needs: test`のため、テスト失敗時はビルドまで到達しない）。`lint→test→build`の`needs`直列依存も妥当。
  - 【Dockerビルド】Dockerが利用可能な環境だったため実際に検証した。
    - `docker build --no-cache -t project-tracker-api:perf-check .`を実行し、builder/実行ステージ両方とも約21秒で正常完了（ビルドキャッシュを`docker builder prune -f`で明示的にクリアした上でのクリーンビルドで確認）。
    - `docker run`でコンテナを起動し、`curl -H "X-API-Key: ..." http://localhost:18001/projects`が200を返すこと（uvicornが実際に起動しFastAPIアプリが応答すること）を確認。ログにも`Application startup complete`・`GET /projects HTTP/1.1 200 OK`を確認。
    - 検証後、コンテナ・イメージ（`project-tracker-api:perf-check`）は削除済み。
    - `ci.yml`の`build`ジョブ（`docker/setup-buildx-action@v3` + `docker/build-push-action@v6`、`push: false`）もこの実際のビルド結果と整合する構成であることを静的に確認した。
  - 【実デプロイステップの不在】`ci.yml`全体を確認したが`docker push`・レジストリ認証・実環境への接続コマンドは存在せず、`build`ジョブは`push: false`を明示している。`deploy`ジョブ自体が定義されていないことも確認。受け入れ条件を満たす。
  - 【回帰確認】`uv run pytest -v`（プロジェクト全体）を実行し170件全てpass、warningの出力は0件（`warnings summary`ブロック自体が出力されていないことを確認）。「warningが1件でも出たら差し戻す」ルールに抵触する事象なし。
  - 【付随確認】`ci.yml`・Dockerfileで固定されている`uv`バージョン（0.12.1）が手元の実行環境の`uv --version`（0.12.1）と一致していることを確認し、CI/ローカル/コンテナビルド間のバージョン不整合リスクが無いことを確認した。
  - 【非対象（セキュリティ観点）】非rootユーザー未実装・`permissions`未明示・Action未SHA固定はセキュリティエバリュエーターの指摘済み事項であり、いずれもMedium/Low相当で受け入れ条件外のため本評価では差し戻し対象にしていない（記録のみ）。
- 差し戻し回数: 0
- 【追記】非root化修正（`RUN chown appuser:appuser /app`追加）に対する再レビュー:
  - status: 完了のまま変更しない（受け入れ条件5件は元々満たされているため）。ただし**High相当の問題を1件検出**したため、修正が必要である旨をここに明記する。generatorへの差し戻しはユーザー判断待ちとし、本レビューでは差し戻し回数・statusは更新しない。
  - 【High】`chown appuser:appuser /app`（`-R`無し・`/app`のみ）により、`/app`ディレクトリ自体の所有者・書き込み権限がappuserに移る。これにより`/app/app`（アプリコード）・`/app/.venv`配下は引き続きroot所有で直接上書きはできないが、**`/app`直下に任意の新規ファイルを作成できてしまう**。そして実際のCMD（`uvicorn app.main:app --host 0.0.0.0 --port 8000`）は`--app-dir`未指定のためuvicorn側のデフォルト（`click`の`--app-dir`オプションのデフォルト値は`""`であり`None`ではないため、`uvicorn/main.py`の`if app_dir is not None: sys.path.insert(0, app_dir)`が真になり、空文字列＝カレントディレクトリ（`/app`）が`sys.path`の**先頭（index 0、`.venv/site-packages`より優先）**に挿入される）という実装により、`/app`は事実上`sys.path[0]`として扱われる。
    - **実機で検証・再現済み**: 実際にビルドした本リポジトリのDockerfileのイメージを`docker run`し、`appuser`権限で`/app/app/main.py`の直接上書き（`Permission denied`）および`/app/app`ディレクトリごとの入れ替え（`os.rename`、overlay2の`redirect_dir`制限により`Invalid cross-device link`＝EXDEVで失敗）はブロックされることを確認した。**しかしこれらのブロックはoverlay2ストレージドライバの内部挙動（下位レイヤー由来のディレクトリはredirect_dir無効時にrename不可というEXDEV制限）に偶然依存しているだけであり、Dockerfile側で意図的に設計された保護ではない**（`btrfs`/`zfs`/`devicemapper`/`vfs`等の別ストレージドライバや、イメージのsquash/flatten（`docker build --squash`、`docker export`/`import`等）を行った場合はこのEXDEV制限が働かず、`app/`ディレクトリの入れ替え自体も可能になり得る）。
    - 一方、`/app`直下への**新規ファイル作成は制限なく成功**することを実機で確認した（例: `/app/evil.py`、`/app/fastapi.py`をappuser権限で作成成功）。さらに、`sys.path.insert(0, '/app')`後に`import app.main`と同等の手順を実機で再現したところ、`/app`に設置した偽の`fastapi.py`（本来`.venv/site-packages/fastapi`を参照すべきimportをシャドーイングする悪意あるファイル）が**実際に`.venv`側の本物より優先して実行される**ことを確認した（PoC: `/app/fastapi.py`に`print("!!! SHADOW EXECUTED !!!"); raise SystemExit(0)`を仕込み、`app.main`import時にこのコードが実行されることを確認）。
    - さらに`docker restart`（コンテナを作り直さず同一コンテナを再起動するケース。`--restart=on-failure`/`--restart=always`運用時にプロセスクラッシュ等で発生する一般的なシナリオ）を実機で行い、appuserが設置したファイルが再起動後も書き込み層に残存する（消えない）ことを確認した。
    - **攻撃シナリオ**: アプリに何らかの理由でRCEどころか「任意ファイル書き込み」の脆弱性が生じた場合（RCEより弱い脆弱性で十分）、攻撃者は`/app`直下に依存パッケージ名と同名のPythonファイル（例: `fastapi.py`、`sqlalchemy.py`、`pydantic.py`等、`app/main.py`や配下モジュールがimportしている名前）を設置しておくだけで、次回のプロセス／コンテナ再起動時にuvicornの起動シーケンス内で自分のコードが（appuser権限で）実行される永続的なバックドアを仕込める。これは「非root化によりコード改ざん耐性を高める」という当初の多層防御の意図を、`chown /app`（非再帰だが親ディレクトリ全体が対象）によって実質的に破ってしまっている。
  - 【代替案の検討（タスク側で提案されていた案は技術的に有効）】`chown`の対象をSQLiteファイル専用のサブディレクトリ（例: `/app/data`）のみに限定し、`/app`自体・`/app/app`・`/app/.venv`はroot所有のまま維持する方式に変更すれば、この問題は解消できる。具体的には:
    - Dockerfile側で`RUN mkdir -p /app/data && chown appuser:appuser /app/data`のように書き込みが必要な範囲だけをappuser所有にする。
    - `DATABASE_URL`のデフォルト値（`sqlite:///./app.db`、`app/database.py`側の実装）を`sqlite:////app/data/app.db`のような専用ディレクトリ配下に変更する（もしくは環境変数で本番は明示的に指定する）必要があり、これは**Dockerfileだけでなくアプリケーションコード側`app/database.py`のデフォルト値、または実行時の`ENV DATABASE_URL=...`設定の変更を伴う**ため、今回の「Dockerfileのみの変更」というタスク範囲を超える可能性がある点に注意（generatorが対応する際はどちらの方式にするかユーザー確認が望ましい）。
    - こうすることで`/app`・`/app/app`はroot所有・appuserは読み取り専用のままになり、`sys.path[0]`（`/app`）への書き込みができなくなるため、上記のimportシャドーイング攻撃は成立しなくなる。
  - 【結論】Critical/High相当（High）の問題ありと判断する。受け入れ条件（lint/test失敗時停止・マルチステージビルド成功・実デプロイ非包含）自体はDockerfile変更後も引き続き満たされているためstatusを「完了」から後退させる必然性は低いが、コード改ざん耐性という当初の非root化の目的が`chown /app`によって実質的に無効化されている点はセキュリティ上看過できないため、ユーザー判断でgeneratorへの修正差し戻し（例:「修正待ち」に戻す）を強く推奨する。
- 【追記2】DBディレクトリ分離修正（`chown /app` → `mkdir -p /app/data && chown appuser:appuser /app/data`、`ENV DATABASE_URL="sqlite:////app/data/app.db"`）に対する再レビュー（独立した実機再検証）:
  - status: 完了のまま変更しない。**上記Highの指摘は本修正により解消されたことを実機で確認した。**新規の問題は検出されなかった。
  - 【検証環境】generatorの報告を鵜呑みにせず、本エバリュエーター自身が`docker build -t security-recheck:latest .`でリポジトリの現行Dockerfileから独立してイメージをビルドし（ビルド成功）、`docker run`でコンテナを起動して以下を実機で再現・検証した（`docker info`のStorage Driverは`overlayfs`で、前回のHigh指摘時と同じ実行環境）。検証後はコンテナ・イメージともに削除済み。
  - 【権限構成の確認】`docker exec ... ls -la /app`で`/app`・`/app/.venv`・`/app/app`がいずれも`root:root`・パーミッション`755`（other書き込み不可）のままであり、`/app/data`のみ`appuser:appuser`になっていることをソースではなく実際のコンテナ内で確認した。
  - 【書き込み試行（appuser権限、`docker exec`）】以下を実際に試行し、いずれも狙い通りの結果になることを確認した。
    - `/app/evil.py`・`/app`直下への依存パッケージ偽装ファイル`/app/fastapi.py`の新規作成 → いずれも`Permission denied`で失敗（前回Highの核心だった「`/app`直下への新規ファイル作成」が今回は完全にブロックされることを確認）。
    - `/app/app/main.py`の上書き、`/app/app/newfile.py`の新規作成 → いずれも`Permission denied`。
    - `/app/.venv/pyvenv.cfg`の上書き → `Permission denied`。
    - `/app/app`ディレクトリ自体のrename（`mv /app/app /app/app_old`）→ `Permission denied`（前回はEXDEV=overlay2偶然依存でブロックされていたが、今回はディレクトリ自体がroot所有のため権限エラーで正規にブロックされることを確認）。
    - `/app/data/testfile`への書き込み → 成功（DB用ディレクトリとしての書き込み可能性は維持されている）。
    - 網羅性確認として`find /app -writable`（appuser権限、`/app/data`除く）を実行し、ヒットしたのは`/app/.venv/.lock`（uvが仮想環境の同時操作を防ぐために作成する空のアドバイザリロックファイル、パーミッション`0666`）1件のみであることを確認した。この`.lock`ファイルはPythonの`import`機構が読み込み・実行する対象ではなく（`.py`ファイルではなく、`sys.path`上のモジュールとしても解決されない）、`app/main.py`等のimportシャドーイングには利用できないため、前回指摘の攻撃シナリオへの再現性は無いと判断した（既存の`uv sync`が生成する副産物であり、今回のDockerfile修正で新たに生じたものでもない）。念のためLow/informationalとして記録するに留め、差し戻し対象にはしない。
  - 【importシャドーイング攻撃の再現不可を確認】前回の実機PoC（`sys.path.insert(0, '/app')`後に偽の`fastapi.py`が本物より優先実行される）の前提となる「`/app`直下への新規ファイル作成」自体がappuser権限では成功しなくなったため、同じ手口でのPoCは実行するまでもなく成立しないことを確認した（書き込みが`Permission denied`で拒否される時点で、シャドーイング対象ファイルを設置すること自体が不可能）。
  - 【`docker restart`後の永続化を試みても失敗することを確認】`touch /app/persist_test`を試行→`Permission denied`（作成失敗）、その状態で`docker restart`を実行→再起動後もappuser権限のまま・アプリは正常起動・当該ファイルは存在しない（そもそも作成できていない）ことを確認した。
  - 【機能面（DB書き込み・読み込み）の独立確認】`docker exec ... env`で`DATABASE_URL=sqlite:////app/data/app.db`になっていることを確認した上で、`X-API-Key`ヘッダ付きで`POST /projects`（201、実際のリクエストボディはProjectCreateスキーマの必須フィールド`name`/`client_name`/`reward`/`applied_date`/`status`（日本語Enum値）に合わせて送信）→`GET /projects`（200、作成したレコードが返る）を実行し、DBの読み書きが正常に機能することを確認した。また`ls /app/*.db`が存在しないこと（`/app`直下にフォールバックのSQLiteファイルが作られていないこと）・`/app/data/app.db`が実際に生成されていることも確認した。`docker restart`後もAPIは200を返し続け、作成済みレコードが保持されていることも確認した。
  - 【結論】前回検出したHigh（`chown /app`によるコード改ざん耐性の実質無効化）は、DBファイル専用ディレクトリ`/app/data`のみをappuser所有にする方式への変更により解消されたことを、generatorの報告に依らず本エバリュエーター自身の独立した実機検証（ビルド・書き込み試行・API動作確認・restart後の永続化試行）で確認した。他にCritical/High相当の新規問題は検出しなかった（Low: `.venv/.lock`が世界書き込み可能だが、Python importの対象にならないため悪用不可、記録のみ）。statusは「完了」のまま維持する。

### タスク: ソースコードのbackend/・frontend/への再編
- status: 完了
- 概要: フロントエンドを同一リポジトリに追加するのに先立ち、バックエンドのソースコード（アプリ本体とテスト）を `backend/` 配下へ移し、リポジトリのレイアウトをバックエンド／フロントエンドの2本立てに整える。設定ファイル類はリポジトリルートに残し、`frontend/` の中身は後続の基盤セットアップタスクで作成する。以降のフロントエンド関連タスクより前に実施する。
- 前提（確定済みの方針、再検討しない）:
  - 移動対象はソースコードのみ（アプリ本体とテスト一式）。移動先は `backend/` 配下で、それぞれの内部構成は変えない。
  - 依存関係定義・ロックファイル・コンテナビルド定義とその除外設定・CIワークフロー定義・README・spec.md・Pythonバージョン指定・Git除外設定はリポジトリルートに残す。
  - コンテナ内でのアプリ配置、DBファイルの配置、非rootユーザー実行、書き込み権限の分離に関する既存タスクの決定は変更しない。
- 受け入れ条件:
  - [x] アプリ本体とテストが `backend/` 配下に移動しており、リポジトリルート直下には残っていない
  - [x] 設定ファイル類（依存関係定義・ロックファイル・コンテナビルド定義とその除外設定・CIワークフロー定義・README・spec.md・Pythonバージョン指定・Git除外設定）はリポジトリルートに残っている
  - [x] 移動はバージョン管理上ファイルの移動として履歴を追える形で行われており、再編に伴うパスの追従以外にファイルの中身が変更されていない
  - [x] 新レイアウトのままテストスイート全件がパスする（テストの探索先とimportの解決が新レイアウトで正しく機能している）
  - [x] 新レイアウトのままlintが通り、対象範囲から移動後のソースが漏れていない
  - [x] コンテナイメージのビルドが成功し、起動したコンテナのAPIが認証付きリクエストに対して従来どおり応答する
  - [x] コンテナ内でのアプリ配置・DBファイル配置・実行ユーザー・書き込み権限が再編前と同じ状態を保っている
  - [x] CIワークフローが新レイアウトのソースを対象にlint・test・buildを実行する定義になっている
  - [x] README等のドキュメント内のパス記述が新レイアウトと矛盾しない
  - [x] 認証・論理削除・ステータス遷移警告など既存タスクの受け入れ条件に挙げた挙動が再編後も変わらない
- 実装メモ（技術判断とその理由）:
  - **移動方法（`git mv`）**: `git mv app backend/app`・`git mv tests backend/tests`で移動した。`git status`上は全23ファイルが`R`（rename、内容変更なし）として記録されており、バージョン管理上「移動」として履歴を追える。移動対象ファイルの中身は1行も変更していない（`app/`配下は`app.`始まりのimportのみで相対パス依存が無く、`tests/`配下も`from app import ...`形式のためimport文の書き換えは不要だった）。ルート直下に残したのは`pyproject.toml`・`uv.lock`・`Dockerfile`・`.dockerignore`・`.github/workflows/ci.yml`・`README.md`・`spec.md`・`.python-version`・`.gitignore`（＋gitignore対象の`app.db`・`.venv`等）。
  - **pytestのパス追従（`pyproject.toml`）**: `pythonpath = ["."]` → `["backend"]`、`testpaths = ["tests"]` → `["backend/tests"]`に変更した。ルートから`uv run pytest`を実行するという既存の運用（CIの`run: uv run pytest`もそのまま）を変えずに、`backend`をsys.pathに載せることで`from app import ...`のimport解決を従来どおり成立させる方式を選んだ（各テストファイルのimport文を書き換えずに済み、「中身を変更しない」という受け入れ条件と両立するため）。
  - **ruffのパス追従（`pyproject.toml`）**: lint対象は`uv run ruff check .`（ルート起点の再帰探索）のままで移動後のソースを自動的に含むため、コマンド・CI定義の変更は不要。ただしisort（`I`ルール）のファーストパーティ判定基準がデフォルトでプロジェクトルートのため、`src = ["backend"]`を追加して`app`パッケージが引き続きファーストパーティとして扱われるようにした。実際に`uv run ruff check . --show-files`で、移動後の`backend/app/*.py`13件・`backend/tests/*.py`9件が全てlint対象に含まれている（漏れが無い）ことを確認済み。
  - **Dockerfileのパス追従**: builderステージの`COPY app ./app` → `COPY backend/app ./app`の1行のみ変更した。ビルドコンテキストはリポジトリルートのまま（CIの`context: .`も変更不要）で、**コンテナ内の配置は従来どおり`/app/app`**になるため、`CMD ["uvicorn", "app.main:app", ...]`・`WORKDIR /app`・`ENV DATABASE_URL="sqlite:////app/data/app.db"`・非rootユーザー（`appuser`）・`/app/data`のみ書き込み可という既存タスクの決定は一切変更していない。
  - **`.dockerignore`のパス追従**: `tests` → `backend/tests`に変更した（`.dockerignore`のパターンはコンテキストルート基準のマッチのため、移動後は`tests`のままではテストコードの除外が効かなくなる）。他のエントリ（`.venv`・`.git`・`.github`・`*.db`・`.env`・`spec.md`・`README.md`・`.claude`等）は従来どおり。
  - **CIワークフロー**: `lint`は`uv run ruff check .`（ルート再帰探索で`backend/`を含む）、`test`は`uv run pytest`（`testpaths = ["backend/tests"]`が効く）、`build`は`context: .`（Dockerfileが`backend/app`をコピー）で、いずれも新レイアウトのソースを対象に動作するため機能的な変更は不要だった。唯一、`test`ジョブの`API_KEY`に付したコメント内のパス記述を`tests/` → `backend/tests/`に更新した（記述の正確性のための追従のみ）。
  - **ドキュメントのパス記述**: `README.md`は現時点で空ファイル（0バイト）であり、新レイアウトと矛盾するパス記述は存在しないため変更していない（レイアウト説明の新規追記は本タスクのスコープ外と判断）。`spec.md`内の`app/...`・`tests/...`という記述は全て過去タスクの実装メモ・エバリュエーターのフィードバック（実施時点の記録）であり、書き換えると履歴の記録としての正確性が損なわれるため意図的に変更していない。以降の記述は`backend/app/...`・`backend/tests/...`を用いる。
  - **docker実機確認（ビルド〜API疎通〜権限）**: `docker build -t project-tracker-api:reorg-check .`でビルド成功。`docker run -e API_KEY=... -p 18002:8000`で起動し、以下を実機で確認した上でコンテナ・イメージとも削除済み。
    - 認証: `X-API-Key`なしの`GET /projects`は401、正しいキー付きは200。
    - 既存挙動の回帰: `POST /projects`が201、`PATCH`で順行遷移（提案中→契約中）は`warning: null`、逆行遷移（契約中→提案中）は200＋`warning: "契約中 から 提案中 への変更です。..."`、`DELETE`が204でその後の`GET /projects`から除外される（論理削除）ことを確認。
    - コンテナ内配置: `/app/app`（アプリコード）・`/app/.venv`・`/app/data`のみが存在し、`/app/tests`・`/app/backend`は存在しない（テストコードは`.dockerignore`で除外されたまま）。`DATABASE_URL=sqlite:////app/data/app.db`で`/app/data/app.db`が実際に生成されている。
    - 実行ユーザー: `id`＝`uid=1000(appuser)`、`/proc/1/status`のNameが`uvicorn`・Uidが1000（非root）。
    - 書き込み権限の分離: `/app`・`/app/app`・`/app/.venv`は`root:root` 755のままで、`/app/evil.py`・`/app/fastapi.py`・`/app/app/evil.py`・`/app/.venv/evil.py`への書き込みはいずれも`Permission denied`。`/app/data`配下のみ書き込み成功。`find /app -writable`（`/app/data`除く）のヒットは`/app/.venv/.lock`のみで、これは再編前のセキュリティ再レビュー（【追記2】）時点と同一の状態。
  - **セルフチェック**: `uv run pytest` 170件全passでwarning 0件（`warnings summary`セクションの出力なし）、`uv run ruff check .`は`All checks passed!`。
- セキュリティエバリュエーターのフィードバック:
  - **結論: 合格（Critical/High該当なし）。statusを「性能評価待ち」に更新、差し戻し回数は0のまま。**
  - 【変更範囲の独立検証】`git status`/`git diff --cached -M --stat`で、移動23ファイルが全て`R`（rename）かつ`0 insertions(+), 0 deletions(-)`＝内容無変更であることを確認した。内容変更があったのは`.dockerignore`（`tests`→`backend/tests`の1行）、`Dockerfile`（`COPY app ./app`→`COPY backend/app ./app`の1行）、`pyproject.toml`（`pythonpath`/`testpaths`/`[tool.ruff] src`）、`.github/workflows/ci.yml`（コメント1行のみ）の4ファイルで、いずれも報告どおりパス追従の範囲に収まっている。アプリコードが1行も変わっていない以上、認証・論理削除・ステータス遷移警告等の既存挙動に劣化を生む余地は無い（実機でも後述のとおり再確認済み）。
  - 【認証・論理削除の再確認】`backend/app/main.py`で`verify_api_key`が`FastAPI(dependencies=[...])`のグローバル依存関係として維持され、`docs_url`/`redoc_url`/`openapi_url`は`None`のまま。`backend/app/auth.py`は`secrets.compare_digest`による定数時間比較＋環境変数未設定時fail closedのまま。routers配下の全GET/一覧クエリに`is_deleted.is_(False)`フィルタが残り、DELETE系は全て`is_deleted = True`（物理削除・`DELETE FROM`・生SQL文字列結合・`text()`/`execute()`の使用は`grep`で0件）。ハードコードされたAPIキー/DB認証情報、ユーザー入力のログ出力・外部コマンド渡しも0件。
  - 【実機検証（本エバリュエーター自身が実施）】`docker build`でイメージを生成し、`-e API_KEY=... -p 18123:8000`で起動して確認した（検証後にコンテナ・イメージとも削除済み）。
    - 認証: キー無し`GET /projects`＝401、誤キー＝401（レスポンスは`{"detail":"Invalid or missing API Key"}`のみでスタックトレース・内部パス・SQL文字列の漏洩なし）、正キー＝200。`/docs`・`/openapi.json`は404のまま。
    - コンテナ内配置・権限: 実行ユーザーは`uid=1000(appuser)`、`/app`・`/app/app`・`/app/.venv`は`root:root`のままで`touch`は全て`Permission denied`、書き込み可能なのは`appuser:appuser`所有の`/app/data`のみ。`DATABASE_URL=sqlite:////app/data/app.db`で`/app/data/app.db`が生成され、`/app`直下にDBファイルは作られない。既存タスクの「非root実行・書き込み権限の分離・DB配置」の決定は崩れていない。
    - イメージ内容: `/app`直下は`.venv`・`app`・`data`のみ。テストコード（`test_*`）・`.env`・`*.db`・`.git`・`.venv`（ホスト側）等の混入は無し。
    - lint/test: 新レイアウトのまま`uv run pytest`＝170 passed（warning 0件）、`uv run ruff check .`＝All checks passed。CIの`lint`（`ruff check .`のルート再帰探索）・`test`（`testpaths = ["backend/tests"]`）・`build`（`context: .`＋`COPY backend/app`）はいずれも新レイアウトのソースを実際に対象にしており、パスの取りこぼしによる「素通り」は無い。
    - `pythonpath = ["backend"]`の副作用: `backend/`配下は`app`・`tests`のみで、リポジトリルート（`spec.md`・`app.db`等）はimportパスから外れる方向の変更であり、意図しないディレクトリがimportパスに入る問題は無い。
  - 【Low（今回の変更が原因ではない既存事象。修正は任意、次タスク以降で検討推奨）】`.dockerignore`のパターンはコンテキストルート基準のアンカー付きマッチであり、`__pycache__`・`*.py[oc]`は**ネストしたディレクトリには効かない**。そのため`COPY backend/app ./app`によりホスト側の`backend/app/__pycache__/*.pyc`・`backend/app/routers/__pycache__/*.pyc`がイメージ内`/app/app`に取り込まれることを実機で確認した（最小再現コンテキストでの検証により、再編前の`app/__pycache__`でも同じく取り込まれていた＝本タスクによる劣化ではないことも確認済み）。影響はイメージ肥大化とローカルビルドの再現性低下に留まり（CIはcheckout直後で`__pycache__`が存在しないため清浄、また`.pyc`は`.py`のmtime/sizeで無効化されるため古いバイトコードの実行も起きない）、機密漏洩には至らないためLow判定。修正するなら`**/__pycache__`・`**/*.py[oc]`のように`**/`付きパターンにするのが適切。
  - 【Info（将来向け）】同じアンカー仕様のため、後続の`frontend/`追加時に`node_modules`や`frontend/.env*`がビルドコンテキストへ入り得る。フロントエンド基盤セットアップタスクで`.dockerignore`（および必要なら`frontend/.dockerignore`）へ`**/node_modules`・`**/.env*`相当の除外を追加することを推奨する。
- 性能エバリュエーターのフィードバック:
  - 【総評】合格。受け入れ条件10項目すべてを実際の実行（pytest・ruff・docker build/run・git履歴確認）で検証し、いずれも満たしていることを確認した。warningも0件のため、statusを「完了」に更新する（差し戻し回数は0のまま）。
  - 【pytest】`uv run pytest -v`をリポジトリルートで実行し、`collected 170 items` / `170 passed`（10秒）。ヘッダに`configfile: pyproject.toml` / `testpaths: backend/tests`が表示され、全テストが`backend/tests/*.py`から実際に収集されていることを確認した。再編前の170件と件数が完全に一致しており、「収集0件で素通り」ではないことを収集件数・各テスト名の出力の両方で確認済み。
  - 【warning 0件の厳密確認】通常実行で`warnings summary`セクションが出力されないことに加え、`uv run pytest -W error`（全warningをエラー化）でも`170 passed`となることを確認した。DeprecationWarning等を含め警告は1件も発生しておらず、差し戻しルールに抵触しない。
  - 【ruff】`uv run ruff check .`＝`All checks passed!`（exit 0）。さらに`uv run ruff check . --show-files`で対象ファイルを列挙し、`backend/app/*.py` 13件・`backend/tests/*.py` 9件の計22ファイル（＋`pyproject.toml`）が全てlint対象に含まれていることを確認した。ルート起点の再帰探索のため移動後のソースの取りこぼしは無い。
  - 【import解決の実確認】`sys.path`に`backend`を追加した状態で`import app`が`/home/shino/portfolio/ProjectList/backend/app/__init__.py`を解決することを確認。ルート直下に`app/`・`tests/`は残っておらず（`ls`で`Dockerfile`・`README.md`・`app.db`・`backend`・`pyproject.toml`・`spec.md`・`uv.lock`のみ）、旧パスの残骸を誤importする余地は無い。
  - 【実行ディレクトリ非依存の確認（追加検証）】`backend/`ディレクトリをcwdにして`uv run pytest`を実行しても、rootdirがリポジトリルートとして解決され`170 passed`・`uv run ruff check .`も`All checks passed!`となることを確認した。CIの`run: uv run pytest`（ルート実行）はもちろん、ローカルでの実行位置が変わっても破綻しない。
  - 【git履歴上の移動】`git status --porcelain`で23ファイルすべてが`R`（rename）、`git diff --cached -M --stat`で`23 files changed, 0 insertions(+), 0 deletions(-)`＝内容無変更を確認。さらに各テストファイルを`git show HEAD:tests/<file>`と`diff`で1件ずつ突き合わせ、全9ファイルが完全一致（差分なし）であることを確認した。テスト関数定義数もHEAD側146・現行146で一致（170件はparametrize展開後の件数）。内容変更があったのは`pyproject.toml`・`Dockerfile`（`COPY backend/app ./app`）・`.dockerignore`（`backend/tests`）・`ci.yml`（コメント1行）の4ファイルのみで、いずれもパス追従の範囲内。
  - 【設定ファイルのルート残置】`pyproject.toml`・`uv.lock`・`Dockerfile`・`.dockerignore`・`.github/workflows/ci.yml`・`README.md`・`spec.md`・`.python-version`・`.gitignore`がすべてリポジトリルートに存在することを確認。
  - 【CIワークフロー定義】`lint`は`uv run ruff check .`（ルート再帰探索＝`backend/`配下を実際に対象にすることを`--show-files`で裏取り済み）、`test`は`uv run pytest`（`testpaths = ["backend/tests"]`が効くことを実行ヘッダで裏取り済み）、`build`は`context: .`＋Dockerfileの`COPY backend/app ./app`で新レイアウトを対象にしている。`needs`による`lint→test→build`の直列依存、`push: false`、`permissions: contents: read`も維持されており、新レイアウトのソースを対象にlint・test・buildを実行する定義になっている。
  - 【docker実機検証（ビルド〜API疎通）】ユーザー許可のもと実施し、検証後にコンテナ・イメージとも削除済み（`docker push`・実デプロイは未実行）。
    - `docker build`成功に加え、キャッシュの影響を排除するため`docker build --no-cache`でもクリーンビルドが成功することを確認した（旧`COPY app ./app`のままならルートに`app/`が無いため必ず失敗するので、新パスでコピーが成立していることの裏取りになる）。
    - `docker run -e API_KEY=... -p 18077:8000`で起動し、`X-API-Key`なしの`GET /projects`＝401、正しいキー付き＝200を確認。`/docs`は404のまま。
  - 【コンテナ内配置・権限が再編前と同一】`/app`直下は`.venv`・`app`・`data`のみで`/app/tests`・`/app/backend`は存在しない（テストコードは`.dockerignore`で除外されたまま）。`DATABASE_URL=sqlite:////app/data/app.db`、`/app/data/app.db`が生成される。実行ユーザーは`uid=1000(appuser)`（非root）。`/app/fastapi.py`・`/app/app/evil.py`・`/app/.venv/evil.py`への書き込みはいずれも`Permission denied`、`/app/data`配下のみ書き込み成功。`find /app -writable`（`/app/data`除く）のヒットは`/app/.venv/.lock`のみで、再編前（CI/CDタスクの【追記2】時点）と完全に同一の状態。
  - 【既存挙動の回帰確認（コンテナ実機）】ステータス遷移警告を4パターンで実測し、同一（提案中→提案中）＝`warning: null`、隣接順行（提案中→契約中）＝`null`、飛び越え順行（契約中→完了）＝`null`、逆行（完了→提案中）＝`"完了 から 提案中 への変更です。..."`と正しく分岐することを確認。論理削除は`DELETE`＝204後に一覧から除外・詳細が404。親詳細（`GET /projects/{id}`）のレスポンスに子タスク情報が含まれないこと、配下タスク0件の時給換算が`{"total_work_hours":0.0,"hourly_rate":null}`で200を返すことも確認した。いずれも既存タスクの受け入れ条件どおり。
  - 【テストによる担保の確認（テスト不足の有無）】指示された境界値・エッジケースに対応するテストが新レイアウトでも収集・パスしていることを個別に確認した: ステータス警告4パターン（`test_status_transitions.py`のproject/task/prep/resultそれぞれに同一・隣接順行・飛び越え順行・逆行、加えて分岐先＝無関係遷移）、論理削除の一覧・詳細除外（`test_delete_*_marks_is_deleted_and_excludes_from_list`・`test_get_*_not_found_after_deletion`）、親詳細の子情報非包含（`test_get_project_detail_does_not_include_child_task_info`・`test_get_company_detail_does_not_include_child_interview_step_info`）、WorkLogの同一タスク多重start（`test_start_work_log_allows_multiple_running_logs_for_same_task`）・複数タスク／案件の同時進行（`..._allows_concurrent_logs_across_tasks_and_projects`）・進行中ログの扱い（`test_hourly_rate_running_log_excluded_from_total`）、稼働時間0の時給換算（`test_hourly_rate_zero_total_hours_returns_consistent_response_without_error`・`..._when_no_tasks`）。本タスク固有のテスト不足は無い（再編タスクの性質上、レイアウト自体を検証する自動テストは存在しないが、170件が新設定のまま収集・パスすること自体が探索先とimport解決の担保になっている）。
  - 【Low（差し戻し対象外・記録のみ）】`README.md`は0バイトの空ファイルのため受け入れ条件9「ドキュメント内のパス記述が新レイアウトと矛盾しない」は自明に成立しているが、リポジトリのレイアウト（`backend/`・今後の`frontend/`）や起動・テスト手順の記載は将来的に追加が望ましい。
  - 【Low（本タスク起因ではない既存事象・記録のみ）】`--no-cache`ビルドしたイメージ内の`/app/app`に`__pycache__`が含まれることを実機で確認した。`.dockerignore`の`__pycache__`がアンカー付きでネストに効かないためで、セキュリティエバリュエーターが既にLowとして記録済みの再編前からの事象（`**/__pycache__`・`**/*.py[oc]`への変更が適切）。イメージ肥大化のみで機能・セキュリティ影響は無いため差し戻し対象にしない。
  - 【非対象】`frontend/`ディレクトリ自体は本タスクの概要どおり後続タスクで作成する方針のため、未作成であることを不備とは扱わない。
- 差し戻し回数: 0

### タスク: CORS許可オリジン設定（バックエンド）
- status: 完了
- 概要: 別オリジンで動作するフロントエンドからAPIを呼び出せるようにする。許可オリジンは環境変数へのカンマ区切り列挙で指定し、未設定時はどのオリジンも許可しない（決定事項「CORSの許可オリジン指定方針」に従う）。以降のフロントエンドタスクの前提となるため、ディレクトリ再編タスクの完了後に実施する。
- 受け入れ条件:
  - [x] 環境変数にカンマ区切りで複数のオリジンを列挙でき、そのいずれからのリクエストでも許可を示すレスポンスヘッダーが返る
  - [x] 列挙されていないオリジンからのリクエストでは許可を示すレスポンスヘッダーが返らない
  - [x] 環境変数が未設定または空の場合、いかなるオリジンも許可されない
  - [x] 全オリジンを無条件に許可する設定が既定値になっていない
  - [x] プリフライトリクエストが、本アプリで実際に使用するHTTPメソッドと認証用ヘッダーに対して成功する
  - [x] 認証・論理削除など既存エンドポイントの挙動に変化がなく、既存テストが全て通る
  - [x] 上記の許可・非許可・未設定時の挙動がpytestで検証される
- 実装メモ（技術判断とその理由）:
  - **設定モジュールの分離（`backend/app/cors.py`）**: 認証（`app/auth.py`）が業務ロジックから独立した1箇所の関門として実装されているのに合わせ、CORSも独立モジュールにした。公開するのは環境変数名の定数`CORS_ALLOW_ORIGINS_ENV_VAR`（値は`CORS_ALLOW_ORIGINS`、spec本文の例に合わせた）、パース関数`get_allowed_origins()`、FastAPIアプリへ適用する`configure_cors(app)`の3つ。ミドルウェアはStarlette/FastAPI標準の`CORSMiddleware`を使い、独自実装はしていない。
  - **パース仕様**: 環境変数の値をカンマで分割し、各要素を`strip()`した上で空要素を捨てる。したがって未設定・空文字列・空白のみ・`,`のみ・`a,,`のような入力はいずれも「許可オリジン0件」に落ち、`allow_origins=[]`（＝どのオリジンにも`Access-Control-Allow-Origin`を返さない）となる fail closed になる。`os.environ.get(..., "")`のデフォルトは空文字列であり、ワイルドカード`*`をデフォルト値にしている箇所はコード上どこにも無い。
  - **環境変数の読み込みタイミングとアプリ組み立て方法（`create_app()`の追加）**: 許可オリジンはプロセス起動時（アプリ組み立て時）に1度だけ読む方式にした（リクエストごとに環境変数を読む方式は、CORSミドルウェアがアプリ構築時に設定を確定させるStarletteの標準的な使い方から外れ、実装が複雑になるため採らなかった）。ただしモジュールトップレベルで`app = FastAPI(...)`を組み立てたままだと環境変数を変えたテストが書けないため、`app/main.py`の組み立て処理を`create_app()`関数に切り出し、`app = create_app()`とした。`uvicorn app.main:app`（Dockerfileの`CMD`）・既存テストの`from app.main import app`はどちらもそのまま動作し、外部から観測できる挙動は変わらない。テストは`create_app()`を環境変数設定後に呼ぶことで、設定違いのアプリを都度組み立てて検証している。
  - **許可メソッド・ヘッダーの明示列挙**: `allow_methods=["GET", "POST", "PATCH", "DELETE"]`（本APIが実際に使うメソッドのみ）、`allow_headers=["Content-Type", "X-API-Key"]`（JSONボディ送信に必要なものと認証用ヘッダー）とし、いずれもワイルドカード`*`は使っていない。`Content-Type: application/json`はCORSのsafelist対象外でプリフライトの許可が必要なため含めている。
  - **`allow_credentials`は`False`（既定のまま）**: 認証はCookieではなく`X-API-Key`ヘッダーで行うため、資格情報付きリクエスト（`credentials: 'include'`）を許可する必要が無く、最小権限の観点から有効化していない。フロントエンドは`X-API-Key`ヘッダーを明示的に付けてfetchする前提。
  - **プリフライトと認証の関係**: プリフライト（OPTIONS）はブラウザが自動送信するもので`X-API-Key`を持たないが、`CORSMiddleware`はミドルウェア層でルーティング・グローバル依存関係（`verify_api_key`）より先に応答するため、認証を緩めることなくプリフライトが200で成立する。`verify_api_key`は一切変更していない。
  - **テスト（`backend/tests/test_cors.py`、36件）**: (1) パースの単体テスト（単一・複数・前後空白あり・空文字列・空白のみ・`,`のみ・空要素混じり・未設定）、(2) 列挙した2つのオリジンそれぞれで`Access-Control-Allow-Origin`が返ること、(3) 非許可オリジンでは通常リクエスト・プリフライトとも当該ヘッダーが返らないこと、部分一致（`http://localhost:5173.evil.example.com`等）で通らないこと、(4) 環境変数が未設定/空/空白のみ/`,`のみ×3種のオリジンの組み合わせで一切許可されないこと、(5) ヘッダー値が`*`にならないこと、(6) GET/POST/PATCH/DELETEそれぞれのプリフライトが200かつ`x-api-key`・`content-type`が許可ヘッダーに含まれること、API Keyなしでもプリフライトが成立すること、(7) CORS有効下でも認証（未指定・誤キーで401）・案件の作成/詳細（子情報を含まない）/ステータス逆行warning/論理削除後の一覧・詳細からの除外が従来どおりであること、を検証している。既存テストと同様、`get_db`をテスト用の一時ファイルDBでオーバーライドし、開発用DBファイルを汚染しない（lifespanを走らせないTestClientの使い方にして`app.db`の生成自体も起こさない）。
  - **セルフチェック**: `uv run pytest` 206件全pass（従来170件＋新規36件）、`uv run pytest -W error`でも206件passでwarning 0件。`uv run ruff check .`は`All checks passed!`。
  - **docker実機確認**: `docker build`後、許可オリジン2件を`-e CORS_ALLOW_ORIGINS="http://localhost:5173, https://tracker.example.com"`で与えたコンテナと、環境変数未指定のコンテナの2つを起動して実際のuvicorn経由で確認した（検証後コンテナ・イメージとも削除済み。`docker push`・実デプロイは未実行）。列挙した2オリジンはそれぞれ`access-control-allow-origin`が自オリジンで返り、`https://evil.example.com`では当該ヘッダーが返らない。POST/DELETEのプリフライトは200で`access-control-allow-methods: GET, POST, PATCH, DELETE`・`access-control-allow-headers: ... Content-Type, X-API-Key`が返る（API Keyヘッダーなしでも成立）。環境変数未指定のコンテナでは、許可されるはずのオリジンからでも`access-control-allow-origin`が返らず、プリフライトは400（Starletteが許可されないプリフライトに返すステータス）で当該ヘッダーを含まない。`X-API-Key`なしの`GET /projects`は引き続き401。なお`CORS_ALLOW_ORIGINS`のデフォルト値はDockerfileにも設定していない（設定漏れ時に全許可へ倒れないようにするため、実行時に明示指定する運用）。
- セキュリティエバリュエーターのフィードバック: **Critical/High相当の問題なし。承認する。** `git status`/`git diff`で変更範囲が`backend/app/main.py`（`create_app()`への切り出し）・新規`backend/app/cors.py`・新規`backend/tests/test_cors.py`・`spec.md`のみであることを確認したうえで、`backend/app/auth.py`・`backend/app/routers/*.py`・`Dockerfile`・`.gitignore`・`.dockerignore`・`.github/workflows/ci.yml`と突き合わせ、さらに導入版Starlette（1.3.1）の`CORSMiddleware`実装を読み、`TestClient`で実際にオリジン照合・プリフライトの境界ケースを送って実地検証した。
  - **オリジン照合の厳密さ（確認済み・問題なし）**: `configure_cors()`は`allow_origin_regex`・`allow_private_network`・`expose_headers`のいずれも渡しておらず、Starletteの`is_allowed_origin()`は`allow_all_origins`でも正規表現でもない限り`origin in self.allow_origins`の完全一致のみで判定する（`starlette/middleware/cors.py`を確認）。実際に`CORS_ALLOW_ORIGINS="http://localhost:5173,https://app.example.com"`のアプリへ以下のOriginでリクエストして、いずれも`access-control-allow-origin`が返らないことを確認した: `https://app.example.com.evil.net`（前方一致）、`https://evil.app.example.com`（サブドメイン）、`http://app.example.com`（スキーム違い）、`https://app.example.com:443`（明示ポート）、`http://localhost:5173/`（末尾スラッシュ）、`HTTP://LOCALHOST:5173`（大文字）、`https://app.example.com `（末尾空白）、`null`、`file://`。許可オリジンのときのみ`Access-Control-Allow-Origin: <該当オリジン>`＋`Vary: Origin`が返る（キャッシュ汚染の観点でも正しい）。`null`オリジンは環境変数に明示列挙しない限り許可されない。
  - **fail-closed（確認済み・問題なし）**: `get_allowed_origins()`は`os.environ.get(VAR, "")`のデフォルトが空文字列で、`strip()`後の空要素を捨てるため、未設定・`""`・`"   "`・`","`・`"a,,"`はいずれも`[]`に落ちる。コード上・Dockerfile上ともに`*`を既定値にする経路は存在しない（`grep`で確認）。未設定時は許可オリジン0件で`Access-Control-Allow-Origin`が一切返らず、プリフライトも400になることを再現した。
  - **プリフライトと認証（確認済み・問題なし）**: `CORSMiddleware`はルーティングより外側で動くため、`Access-Control-Request-Method`付きOPTIONSはグローバル`Depends(verify_api_key)`を経ずに応答する。これはブラウザがプリフライトに認証ヘッダーを付けない以上必須の挙動であり、返却内容は`"OK"`／`"Disallowed CORS ..."`の固定文字列とCORSヘッダーのみで、ルートの存在有無・データ・内部情報を一切漏らさない（存在しないパス`/does-not-exist`でも同一の200応答になることを確認）。プリフライト以外の経路で認証がバイパスされないことも実測で確認: `Origin`付き`GET /projects`をAPI Keyなし／誤キーで送ると引き続き401（レスポンスボディは`{"detail":"Invalid or missing API Key"}`のみでスタックトレース等の内部情報なし）。`Origin`ヘッダーの無いリクエストはミドルウェアを素通りして通常のルーティングに渡るため、CORS導入による認証の穴は生じていない。
  - **許可メソッド／ヘッダーの絞り込み（確認済み・問題なし）**: プリフライトで`PUT`・`HEAD`・`OPTIONS`は400 `Disallowed CORS method`、`Authorization`ヘッダー要求は400 `Disallowed CORS headers`、`Access-Control-Request-Private-Network: true`は400 `Disallowed CORS private-network`（`allow_private_network`未指定＝False）になることを実測。`allow_methods`/`allow_headers`に`*`は無い。
  - **`allow_credentials=False`と`X-API-Key`許可のリスク評価（妥当）**: 本APIの認証はCookieではなくカスタムヘッダーであり、`allow_credentials=False`のためブラウザはCookie・HTTP認証情報を送らず、古典的なCSRF経路が塞がれている。`X-API-Key`を`allow_headers`に含めるのはフロントエンドが認証ヘッダーを付けてfetchするために必須で、かつカスタムヘッダー付きリクエストは必ずプリフライトを伴うため、許可オリジン以外のサイトからは（キーを知っていても）ブラウザ経由で成功しない。追加リスクは認められない。
  - **`create_app()`切り出しの回帰（確認済み・問題なし）**: `dependencies=[Depends(verify_api_key)]`・`docs_url=None`・`redoc_url=None`・`openapi_url=None`・`lifespan`はすべて維持されている（`git diff`のとおり、既存のセキュリティ設定のコメントごと移動しただけ）。`app = create_app()`によりモジュール属性`app`は従来どおり存在し、`uvicorn app.main:app`（Dockerfileの`CMD`）・既存テストの`from app.main import app`も不変。ルーターの`include_router`は5本すべて残っている。
  - **論理削除・既存挙動（確認済み・問題なし）**: 本差分は`app/routers/*.py`・`app/models.py`・`app/schemas.py`に一切触れていない。念のため`db.delete(`／`DELETE FROM`／`.delete()`を全文検索して0件（物理削除なし）、各GET系の`is_deleted.is_(False)`フィルタが従来どおり残っていることを確認した。CORS有効下でも作成→詳細→ステータス逆行warning→論理削除→一覧・詳細からの除外が従来どおり動作する（`test_cors.py::test_existing_endpoint_behavior_is_unchanged_with_cors_enabled`と手元の実行の双方で確認）。
  - **インジェクション・シークレット管理（確認済み・問題なし）**: 生SQLの文字列結合なし。`os.environ`の参照は`cors.py`（CORS_ALLOW_ORIGINS）・`auth.py`（API_KEY）・`database.py`（DATABASE_URL）の3箇所のみで、いずれもハードコードなし。`print`／`logging`はアプリコードに存在せず、環境変数値やユーザー入力（`platform`・`memo`等）をログ・外部コマンドへ渡す経路もない。`.gitignore`に`.env`・`*.db`・`*.sqlite3`、`.dockerignore`に`.env`・`backend/tests`が引き続き含まれる。`test_cors.py`の`TEST_API_KEY = "test-secret-key"`はテスト専用値で`monkeypatch.setenv`経由のみ。
  - **テスト**: `uv run pytest -W error`で206件全pass・warning 0件を自分でも再実行して確認。`test_cors.py`は許可・非許可・部分一致不可・未設定/空/空白/`,`のみのfail-closed・プリフライト・既存挙動の非劣化を網羅しており、受け入れ条件をカバーしている。
  - 【Low（差し戻し対象外・記録のみ）】`CORS_ALLOW_ORIGINS="*"`と設定した場合、Starletteが`allow_all_origins`と解釈して全オリジンに`Access-Control-Allow-Origin: *`を返す（実測で確認）。既定値ではなく運用者の明示指定であり、`allow_credentials=False`＋カスタムヘッダー認証のため未認証の第三者サイトが実害あるリクエストを成功させることはできない（401のまま）が、多層防御が1枚剥がれる。`get_allowed_origins()`で`*`を含む要素を捨てる／オリジン形式（`scheme://host[:port]`、パス・末尾スラッシュなし）を検証して不正値を除外する、といった防御を将来追加する余地がある。
  - 【Low（差し戻し対象外・記録のみ）】許可オリジン文字列は正規化も検証もされないため、大文字表記・末尾スラッシュ・`https://*.example.com`のようなワイルドカード風の指定はいずれも「黙って一致しない」（安全側だが原因が分かりにくい）。`README.md`が空で`CORS_ALLOW_ORIGINS`の記法（完全一致・スキームとポートを含む・末尾スラッシュ不可）がどこにも文書化されていない点と併せて、運用ドキュメント整備が望ましい。セキュリティ上の危険側の挙動ではないため差し戻し対象にしない。
  - 総評: fail-closedの成立・オリジン完全一致・ワイルドカードや緩い正規表現の不在・認証の非バイパス・既存挙動の非劣化がいずれも実測で裏付けられた。Critical/High相当の指摘なし。
- 性能エバリュエーターのフィードバック: **合格。受け入れ条件7項目すべてが実行済みテストで裏付けられていることを確認した。**
  - **pytest**: `uv run pytest -v`で206件全pass（既存170件＋`backend/tests/test_cors.py`の新規36件、約12秒）、failure/error/skip 0件。**warning 0件**（`uv run pytest -W error`でも206件pass。運用ルールの差し戻し条件に該当しない）。
  - **ruff**: `uv run ruff check .`は`All checks passed!`。`uv run ruff check --show-files .`で新規の`backend/app/cors.py`・`backend/tests/test_cors.py`が確実にlint対象へ含まれていることも確認済み（CIのlint→test→buildと同じコマンド）。
  - **受け入れ条件1（複数オリジン列挙で各オリジンに許可ヘッダー）: 合格** — `test_listed_origins_receive_allow_origin_header`（`http://localhost:5173`／`https://tracker.example.com`のパラメトライズ2件）が200かつ`access-control-allow-origin`＝当該オリジンを検証。手元でも`Vary: Origin`が併せて返ることを確認。
  - **受け入れ条件2（非許可オリジンでは許可ヘッダーが返らない）: 合格** — `test_unlisted_origin_does_not_receive_allow_origin_header`（通常リクエスト）、`test_unlisted_origin_preflight_does_not_receive_allow_origin_header`（プリフライト）、`test_origin_matching_is_exact_and_not_prefix_based`（`http://localhost:5173.evil.example.com`・ポート違い・スキーム違い）でカバー。独自検証でも末尾スラッシュ付き・大文字表記・`null`オリジンがいずれも許可されないことを実測。
  - **受け入れ条件3（未設定・空ならいかなるオリジンも不許可）: 合格** — `test_no_origin_is_allowed_when_env_var_unset_or_empty`が環境変数4パターン（未設定/`""`/`"   "`/`","`）×オリジン3種＝12ケースで、通常リクエスト・プリフライト双方に許可ヘッダーが出ないことを検証。独自検証で`",,  ,"`のような複合空要素でも`[]`に落ちることを確認。
  - **受け入れ条件4（全許可が既定でない）: 合格** — `test_wildcard_is_not_the_default`（未設定/空）と`test_wildcard_is_not_returned_even_when_origins_are_configured`がヘッダー値`*`にならないことを検証。`get_allowed_origins()`のデフォルトは空文字列で、コード・Dockerfileともに`*`を既定にする経路が無いことも確認。
  - **受け入れ条件5（実使用メソッドと認証ヘッダーのプリフライト成功）: 合格** — `test_preflight_succeeds_for_used_methods_and_auth_header`がGET/POST/PATCH/DELETEの4パラメータで200・`access-control-allow-origin`・`access-control-allow-methods`に当該メソッド・`access-control-allow-headers`に`x-api-key`と`content-type`が含まれることを検証。`test_preflight_does_not_require_api_key`でAPI Keyなしのプリフライトが成立することも担保。独自検証では`PUT`/`OPTIONS`のプリフライトが400 `Disallowed CORS method`になること、`access-control-allow-credentials`が返らないことも確認。
  - **受け入れ条件6（既存挙動の非劣化・既存テスト全通過）: 合格** — 既存170件が全pass（回帰なし）。重点確認項目もいずれもpass: ステータス警告の4パターン（同一・隣接・飛び越え・逆行）は`test_status_transitions.py`の17件、論理削除後の一覧・詳細からの除外は`test_projects.py`／`test_tasks.py`／`test_work_logs.py`／`test_companies.py`、親詳細への子情報非包含は`test_projects.py:122`（`"tasks" not in body`）と`test_companies.py:99`（`"interview_steps" not in body`）、WorkLogの同一タスク多重start・複数タスク/案件の同時進行・`ended_at`がNULLの進行中扱いは`test_work_logs.py`、稼働時間合計0の時給換算は`test_hourly_rate_zero_total_hours_returns_consistent_response_without_error`／`..._when_no_tasks`が担保。加えて`test_cors.py::test_existing_endpoint_behavior_is_unchanged_with_cors_enabled`がCORS有効下でも作成→詳細（子情報なし）→逆行warning→論理削除後の除外が同じであることを再確認している。認証は`test_authentication_still_rejects_requests_without_api_key_from_allowed_origin`／`..._invalid_api_key_...`で許可オリジンからでも401のままであることを検証。
  - **受け入れ条件7（許可・非許可・未設定時の挙動がpytestで検証される）: 合格** — 上記1〜5に加え、`get_allowed_origins()`のパース単体テスト8件（単一・複数・前後空白・空文字列・空白のみ・`,`のみ・空要素混じり・未設定）があり、テスト不足は認められない。
  - **独自の実地検証（コード無変更）**: (1) `TestClient`で`create_app()`を環境変数違いで組み立て直し、オリジン照合・fail-closed・プリフライトの境界を再現。(2) `docker build`後、`-e CORS_ALLOW_ORIGINS="http://localhost:5173, https://tracker.example.com"`のコンテナと環境変数未指定のコンテナを起動し、実uvicorn経由でcurl検証（列挙2オリジンは自オリジンが返る／`https://evil.example.com`は返らない／プリフライトPOSTは200で`access-control-allow-methods: GET, POST, PATCH, DELETE`・`Content-Type, X-API-Key`／API Keyなしは401／未指定コンテナは許可ヘッダーなしでプリフライト400）。検証後にコンテナ・イメージとも削除済み。`docker push`・`git push`・実デプロイは未実行。(3) `CORS_ALLOW_ORIGINS="*"`を環境に置いた状態でも`uv run pytest -W error`が206件passすることを確認（テストが実行環境の環境変数に依存していない）。(4) テスト実行後に`git status`が本タスクの差分（`backend/app/main.py`・`backend/app/cors.py`・`backend/tests/test_cors.py`・`spec.md`）のみで、開発用DBファイル等の副作用が無いことを確認。
  - 【Low（合格判定に影響しない・記録のみ）】プリフライトのテストはすべて`/projects`パスに対して行われており、PATCH/DELETEを実際に使う`/projects/{id}`・`/tasks/{id}/work-logs/{id}`のようなネストしたパスでのプリフライトは直接テストされていない。`CORSMiddleware`はルーティングより外側で動きパスに依存しないため実害はない（独自検証でも存在しないパスで同じ応答になることを確認）が、意図を明示するテストがあるとより堅い。
  - 【Low（合格判定に影響しない・記録のみ）】`allow_credentials=False`であることを直接固定するテスト（`access-control-allow-credentials`ヘッダーが返らないこと）が無く、将来`allow_credentials=True`に変更されてもテストは緑のままになる。設計判断として重要な値なので、回帰防止のアサーションを1件足す余地がある（今回の受け入れ条件には含まれないため差し戻し理由にはしない）。
  - 総評: 206件全pass・warning 0件・ruff通過。受け入れ条件7項目すべてがテストで裏付けられ、既存機能への回帰も認められないため**完了**とする。
- 差し戻し回数: 0

### タスク: フロントエンド基盤セットアップとAPI疎通
- status: 完了
- 概要: `frontend/` 配下にReact + Vite + TypeScriptのSPA開発環境を用意し、認証付きでAPIを呼び出して結果を画面に表示できる最小構成を作る。以降の全画面タスクの土台となる。CORS設定タスクの完了後に着手する。
- ~~**着手前にユーザー確認が必要な設計判断**: API Keyをブラウザ側でどう扱うか（画面上での入力方法、保持・永続化の有無、リロード後の再入力可否など）~~ → **解決済み**。「## 決定事項」の「API Keyのブラウザ側での扱い（確定: 画面で入力し sessionStorage に保持）」および「フロントエンドのUI方針（確定: UIライブラリを導入する）」に従うこと。
- 受け入れ条件:
  - [x] `frontend/` 配下で開発サーバーを起動でき、ブラウザで初期画面が表示される
  - [x] `frontend/` 配下で本番用ビルドが成功する
  - [x] 型チェックとlintをコマンドで実行でき、違反があれば失敗する
  - [x] APIの接続先がソースコードに直書きされておらず、環境ごとに切り替えられる
  - [x] 実際に稼働中のAPIへ認証付きでリクエストし、取得内容が画面に表示される
  - [x] 認証エラー時・通信失敗時に、原因が判別できるメッセージが画面に表示される
  - [x] API Keyの扱い方についてユーザーの判断を得たうえで実装されている（未確認のまま実装しない）
  - [x] API Keyなどの秘密情報がソースコードやリポジトリにコミットされていない
  - [x] 開発サーバーのオリジンをCORSの環境変数に列挙することでブラウザからAPIを呼べることを実際に確認済み
  - [x] フロントエンドの依存関係ディレクトリ・ビルド成果物がバージョン管理およびバックエンドのコンテナイメージに含まれない
- 実装メモ（技術判断とその理由）:
  - **実行環境（Node.js）**: WSL側にNode.jsが入っておらず（PATH上のnpmはWindows側の`/mnt/c/Program Files/nodejs`のもので`node`が解決できない状態）、aptの候補もEOLの18系だったため、公式配布物からNode 24.19.0（LTS "Krypton"）を**ユーザーローカル**（`~/.local/lib/node-v24.19.0-linux-x64`）へ展開して使用した（sudo不要・システム領域を汚さない）。以降のフロントエンド作業では`export PATH="$HOME/.local/lib/node-v24.19.0-linux-x64/bin:$PATH"`が必要。
  - **スキャフォールド**: `npm create vite@latest frontend -- --template react-ts`（create-vite 9.1.2）。生成された構成は React 19.2 / Vite 8.2 / TypeScript 6.0 / lintは**oxlint**（現行テンプレートの既定。ESLintではない）。TypeScript 6.0は`strict`が既定で有効なことを実地確認済み（暗黙any・null到達がエラーになる）。
  - **UIライブラリ（MUI v9系）**: 決定事項「UIライブラリを導入する」に従い`@mui/material` 9.3.1（＋`@emotion/react`・`@emotion/styled`）を採用。React 19対応の最新安定版で、テーブル・フォーム・ダイアログ・Alertが一通り揃うため以降の画面タスクをそのまま載せられる。なおv9のStackは`alignItems`等のプロパティが廃止され`sx`指定に一本化されているため、型エラーに従い`sx={{ alignItems: ... }}`で記述している。
  - **APIの接続先（環境変数）**: `src/config.ts`の`getApiBaseUrl()`が`import.meta.env.VITE_API_BASE_URL`を読み、前後空白と末尾スラッシュを正規化して返す。**フォールバックURLは持たず**、未設定なら`null`＝設定不備として画面にその旨を表示する（既定値で別環境へ繋ぎにいく事故を防ぐため）。開発用の既定値は`frontend/.env.development`（`http://localhost:8000`、秘密情報なしのためコミット対象）、記法の見本として`frontend/.env.example`を用意。個人設定は`.env.local`等（`*.local`はfrontend/.gitignoreで除外）、本番はビルド環境の環境変数で与える。本番ビルド成果物に`localhost:8000`が混入しないことを`dist`のgrepで確認済み。
  - **API Keyの扱い（決定事項どおり）**: `src/api/apiKeyStorage.ts`がキー`project-tracker.api-key`で`sessionStorage`のみを読み書きする（`localStorage`は未使用。sessionStorageが使えない環境でも例外で画面が壊れないようtry/catchで握る）。キーはソース・`.env`・ビルド時環境変数のいずれにも埋め込まず、画面上の`type="password"`入力欄から入力して「保存して接続」で保持する。`autoComplete="off"`。「クリア」で破棄可能。
  - **APIクライアント（`src/api/client.ts`）**: `X-API-Key`ヘッダーで認証し、`credentials`は送らない（バックエンドが`allow_credentials=False`のため）。失敗は`ApiError`に`kind`（`config`／`unauthorized`／`http`／`network`／`invalidResponse`）を持たせて分類し、画面ではその文言をそのままAlertに出す。401は「認証エラー（HTTP 401）: API Keyが正しくありません」、fetch自体の失敗は「APIサーバーに接続できませんでした（<接続先>）。APIが起動しているか、接続先URLとCORSの許可オリジン設定を確認してください」と、ブラウザからは区別できない未起動／URL誤り／CORS不許可をまとめて示す文言にした。エラーレスポンスの`detail`は表示に含めるが、スタックトレース等は表示しない。
  - **画面構成**: `App.tsx`（接続先の表示＋状態管理）＋`components/ApiKeyPanel.tsx`（キー入力）＋`components/ProjectsPanel.tsx`（`GET /projects`の結果表示）。取得件数を必ず表示し、0件時は「案件は0件です。」と明示する（表示が破綻しない）。読み込み中はスピナー、失敗時はAlert（severity=error）。
  - **コマンド（package.json）**: `dev`／`build`（`tsc -b && vite build`）／`typecheck`（`tsc -b`）／`lint`（`oxlint --deny-warnings`＝警告も失敗扱いにして「違反があれば失敗する」を満たす）／`test`（`vitest run`）。lint・typecheckとも、故意に違反コードを置いた状態でexit 1になることを実地確認済み（確認用ファイルは削除済み）。
  - **テスト（Vitest＋Testing Library、24件）**: バックエンドがpytestなのに対しフロントはVitest（jsdom）を採用。`src/api/client.test.ts`（接続先と`X-API-Key`の付与、末尾スラッシュ正規化、接続先未設定・キー未入力時はfetchせずエラー、401／その他HTTPエラー／通信失敗／JSON不正／204の分類）、`src/api/apiKeyStorage.test.ts`（sessionStorageのみに保存しlocalStorageは使わない、再読み出し＝リロード相当、クリア）、`src/App.test.tsx`（未入力時はAPIを呼ばない、入力→表示、キーの保持、保持済みキーでの自動取得、クリア、0件表示、401／通信失敗／接続先未設定のメッセージ、再読み込みでの復旧）。実行環境の`.env`に影響されないよう`vite.config.ts`のtest設定で`VITE_API_BASE_URL`を空にし、各テストで`vi.stubEnv`する。
  - **実ブラウザでのAPI疎通確認**: バックエンドを`API_KEY=...`・`CORS_ALLOW_ORIGINS=http://localhost:5173`・`DATABASE_URL=<一時ファイル>`で起動（開発用DBは汚していない）し、Vite開発サーバー（`http://localhost:5173`）を立てた上で、**実際のChrome（headless）で`http://localhost:5173`を開いて**以下を確認した（検証用の一時ページ・プロセスはすべて削除・停止済み）。ポート8000は別プロセスが使用中だったためAPIは18010で起動し、開発サーバー側は環境変数`VITE_API_BASE_URL`で接続先を差し替えた（環境ごとの切り替えが効くことの確認も兼ねる）。
    - 正しいキー: 画面に「接続先: http://localhost:18010」「取得件数: 1 件」と案件行（ID／案件名／クライアント／ステータス／報酬）が表示される。
    - 誤ったキー: 「認証エラー（HTTP 401）: API Keyが正しくありません。入力したキーを確認してください。」が表示される（バックエンドは401応答にもCORSヘッダーを付けるためブラウザ側で内容を読める）。
    - `CORS_ALLOW_ORIGINS`を外してAPIを再起動: 同じ操作で「APIサーバーに接続できませんでした（…）。…CORSの許可オリジン設定を確認してください。」に変わる＝**開発サーバーのオリジンをCORS環境変数に列挙して初めてブラウザから呼べる**ことを実地で確認。
    - APIを停止: 同じ通信失敗メッセージが表示され、画面は破綻しない。
    - curlでも許可オリジンからのプリフライト（`OPTIONS /projects`、`Access-Control-Request-Headers: x-api-key`）が200で`access-control-allow-origin: http://localhost:5173`・`access-control-allow-headers: … X-API-Key`を返すことを確認済み。
  - **Git・コンテナからの除外**: `frontend/.gitignore`（テンプレート由来）で`node_modules`・`dist`・`*.local`を除外し、`git add -n`でコミット対象が28ファイル（ソース・設定・`package-lock.json`のみ）であること、`frontend/.env`はルート`.gitignore`の`.env`で除外されることを確認。`.dockerignore`は指摘のあったアンカー問題を修正し、`**/__pycache__`・`**/*.py[oc]`・`**/*.db`・`**/*.sqlite3`・`**/.env`・`**/.env.*`とネストにも効く形にしたうえで、`frontend`（ディレクトリごと）・`**/node_modules`・`**/dist`を追加した。`docker build`後のイメージ内に`frontend`・`node_modules`・`dist`・`__pycache__`が一切存在しないこと、コンテナが従来どおり401/200・CORSヘッダーを返すことを確認し、イメージ・コンテナとも削除済み（`docker push`・実デプロイは未実行）。
  - **秘密情報**: リポジトリに追加したファイル内にAPI Keyやトークンは無い（検証で使った`front-check-key`等はコマンドラインで与えた一時的な値で、コミット対象ファイルには含まれない）。
  - **スコープ外（意図的に手を付けていない）**: CIワークフローへのフロントエンドのジョブ追加（本タスクの受け入れ条件は「コマンドで実行できる」ことまで。CI/CDタスクは完了済みのため別途要判断）、ルート`README.md`の整備、案件以外の画面（後続タスク）。
  - **セルフチェック**: フロント＝`npm run typecheck`（tsc -b、エラーなし）・`npm run lint`（oxlint --deny-warnings、指摘なし）・`npm run test`（24 passed）・`npm run build`（成功）。バックエンド＝`uv run pytest -W error` 206 passed（warning 0件）、`uv run ruff check .` All checks passed!。
- セキュリティエバリュエーターのフィードバック: **Critical/High相当の問題なし**。`frontend/`配下の全コミット対象ファイル（`src/config.ts`・`src/api/{apiKeyStorage,client,errors,projects,types}.ts`・`src/App.tsx`・`src/main.tsx`・`src/components/*.tsx`・テスト3件・`index.html`・`vite.config.ts`・`package.json`・`.env.development`・`.env.example`・`.gitignore`・`README.md`）、ルート`.dockerignore`の差分、およびバックエンド側（`app/auth.py`・`app/cors.py`・`app/main.py`・`app/database.py`・`app/routers/*`）を確認した。
  - **API Keyの扱い（確定方針どおり・問題なし）**: `src/api/apiKeyStorage.ts`は`window.sessionStorage`のみを読み書きし、`localStorage`・Cookie・URLクエリへの書き出しは一切ない（`grep`で`localStorage`／`document.cookie`／`location.search`の使用がソース側に存在しないことを確認。テスト側の`localStorage`参照は「localStorageに残らないこと」を検証する目的のみ）。キーは`X-API-Key`リクエストヘッダーにのみ載り（`src/api/client.ts`）、URLパスやクエリには載らない。`credentials`は送らずバックエンドの`allow_credentials=False`と整合。`console.*`による出力はソース全体で0件で、エラーメッセージ（`src/api/errors.ts`／`client.ts`）にもキー値・スタックトレース・内部パスは含まれない（401時は「API Keyが正しくありません」という値を含まない文言）。画面側は`type="password"`＋`autoComplete="off"`で平文表示なし、「クリア」でsessionStorageから削除できる。
  - **ビルド成果物へのキー・接続先の埋め込みなし（実測）**: `frontend/dist/assets/*.js`をgrepし、API Keyらしき値は皆無（ヒットするのはstorageキー名`project-tracker.api-key`とヘッダー名`X-API-Key`の文字列のみ）。`http://localhost:` の埋め込みも0件で、`.env.development`の値が本番ビルドに混入していないことを確認。sourcemapも出力されていない。
  - **リポジトリへの秘密情報混入なし**: `git add -n frontend`でコミット対象が28ファイル（`node_modules`・`dist`は除外済み）であることを確認。コミット対象の`.env.development`・`.env.example`は`VITE_API_BASE_URL=http://localhost:8000`のみで秘密情報なし（そもそも`VITE_`接頭辞の値はバンドルへインライン展開され公開情報になるため、キーを置かない方針は妥当）。テストコード中のキーは`valid-key`／`saved-key`等のダミーのみ。作業ツリーに未追跡の`.env`実ファイルも存在しない。
  - **`.dockerignore`修正は正しく機能（実測）**: ビルドコンテキストを実際に検査（`COPY . /ctx`する検証用イメージ）した結果、コンテキストに入るのは`.dockerignore`・`.gitignore`・`.python-version`・`Dockerfile`・`pyproject.toml`・`uv.lock`・`backend/app/**`のみで、`frontend`・`node_modules`・`dist`・`app.db`・`__pycache__`・`spec.md`・`.venv`・`.git`はすべて除外されていた。実際の`docker build`も成功し（ビルドは壊れていない）、生成イメージ内は`/app/{.venv,app,data}`のみでフロントエンド資材・DBファイル・`.env`の混入なし、`Config.Env`にも秘密情報なし（`DATABASE_URL`はコンテナ内パスのみ）。検証用イメージ・ビルド済みイメージはいずれも削除済み（`docker push`・デプロイは未実行）。
  - **XSS観点で危険な描画なし**: `dangerouslySetInnerHTML`・`innerHTML`・`eval`・`new Function`の使用は0件。APIレスポンス（`name`／`client_name`／`status`等）もエラーメッセージもJSXの式展開（React標準のエスケープ）とMUIコンポーネント経由でのみ描画している。
  - **依存パッケージ**: `npm audit`（Node 24.19.0）で **0 vulnerabilities**。`package-lock.json`はコミット対象に含まれており再現性も担保されている。
  - **バックエンドの劣化なし**: 本タスクの差分にバックエンドのコード変更は含まれない（`git status`上の変更は`.dockerignore`・`spec.md`・未追跡の`frontend/`のみ）。念のため再確認し、グローバル依存関係`Depends(verify_api_key)`＋`docs_url=None`/`redoc_url=None`/`openapi_url=None`による全エンドポイント認証、`secrets.compare_digest`による定数時間比較とfail closed、`CORS_ALLOW_ORIGINS`未設定時に全拒否＋`allow_credentials=False`、生SQL文字列結合なし（ORM経由のみ）、物理削除（`session.delete`／`DELETE FROM`）0件・`is_deleted`フィルタ維持、を確認した。
  - 補足（ブロッキングではない参考情報・Low）: `frontend/.gitignore`には`.env`系の除外指定がなく（`*.local`のみ）、`frontend/.env`はルート`.gitignore`の`.env`で拾えているが、README記載の**`frontend/.env.production`はどちらのignoreにも一致せずコミット対象になる**（`git check-ignore -v frontend/.env.production`が何も返さないことを確認）。`VITE_`変数は本来公開情報であり現状は秘密漏洩には直結しないが、将来の誤コミット防止のため`frontend/.gitignore`に`.env`・`.env.*`（`!.env.example`・`!.env.development`）を明示しておくとより安全。
  - 補足（設計上の受容事項）: sessionStorage保持はXSS発生時にキーが読める性質を持つが、これは「## 決定事項 / API Keyのブラウザ側での扱い」でトレードオフを明示したうえで確定済みの方針であり、本実装は方針から逸脱していない。
- 性能エバリュエーターのフィードバック: **合格。受け入れ条件10項目すべてを実コマンド・実ブラウザで検証し、満たされていることを確認した。バックエンドに回帰なし（206件pass・warning 0件）。**
  - **バックエンド回帰**: `uv run pytest -v` 206件全pass（約11.4秒、fail/error/skip 0件）。**warningは0件**（`uv run pytest -W error`でも206件pass）。`uv run ruff check .`は`All checks passed!`。ステータス警告4パターン（同一・隣接順行・飛び越え・逆行）、論理削除後の一覧/詳細除外、親詳細への子情報非包含、WorkLogの多重start・複数タスク/案件の同時進行・進行中ログ扱い、稼働時間0の時給換算はいずれも従来どおりpass。本タスクの差分（`.dockerignore`・新規`frontend/`）にバックエンドのコード変更は含まれない。
  - **フロントエンドのコマンド（Node 24.19.0をユーザーローカルPATHで実行）**: `npm run typecheck`（`tsc -b`）exit 0、`npm run lint`（`oxlint --deny-warnings`）exit 0、`npm run test`（`vitest run`）**24件全pass**（3ファイル、約2.2秒）、`npm run build`（`tsc -b && vite build`）成功（`dist/assets/index-*.js` 409.52 kB／gzip 129.09 kB、chunk sizeの警告も出ない）。`npm run dev`は`http://localhost:5173/`で起動しHTMLを返す。
  - **テスト実行時のwarning: 0件**。`vitest run`の標準エラー出力は0バイト、標準出力にも`warn`／`deprecat`／`experimental`の語は1件も現れない（フロント側も差し戻し条件に該当しない）。
  - **テストが「収集されずに素通り」でないことの確認**: `vitest run --reporter=verbose`で24件のテスト名と個別実行時間を確認した（`apiKeyStorage.test.ts` 4件、`client.test.ts` 9件、`App.test.tsx` 11件）。skip/todoは0件。内容も実質的で、`App.test.tsx`はTesting Library＋`userEvent`でDOM操作（キー入力→「保存して接続」クリック）を行い、`fetch`をスタブして呼び出しURL・`X-API-Key`ヘッダー値・表示テキストまでアサートしている。
  - **受け入れ条件1（開発サーバー起動・初期画面表示）: 合格** — `npm run dev -- --port 5173`を起動し、**実ブラウザ（Windows側Chromeのheadlessモードで`--dump-dom`）**で`http://localhost:5173/`を開いてレンダリング結果を確認。「案件・選考トラッカー」見出し、接続先表示、API Key入力欄（`type="password"`）、「API Keyを入力すると、APIへ接続して案件一覧を表示します。」、「案件一覧（GET /projects）」が実際に描画されていた（MUI/emotionのスタイルも注入済み＝Reactが正常に動作）。
  - **受け入れ条件2（本番ビルド成功）: 合格** — `npm run build`が`tsc -b`込みで成功。成果物の`dist/`を静的配信して実ブラウザで動作させ、API疎通まで確認済み（下記条件5・6）。
  - **受け入れ条件3（型チェック・lintが違反で失敗する）: 合格（意図的な違反を混入して実測）** — 一時ファイル`src/__eval_violation.ts`に暗黙any（`TS7006`）と型不一致（`TS2322`）を仕込むと`npm run typecheck`／`npm run build`がともに**exit 2**で失敗（`tsconfig.app.json`に`strict`の明記は無いがTypeScript 6.0の既定でstrictが有効なことを実地確認）。同様に`debugger`文と重複キーを仕込むと`npm run lint`が`no-debugger`／`no-dupe-keys`を報告して**exit 1**（`--deny-warnings`によりwarningレベルでも失敗）。**確認用ファイルは削除済みで、削除後に再実行してexit 0に戻ることを確認した**（`git status`も評価前と同一）。
  - **受け入れ条件4（接続先が直書きでなく環境ごとに切替可能）: 合格** — `src/config.ts`は`import.meta.env.VITE_API_BASE_URL`のみを参照しフォールバックURLを持たない。`VITE_API_BASE_URL=http://localhost:18010`を与えて起動した開発サーバーの画面に「接続先: http://localhost:18010」が表示され（`.env.development`の`http://localhost:8000`を上書きできている）、その接続先へ実際にリクエストが飛ぶことをブラウザで確認。環境変数なしでビルドした`dist`には`localhost`文字列が0件で、開発用の既定値が本番成果物へ混入しない。
  - **受け入れ条件5（稼働中APIへ認証付きリクエストし取得内容を表示）: 合格（実APIサーバー＋実ブラウザで確認）** — 一時DB（`DATABASE_URL`を評価用ファイルに指定。開発用`app.db`は未変更）で`uvicorn`を起動し案件を1件登録、`VITE_API_BASE_URL`をそのAPIに向けたビルド成果物を静的配信し、実ブラウザで開いた結果、画面に「接続先: http://localhost:18010」「取得件数: 1 件」と案件行（ID=1／評価用案件／評価クライアント／提案中／123,456）が表示された（`toLocaleString()`による桁区切りも機能）。
  - **受け入れ条件6（認証エラー時・通信失敗時に原因が判別できるメッセージ）: 合格（実ブラウザで3系統を確認）** — (a) 誤ったキー: 「認証エラー（HTTP 401）: API Keyが正しくありません。入力したキーを確認してください。」、(b) APIプロセス停止: 「APIサーバーに接続できませんでした（http://localhost:18010）。APIが起動しているか、接続先URLとCORSの許可オリジン設定を確認してください。」、(c) 接続先未設定: 環境変数名を含む設定不備メッセージ（vitestで担保）。いずれも`role="alert"`のMUI Alertとして表示され、画面レイアウトは破綻しない。認証エラーと通信失敗が別文言で区別できている。
  - **受け入れ条件7（API Keyの扱いをユーザー判断のうえ実装）: 合格** — 「## 決定事項」の「API Keyのブラウザ側での扱い（確定: 画面で入力し sessionStorage に保持）」に沿い、`sessionStorage`のみを使用（`apiKeyStorage.test.ts`が`localStorage.length === 0`まで検証）。画面入力（`type="password"`＋`autoComplete="off"`）・保持・クリア・リロード相当の再利用が実装・テストされている。
  - **受け入れ条件8（秘密情報の非コミット）: 合格** — `git add -n frontend`のコミット対象は28ファイル（ソース・設定・`package-lock.json`のみ）で、`node_modules`・`dist`は`frontend/.gitignore`で除外済み。コミット対象の`.env.development`／`.env.example`は`VITE_API_BASE_URL`のみ。ビルド成果物にAPI Keyらしき値は無い。評価に使った`front-eval-key`はコマンドラインで与えた使い捨て値でリポジトリには残っていない。
  - **受け入れ条件9（開発サーバーのオリジンをCORSに列挙して初めて呼べる）: 合格（実測）** — 許可オリジンに列挙した状態では`OPTIONS /projects`（`Origin: http://localhost:5173`、`Access-Control-Request-Headers: x-api-key`）が200＋`access-control-allow-origin`／`access-control-allow-headers: … X-API-Key`を返し、ブラウザからのGETも成功。`CORS_ALLOW_ORIGINS`を外してAPIを再起動すると、同じ画面・同じキーで前記(b)の通信失敗メッセージに変わることを実ブラウザで確認（プリフライトは400）。
  - **受け入れ条件10（依存関係ディレクトリ・ビルド成果物がVCSとバックエンドイメージに含まれない）: 合格（`docker build`で実測）** — 検証用イメージで`COPY . /ctx`してビルドコンテキストを実査した結果、含まれるのは`.dockerignore`・`.gitignore`・`.python-version`・`Dockerfile`・`pyproject.toml`・`uv.lock`・`backend/app/**`のみで、`frontend`・`node_modules`・`dist`・`*.db`・`__pycache__`・`.env*`は0件。実際の`docker build`も成功し、生成イメージの`/app`は`app`・`data`・`.venv`のみ、`/app/app`配下に`__pycache__`／`*.pyc`が**存在しない**（`.dockerignore`の`**/`アンカー修正が効いている＝再編タスクで記録されたLowが解消）。コンテナ起動後の実挙動も従来どおり（キーなし401／正キー200／許可オリジンのプリフライト200）。検証用イメージ・コンテナはすべて削除済み（`docker push`・実デプロイは未実行）。
  - **テストによる担保の確認（テスト不足の有無）**: 受け入れ条件のうち自動テスト化が可能な範囲（接続先の環境変数読み出しと末尾スラッシュ正規化、`X-API-Key`付与、401／その他HTTPエラー／通信失敗／JSON不正／204の分類、キー未入力・接続先未設定時にfetchしないこと、sessionStorageのみへの保持・再読み出し・クリア、取得結果の表示・0件表示・エラー表示・再読み込みでの復旧）はいずれも24件のテストで担保されており、**本タスクの受け入れ条件に対するテスト不足は認められない**。残る条件（開発サーバー起動、ビルド、lint/typecheckの失敗挙動、実APIとのCORS込み疎通）は性質上コマンド・ブラウザでの実地確認事項であり、上記のとおり自分で再現して確認した。
  - 【Low（合格判定に影響しない・記録のみ）】通信失敗（API未起動・URL誤り）とCORS不許可が同一文言になる。ブラウザからは原理的に区別できないため設計として妥当で、文言も両方の観点を促す内容になっているが、原因切り分けの手順（許可オリジン設定の確認方法）をREADMEに追記するとより親切。
  - 【Low（合格判定に影響しない・記録のみ）】`.github/workflows/ci.yml`はlint→test→buildの3ジョブすべてがバックエンド専用で、フロントエンドの`typecheck`／`lint`／`test`はCIで実行されない。受け入れ条件は「コマンドで実行できる」ことまでのため合格判定には影響しないが、「違反があれば失敗する」ゲートが自動化されていないので、後続のフロントエンドタスクの前にCIジョブ追加を検討したい（generator実装メモでもスコープ外と明記済み）。
  - 【Low（合格判定に影響しない・記録のみ）】後続タスクで使う分岐に未テストの経路がある: `client.ts`の`AbortError`の再スロー、`body`指定時の`Content-Type`付与（POST/PATCH経路）、`apiKeyStorage.ts`の`sessionStorage`が使えない環境のフォールバック。本タスクの受け入れ条件外だが、案件管理画面タスクで登録・更新を実装する際に併せてテストを足すのが望ましい。
  - 【Low（既出・セキュリティエバリュエーターと同旨）】`frontend/.env.production`はルート／`frontend`いずれの`.gitignore`にも一致せずコミット対象になる（`git check-ignore`で確認）。READMEが本番設定の置き場として案内しているため、`frontend/.gitignore`に`.env`・`.env.*`（`!.env.example`・`!.env.development`）を追加しておくと誤コミットを防げる。
  - **評価環境の後始末**: 評価で起動した`uvicorn`（ポート18010／18011）・Vite開発サーバー（5173）・静的配信サーバー（4173）はすべて停止、評価用DBはスクラッチ領域の一時ファイルのみ（開発用`app.db`は未変更）、`docker`のイメージ・コンテナは削除済み。混入した違反ファイルは削除し`dist`もクリーンに再ビルドしたため、`git status`は評価前と同一（`.dockerignore`・`spec.md`のM、`frontend/`のみ未追跡）。アプリケーションコード・テストコードは一切変更していない。
  - 総評: バックエンド206件pass・warning 0件・ruff通過、フロントエンド24件pass・warning 0件・typecheck/lint/buildすべて成功、受け入れ条件10項目を実ブラウザ・実APIまで含めて再現確認できたため**完了**とする。
- 差し戻し回数: 0

### タスク: フロントエンド 案件管理画面
- status: 未着手
- 概要: 案件の一覧・絞り込み・詳細表示・登録・編集・削除をブラウザ上で行えるようにする。基盤セットアップ完了後に着手する。
- 受け入れ条件:
  - [ ] 案件一覧が画面に表示され、ステータスによる絞り込みができる
  - [ ] 一覧から個別の案件詳細を表示できる
  - [ ] 入力フォームから案件を新規登録でき、登録内容が一覧・詳細に反映される
  - [ ] 案件の各項目（ステータス含む）を編集でき、変更内容が画面に反映される
  - [ ] ステータスの逆行時にAPIが返す警告が画面上でユーザーに提示され、かつ更新自体は妨げられない
  - [ ] 案件を削除でき、削除後は一覧・詳細から参照できなくなる
  - [ ] 必須項目の未入力や通信エラー時に、原因が判別できるメッセージが表示される
  - [ ] 一覧が0件の場合も表示が破綻せず、件数が0であることが分かる
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: フロントエンド タスク管理画面
- status: 未着手
- 概要: 案件配下のタスクの一覧表示・追加・編集・削除をブラウザ上で行えるようにする。案件管理画面の完了後に着手する。
- 受け入れ条件:
  - [ ] 案件を選んでその配下のタスク一覧を表示できる
  - [ ] タスクを新規追加でき、追加内容が一覧に反映される
  - [ ] タスクの各項目（ステータス含む）を編集でき、変更内容が画面に反映される
  - [ ] タスクのステータス逆行時にAPIが返す警告が画面上で提示され、更新自体は妨げられない
  - [ ] タスクを削除でき、削除後は一覧に表示されなくなる
  - [ ] 案件詳細のレスポンスに子タスクが含まれることを前提とせず、タスク一覧を別途取得して表示している
  - [ ] タスクが0件の案件でも表示が破綻しない
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: フロントエンド 稼働計測・時給換算画面
- status: 未着手
- 概要: タスク単位での稼働計測の開始/終了、稼働ログの確認・削除、案件の時給換算結果の表示をブラウザ上で行えるようにする。タスク管理画面の完了後に着手する。
- 受け入れ条件:
  - [ ] タスクごとに計測の開始と終了を操作でき、操作結果が画面に反映される
  - [ ] 進行中の稼働ログが、終了済みのログと視覚的に区別できる
  - [ ] 同一タスク内の多重計測、および別タスク・別案件との同時計測が行え、それぞれ画面上で扱える
  - [ ] タスクの稼働ログ一覧が表示され、各ログの稼働時間が確認できる
  - [ ] 誤って開始した稼働ログを削除でき、削除後は一覧に表示されなくなる
  - [ ] 案件の時給換算結果を画面で確認できる
  - [ ] 稼働時間が0など換算できない場合でも画面がエラーで破綻せず、換算できない旨が分かる表示になる
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: フロントエンド 選考管理画面（企業・選考ステップ）
- status: 未着手
- 概要: 企業の一覧・登録・詳細・削除と、企業配下の選考ステップの一覧・追加・編集・削除をブラウザ上で行えるようにする。案件系の画面とは独立しているため、基盤セットアップ完了後であれば着手できる。
- 受け入れ条件:
  - [ ] 企業一覧が表示され、企業を新規登録できる
  - [ ] 企業詳細を表示でき、企業を削除すると以降一覧・詳細から参照できなくなる
  - [ ] 企業配下の選考ステップ一覧を表示でき、選考ステップを追加できる
  - [ ] 選考ステップの各項目（種別・予定日・準備状況・結果・メモ）を編集でき、変更内容が画面に反映される
  - [ ] 準備状況・結果の逆行時にAPIが返す警告が画面上で提示され、更新自体は妨げられない（両方同時に逆行した場合も内容が分かる形で提示される）
  - [ ] 選考ステップを削除でき、削除後は一覧に表示されなくなる
  - [ ] 企業詳細のレスポンスに選考ステップが含まれることを前提とせず、ステップ一覧を別途取得して表示している
  - [ ] 予定日が未設定の選考ステップでも表示が破綻しない
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: フロントエンド 横断一覧画面（予定選考・進行中稼働）
- status: 未着手
- 概要: 日付が近い選考ステップの一覧と、現在進行中の稼働ログの一覧を横断的に確認できる画面を用意する。案件系・選考系の各画面が揃った後に着手する。
- 受け入れ条件:
  - [ ] 日付が近い選考ステップの一覧が表示され、どの企業のどのステップ・いつの予定かが分かる
  - [ ] 現在進行中の稼働ログの一覧が表示され、どの案件・どのタスクのものかが分かる
  - [ ] 進行中の稼働ログの一覧から、対象の計測を終了でき、終了後はその一覧に表示されなくなる
  - [ ] 一覧の項目から、対応する案件・タスク・企業の詳細画面へ辿れる
  - [ ] 該当データが0件の場合も表示が破綻せず、0件であることが分かる
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

## 型安全性リファクタリング（実装タスク一覧の外）

新規のspec.mdタスクではなく、既存の完了済みタスク群（状態遷移警告ロジック、Project/Task/InterviewStepのステータス更新エンドポイント）を横断する型安全性の改善依頼として実施。

- 背景: `app/schemas.py`で`ProjectStatus = Literal[*PROJECT_STATUS_GRAPH]`のように、状態遷移グラフ（辞書）のキーを`Literal[*...]`でアンパックして動的生成していたため、実行時（Pydanticバリデーション）は正しく動作する一方、静的型チェッカー（Pylance/Pyright）が「Literalの中身に変数は使えない」旨の警告を出し、`ProjectStatus`等を使う全箇所に警告が伝播していた。
- 変更概要:
  - `app/status_transitions.py`: `ProjectStatus`/`TaskStatus`/`InterviewStepPrepStatus`/`InterviewStepResult`の4つを`StrEnum`（`enum.StrEnum`）として新規定義し、`PROJECT_STATUS_GRAPH`等の既存4グラフはこれらのEnumをキー・値とする辞書に置き換えた（グラフの中身・遷移関係は変更していない、文字列リテラル→Enumメンバーへの置き換えのみ）。`check_backward_transition`/`_is_reachable`は、Enumキーの辞書・素の文字列どちらの引数でも動作するよう、PEP 695のジェネリック構文（`str`境界の型パラメータ）に変更した。
    - 技術判断: 依頼文面では`class XxxStatus(str, Enum)`という多重継承が例示されていたが、その形だと（a）Python 3.11以降`str(member)`/`f"{member}"`が`"ProjectStatus.提案中"`のような表記になり警告メッセージの組み立てで問題になる、（b）プロジェクトのruff設定（`UP`ルール）が同パターンを検出し`enum.StrEnum`への置き換えを推奨する、という2点から、外部から観測できない実装の細部としてスタンダードライブラリの`StrEnum`（`class X(str, Enum)`と機能的に同等で、`__str__`が値をそのまま返す）を採用した。値・API契約・振る舞いに変更はない。
  - `app/schemas.py`: `Literal[*GRAPH]`によるエイリアス定義を削除し、`app.status_transitions`で定義した4つのEnumをそのままimportして`ProjectStatus`等として使用する形に変更した。`InterviewStepCreate`のデフォルト値（`prep_status`/`result`）も、文字列リテラルからEnumメンバー（例: `InterviewStepPrepStatus.準備中`）に変更した。
  - `app/models.py`: `Project.status`/`Task.status`/`InterviewStep.prep_status`/`InterviewStep.result`の型注釈を`Mapped[str]`から対応する`Mapped[ProjectStatus]`等に変更した。DB上のカラム型は従来通り`String`のままで、`sqlalchemy.Enum`型（CHECK制約が追加され挙動が変わる）には変更していない。あくまで型チェッカー向けの注釈変更のみで、DBスキーマ・マイグレーション・保存される値は変更なし。
  - `app/routers/*.py`は変更なし（Enum(str)はDB書き込み・比較・JSON直列化のいずれにおいてもplain strと透過的に扱えることをテストで確認済み）。
- 確認結果:
  - `uv run pytest -v`: 既存170件全てpass、warning 0件。
  - `uv run ruff check`: `All checks passed!`。
  - `uvx pyright`で`app/schemas.py`・`app/status_transitions.py`・`app/routers/*.py`・`app/models.py`を静的チェックし、`Literal[*...]`に起因する警告が解消されたことを確認（残存する2件のエラーはこのリファクタリング以前から存在する無関係な既知事項: `InterviewStep.date`カラム名がPythonの`date`型と同名で型推論が自己参照になる件、`get_hourly_rate`内の`ended_at - started_at`の`Optional`演算に関する件）。
  - 既存タスクの受け入れ条件・statusはこの変更により変えていない。
- セキュリティエバリュエーターのフィードバック（横断的リファクタリングレビュー、Critical/High相当の問題なし）:
  - 対象: `app/status_transitions.py`・`app/schemas.py`・`app/models.py`の変更差分（`git diff`）を確認し、`app/routers/projects.py`・`tasks.py`・`interview_steps.py`（Project/Task/InterviewStepの作成・更新エンドポイント）への影響を実機（`TestClient` + 生SQLite接続での確認）で検証した。
  - **StrEnumのシリアライズ/DB永続化**: `enum.StrEnum`は`str`のサブクラスであり、`__str__`・f-string展開・`json.dumps`のいずれも`repr()`形式（`ProjectStatus.提案中`等）ではなく素の値（`提案中`）を返すことを確認した。実際に`POST /projects`→`PATCH /projects/{id}`（ステータス変更、逆行遷移含む）をTestClient経由で実行し、(1) JSONレスポンスの`status`フィールドとwarningメッセージ（`f"{from_status} から {to_status} への変更です..."`）がいずれも素の日本語文字列であり内部Enum表現が漏れていないこと、(2) SQLiteに直接接続してカラムの生値を確認し、DBに保存される値も`typeof=text`の素の文字列（`見送り`等）でありEnum表現が紛れ込んでいないこと、をそれぞれ確認した。
  - **等価性・ハッシュ・辞書ルックアップ**: `StrEnum`メンバーは`str`と同じ`__eq__`/`__hash__`を持つため、DBから読み出した素の`str`（SQLAlchemyカラムは引き続き`String`型でEnum型に変更されていない）とPydanticが生成した`Enum`メンバーが混在しても、`PROJECT_STATUS_GRAPH`等のグラフ辞書のキー引きや`check_backward_transition`の比較（`to_status == from_status`等）が期待通り動作することを確認した（`GET /projects?status=...`のクエリパラメータでのフィルタ、`PATCH`時の`project.status`との比較のいずれも実機で正常動作を確認）。
  - **認証・mass assignment・論理削除・CORS・生SQL**: この変更は型注釈とEnum定義のみで、`app/routers/*.py`・`app/auth.py`・`app/main.py`は無変更であることを`git diff --stat`で確認済み。認証は引き続きグローバル依存関係（`Depends(verify_api_key)`）が全ルーターに適用されたまま、Create/Update/Read各スキーマの分離（mass assignment対策）・`is_deleted=false`フィルタ・論理削除方式にも変更なし。生SQL文字列結合は導入されていない。
  - **DB型注釈の妥当性**: `app/models.py`で`Mapped[ProjectStatus]`等に変更した一方、`mapped_column`自体は`String`型のままで`sqlalchemy.Enum`（CHECK制約付き）には変更していない点を確認した。これにより、DBレベルでの値の妥当性強制は導入時と変わらず（アプリケーション層のPydanticバリデーションのみに依存）だが、既存の設計・挙動を変更しないという今回のリファクタリングの目的（型チェッカー警告解消のみ）とは整合しており、新たな脆弱性の導入はない。
  - `uv run pytest -v`（170 passed）・`uv run ruff check`（All checks passed!）を再実行し、generatorの報告内容を再現確認した。
  - 総評: 型注釈のみの変更であり、認証・インジェクション・mass assignment・論理削除・CORS・シークレット管理のいずれの観点でも劣化は確認されなかった。Critical/High相当の指摘なし。既存タスクのstatusはこの評価により変更しない（横断的リファクタリングのレビューのため）。
- 性能エバリュエーターのフィードバック（横断的リファクタリングの動作検証、合格）:
  - 【判定】合格。`uv run pytest -v`・`uv run ruff check`いずれも問題なく、既存の受け入れ条件（ステータス遷移警告ロジックの5パターン、論理削除、親詳細の子情報非包含等）に回帰は無いことを確認した。既存タスクのstatusはこの評価により変更しない（横断的リファクタリングのレビューのため）。
  - **pytest**: `uv run pytest -v`で170件全てPASSしたことを確認した。加えて新しい運用ルール（warning 1件でも差し戻し）に基づき`uv run pytest -v 2>&1 | grep -iE "warning"`で全出力を確認したが、ヒットしたのは`test_..._returns_warning`/`test_..._has_no_warning`/`test_..._backward_transition_returns_warning`等のテスト名文字列のみで、`warnings summary`セクション自体が出力されておらず、DeprecationWarning等の実際のwarningは1件も発生していないことを確認した（StrEnum化・PEP 695ジェネリック構文はいずれもPython 3.12ネイティブ機能であり、非推奨API由来のwarningを生む要素ではないことも`app/status_transitions.py`のソースで確認済み）。
  - **ruff**: `uv run ruff check`で`All checks passed!`を確認した。`pyproject.toml`の`target-version = "py312"`・`requires-python = ">=3.12"`とPEP 695ジェネリック構文（`def f[StatusT: str](...)`）・`enum.StrEnum`の使用は整合しており、`select = ["E", "F", "I", "UP", "B"]`のいずれのルールにも抵触していない。
  - **ステータス遷移警告ロジックの5パターン回帰確認（個別）**: `tests/test_status_transitions.py`が引数にEnum型ではなく素の文字列リテラル（例: `"提案中"`）を渡して`PROJECT_STATUS_GRAPH`等（キーが`ProjectStatus`等のEnumメンバー）を引いていることを確認した。これは`StrEnum`が`str`と同じ`__eq__`/`__hash__`を持つため辞書ルックアップが文字列・Enumメンバーどちらでも透過的に成立することの実証にもなっており、リファクタリング後もこのテストファイルの17件（Project: 同一/隣接/飛び越え/逆行/枝分かれ5パターン、Task・InterviewStep.prep_status: 分岐なしのため同一/隣接/飛び越え/逆行4パターン、InterviewStep.result: 深さ2のため同一/隣接/逆行/枝分かれ4パターン、それぞれグラフ構造上該当しないパターンは対象外という設計方針は既存タスクのフィードバックと同一）が全てPASSしていることを確認した。
    - さらにルーター経由（実際のPATCHエンドポイント）でも、`tests/test_projects.py`の`test_update_project_status_forward_transition_has_no_warning`（同一・隣接・飛び越え相当をパラメータ化）・`test_update_project_status_backward_transition_returns_warning`・`test_update_project_status_branch_to_branch_transition_has_no_warning`・`test_update_project_without_status_change_has_no_warning`、`tests/test_tasks.py`・`tests/test_interview_steps.py`の同種テスト（prep_status/resultそれぞれの逆行・分岐先同士の遷移、および両方同時逆行時の複合warningメッセージ`test_update_interview_step_both_prep_status_and_result_backward_returns_combined_warning`）が全てPASSしていることを確認し、Enum化前と同じ5パターンの挙動が担保されていることを確かめた。
  - **DB永続化・シリアライズの実挙動確認（コード変更なしの手動確認、テストへの追加要求ではなく念のための実機確認）**: スクラッチパッド上でテスト用一時SQLite DBを作成し、`POST /projects`→`PATCH /projects/{id}`（提案中→見送り→提案中の逆行を含む）をTestClient経由で実行した上で、DBファイルに直接`sqlite3`で接続し`typeof(status)`を確認したところ`text`型の素の文字列（`提案中`）が格納されており、`StrEnum`の`repr`（`ProjectStatus.提案中`等）がDBやJSONレスポンスに紛れ込んでいないことを確認した。警告メッセージも`"見送り から 提案中 への変更です。意図的な変更か確認してください。"`と、Enum表現ではなく素の日本語文字列で組み立てられていることを確認した。
  - **論理削除・親詳細の子情報非包含・WorkLog・時給換算エンドポイントの回帰確認**: これらのテスト（`test_delete_*_marks_is_deleted_and_excludes_from_list`系、`test_get_*_detail_does_not_include_child_*_info`系、`test_start_work_log_allows_multiple_running_logs_for_same_task`・`test_start_work_log_allows_concurrent_logs_across_tasks_and_projects`、`test_hourly_rate_zero_total_hours_*`系等）はこのリファクタリングの変更範囲（`app/status_transitions.py`・`app/schemas.py`・`app/models.py`のステータス関連の型注釈のみ、`app/routers/*.py`は無変更）と直接関係しないが、`git diff --stat HEAD`で変更ファイルを確認した上で170件全件PASSにこれらが含まれていることを個別にログで確認し、意図しない副作用が無いことを確かめた。
  - **不足の指摘**: 無し。今回のリファクタリングは型注釈・Enum定義のみで振る舞いの変更を伴わないため、新規に必要となるテストケースは見当たらない。
  - コードは変更していない（`Read`のみで`Edit`は使用していない）。
