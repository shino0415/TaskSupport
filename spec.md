# 案件・選考トラッカー API 仕様書

個人用ツール。CrowdWorks等の受注案件の稼働時間管理と時給換算、就活の選考進捗管理を行う。
完全に独立した2つのドメイン（案件系／選考系）を1つのAPIにまとめる。

## 技術構成

- FastAPI + Pydantic
- SQLite + SQLAlchemy（`Base.metadata.create_all`で初期化、Alembic不使用）
- 認証: 簡易API Key方式（本人専用ツールのため）
- テスト: pytest（ステータス遷移の警告ロジックの単体テスト、FastAPI TestClientでのエンドポイントテスト）
- CI/CD: GitHub Actions（lint: ruff → test: pytest → build: Dockerマルチステージ → deploy）
- フロントエンドは別リポジトリ/別実装（本ドキュメントの対象外）。CORS設定が必要になる想定。

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
- 差し戻し回数: 0

### タスク: Task CRUD一式
- status: 未着手
- 概要: 案件配下のタスクの作成・一覧取得・更新（ステータス逆行警告含む）・論理削除ができるようにする。Task.statusの順序（未着手→処理中→完了）は確定済みのため決定待ちなしで実装できる。
- 受け入れ条件:
  - [ ] 案件配下にタスクを作成できる
  - [ ] 案件配下のタスク一覧取得では is_deleted=false のタスクのみが返る
  - [ ] タスクの各項目（ステータス含む）を更新できる
  - [ ] ステータスを逆行させて更新すると、200とともに警告フィールドが返る
  - [ ] 順当な遷移では警告フィールドは含まれない
  - [ ] タスクを削除すると is_deleted が true になり、以降の一覧取得結果に含まれなくなる
  - [ ] 存在しない案件id・タスクidを指定した場合はエラー（404等）が返る
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: WorkLog計測系エンドポイント
- status: 未着手
- 概要: タスクの稼働時間計測（開始・終了）、稼働ログ一覧取得、誤操作時の取り消し（論理削除）ができるようにする。同一タスク内の多重start、案件間・タスク間の同時進行を許可する。
- 受け入れ条件:
  - [ ] タスクに対して計測を開始すると、新規の稼働ログが作成され、開始時刻が記録される
  - [ ] 既に進行中（終了時刻未設定）のログがある状態で再度計測を開始しても、別レコードとして作成される
  - [ ] 進行中の稼働ログに対して計測終了を行うと、終了時刻が記録される
  - [ ] タスクの稼働ログ一覧取得では is_deleted=false のログのみが返る
  - [ ] 稼働ログを削除すると is_deleted が true になり、以降の一覧取得結果に含まれなくなる
  - [ ] 存在しないタスクid・稼働ログidを指定した場合はエラー（404等）が返る
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: 時給換算エンドポイント
- status: 未着手
- 概要: 案件の固定報酬額を配下タスクの合計稼働時間で割った時給換算値を返せるようにする。
- 受け入れ条件:
  - [ ] 案件の時給換算結果が、報酬額と配下タスクの合計稼働時間から算出されて返る
  - [ ] is_deleted=true のタスク・稼働ログは合計稼働時間の計算対象に含まれない
  - [ ] 配下タスクの合計稼働時間が0の場合でも、エラーで落ちずに一貫したレスポンスが返る
  - [ ] 進行中（終了時刻未設定）のログの扱いが一貫している
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: Company CRUD一式
- status: 未着手
- 概要: 選考先企業の登録・一覧取得・詳細取得・論理削除ができるようにする。
- 受け入れ条件:
  - [ ] 企業を登録できる
  - [ ] 企業一覧取得では is_deleted=false の企業のみが返る
  - [ ] 企業詳細取得では自テーブルの情報のみが返り、配下の選考ステップ情報は含まれない
  - [ ] 企業を削除すると is_deleted が true になり、以降の一覧・詳細取得結果に含まれなくなる
  - [ ] 存在しない企業idを指定した場合はエラー（404等）が返る
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: InterviewStep作成・参照・削除エンドポイント
- status: 未着手
- 概要: 企業配下の選考ステップの追加、一覧取得、論理削除ができるようにする。更新（PATCH）は別タスクで扱う。
- 受け入れ条件:
  - [ ] 企業配下に選考ステップを追加できる
  - [ ] 企業配下の選考ステップ一覧取得では is_deleted=false のステップのみが返る
  - [ ] 選考ステップを削除すると is_deleted が true になり、以降の一覧取得結果に含まれなくなる
  - [ ] 存在しない企業id・選考ステップidを指定した場合はエラー（404等）が返る
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: InterviewStep更新エンドポイント
- status: 未着手
- 概要: 選考ステップの項目更新と、prep_status・result双方の状態遷移グラフに基づく逆行遷移時の警告付与を実装する（resultは未定→通過・不通過の分岐構造）。
- 受け入れ条件:
  - [ ] 選考ステップの各項目を更新できる
  - [ ] prep_statusを逆行させて更新すると、200とともに警告フィールドが返る
  - [ ] resultを未定より前に戻すような明確な逆行を行うと、200とともに警告フィールドが返る
  - [ ] 通過→不通過のような枝分かれ先同士の遷移では警告フィールドは含まれない
  - [ ] 順当な遷移では警告フィールドは含まれない
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: 選考ステップ横断一覧エンドポイント（upcoming）
- status: 未着手
- 概要: 全企業を横断して、日付が近い順に選考ステップを一覧できるようにし、締切管理を可能にする。
- 受け入れ条件:
  - [ ] 全企業の選考ステップが、予定日の近い順（昇順）に並んで返る
  - [ ] is_deleted=true の選考ステップは含まれない
  - [ ] 予定日が未設定の選考ステップの扱いが一貫している
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: 稼働ログ横断一覧エンドポイント（running）
- status: 未着手
- 概要: 全案件・全タスクを横断して、現在進行中の稼働ログを一覧できるようにする。
- 受け入れ条件:
  - [ ] 終了時刻未設定かつ is_deleted=false の稼働ログが、全案件・全タスク横断で一覧取得できる
  - [ ] 各ログがどのタスク・案件に属するかが結果から判別できる
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: CI/CDパイプライン構築
- status: 未着手
- 概要: コード品質チェック・自動テスト・コンテナイメージビルドを自動化する。実際のデプロイ（デプロイ先の決定・接続）はこのタスクの対象外とする。
- 受け入れ条件:
  - [ ] コードのpushまたはpull request作成時にワークフローが自動実行される
  - [ ] lintに違反があるとワークフローが失敗する
  - [ ] テストに失敗があるとワークフローが失敗する
  - [ ] Dockerマルチステージビルドでイメージが正常にビルドできる
  - [ ] 実デプロイのステップは含まれない
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0

### タスク: フロントエンド実装（仮）とCORS設定
- status: 未着手
- 概要: 現時点では仮タスクとしてまとめて置いておく。バックエンド（案件系・選考系の全エンドポイント）が完成した段階で、フロントエンドの実装方針（使用スタック、デプロイ先、実際に許可するオリジン等）を改めて検討し、細かいタスクに分割する。このタスク自体は着手せず、分割待ちのプレースホルダーとして扱う。
- 受け入れ条件:
  - [ ] （分割前のプレースホルダーのため未定義。バックエンド完成後、フロントエンドの実装タスクとCORS設定タスクに分割してから着手する）
- セキュリティエバリュエーターのフィードバック: (未評価)
- 性能エバリュエーターのフィードバック: (未評価)
- 差し戻し回数: 0
