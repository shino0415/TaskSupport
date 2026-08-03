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
