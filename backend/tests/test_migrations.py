"""マイグレーション管理基盤（Alembic）のテスト。

実行中の開発用DBファイル（app.db）には一切触れず、tmp_path配下に作った
一時ファイルDBに対してのみAlembicコマンドを実行する。

- 空のDBに`alembic upgrade head`を適用すると「## テーブル設計」通りの全5テーブルが
  作成されること
- 最新の状態までの適用／直前の状態への巻き戻しの両方がコマンド操作（Config + alembic.command）
  で行えること
- 現在どの変更単位まで適用済みかを確認できること
- 試しに加えた1つのスキーマ変更（列追加）が、適用・巻き戻しの両方で意図通りに
  反映・復元されること
- この仕組み（alembic upgrade head）で準備したDBに対しても、既存のFastAPIアプリ
  （案件系・選考系の全5リソース）が問題なく動作すること
"""

from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlalchemy.orm import sessionmaker

from app import models
from app.auth import API_KEY_ENV_VAR
from app.database import build_engine, get_db
from app.main import app

BACKEND_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}

EXPECTED_TABLES = {"project", "task", "work_log", "company", "interview_step"}
EXPECTED_COLUMNS = {
    "project": {
        "id",
        "name",
        "client_name",
        "status",
        "reward",
        "applied_date",
        "deadline",
        "platform",
        "memo",
        "is_deleted",
    },
    "task": {"id", "project_id", "name", "status", "memo", "is_deleted"},
    "work_log": {"id", "task_id", "started_at", "ended_at", "memo", "is_deleted"},
    "company": {"id", "name", "is_deleted"},
    "interview_step": {
        "id",
        "company_id",
        "type",
        "date",
        "prep_status",
        "result",
        "memo",
        "is_deleted",
    },
}


def make_alembic_config(database_url: str) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("sqlalchemy.url", database_url)
    return cfg


def get_current_revision(engine: sa.Engine) -> str | None:
    with engine.connect() as conn:
        context = MigrationContext.configure(conn)
        return context.get_current_revision()


# --- 空DBへの適用で全5テーブルが作成される ---


def test_upgrade_head_creates_all_tables_matching_spec(tmp_path):
    db_path = tmp_path / "migration_head.db"
    cfg = make_alembic_config(f"sqlite:///{db_path}")

    command.upgrade(cfg, "head")

    engine = build_engine(f"sqlite:///{db_path}")
    inspector = inspect(engine)
    assert set(inspector.get_table_names()) - {"alembic_version"} == EXPECTED_TABLES
    for table, expected_columns in EXPECTED_COLUMNS.items():
        actual_columns = {c["name"] for c in inspector.get_columns(table)}
        assert actual_columns == expected_columns


def test_upgrade_head_is_deleted_defaults_to_false_at_db_level(tmp_path):
    db_path = tmp_path / "migration_is_deleted.db"
    cfg = make_alembic_config(f"sqlite:///{db_path}")
    command.upgrade(cfg, "head")

    engine = build_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.execute(sa.insert(models.Company.__table__).values(name="テスト企業"))
    session = sessionmaker(bind=engine)()
    company = session.query(models.Company).one()
    assert company.is_deleted is False
    session.close()


# --- 現在どの変更単位まで適用済みかを確認できる ---


def test_current_revision_tracks_applied_state(tmp_path):
    db_path = tmp_path / "migration_current.db"
    engine = build_engine(f"sqlite:///{db_path}")
    # まだ何も適用していないDBはalembic_versionテーブル自体が存在せず、
    # 現在のリビジョンはNone（未適用）として扱われる
    assert get_current_revision(engine) is None

    cfg = make_alembic_config(f"sqlite:///{db_path}")
    command.upgrade(cfg, "head")
    head_revision = ScriptDirectory.from_config(cfg).get_current_head()
    assert get_current_revision(engine) == head_revision

    command.downgrade(cfg, "base")
    assert get_current_revision(engine) is None


# --- 最新の状態までの適用／直前の状態への巻き戻しがコマンド操作で行える ---


def test_downgrade_and_reupgrade_roundtrip(tmp_path):
    db_path = tmp_path / "migration_roundtrip.db"
    cfg = make_alembic_config(f"sqlite:///{db_path}")
    engine = build_engine(f"sqlite:///{db_path}")

    command.upgrade(cfg, "head")
    assert EXPECTED_TABLES.issubset(set(inspect(engine).get_table_names()))

    command.downgrade(cfg, "-1")
    assert set(inspect(engine).get_table_names()) & EXPECTED_TABLES == set()

    command.upgrade(cfg, "head")
    assert EXPECTED_TABLES.issubset(set(inspect(engine).get_table_names()))


# --- 試しに加えた1つのスキーマ変更（列追加）の適用・巻き戻し ---


def test_trial_column_addition_can_be_applied_and_rolled_back(tmp_path):
    """将来の「1つの変更単位」の適用・巻き戻しがAlembicの仕組みで意図通り動くことを検証する。

    実際のリビジョンファイルとしては残さない（実装時に手動でも同じ手順を確認済み。詳細は
    spec.mdの実装メモを参照）。ここではリビジョンファイルのupgrade()/downgrade()が内部で
    呼び出すのと同じAlembic Operations APIを直接使い、companyテーブルへの列追加・削除が
    このプロジェクトの設定（render_as_batch=True）で正しく反映・復元されることを確認する。
    """
    db_path = tmp_path / "migration_trial.db"
    cfg = make_alembic_config(f"sqlite:///{db_path}")
    command.upgrade(cfg, "head")

    engine = build_engine(f"sqlite:///{db_path}")

    def company_columns() -> set[str]:
        return {c["name"] for c in inspect(engine).get_columns("company")}

    assert "note" not in company_columns()

    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        op = Operations(ctx)
        with op.batch_alter_table("company") as batch_op:
            batch_op.add_column(sa.Column("note", sa.Text(), nullable=True))
    assert "note" in company_columns()

    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        op = Operations(ctx)
        with op.batch_alter_table("company") as batch_op:
            batch_op.drop_column("note")
    assert "note" not in company_columns()


# --- この仕組みで準備したDBに対して既存のアプリ機能が全て通過する ---


@pytest.fixture
def migrated_client(monkeypatch, tmp_path):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)

    db_path = tmp_path / "migrated_app.db"
    cfg = make_alembic_config(f"sqlite:///{db_path}")
    command.upgrade(cfg, "head")

    engine = build_engine(f"sqlite:///{db_path}")
    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_project_task_crud_works_against_migrated_db(migrated_client):
    client = migrated_client

    project_payload = {
        "name": "テスト案件",
        "client_name": "テストクライアント",
        "status": "提案中",
        "reward": 50000,
        "applied_date": "2026-01-01",
        "deadline": "2026-02-01",
        "platform": "CrowdWorks",
        "memo": "メモ",
    }
    project_response = client.post("/projects", json=project_payload, headers=AUTH_HEADERS)
    assert project_response.status_code == 201
    project_id = project_response.json()["id"]

    # 親詳細取得（子であるtaskの情報を含まない）
    detail = client.get(f"/projects/{project_id}", headers=AUTH_HEADERS)
    assert detail.status_code == 200
    assert "tasks" not in detail.json()

    task_payload = {"name": "テストタスク", "status": "未着手", "memo": "メモ"}
    task_response = client.post(
        f"/projects/{project_id}/tasks", json=task_payload, headers=AUTH_HEADERS
    )
    assert task_response.status_code == 201
    task_id = task_response.json()["id"]

    start_response = client.post(f"/tasks/{task_id}/work-logs/start", headers=AUTH_HEADERS)
    assert start_response.status_code == 201

    # 論理削除後、一覧から除外される
    delete_response = client.delete(f"/projects/{project_id}", headers=AUTH_HEADERS)
    assert delete_response.status_code == 204
    list_response = client.get("/projects", headers=AUTH_HEADERS)
    assert project_id not in [p["id"] for p in list_response.json()]


def test_company_interview_step_crud_works_against_migrated_db(migrated_client):
    client = migrated_client

    company_response = client.post(
        "/companies", json={"name": "テスト株式会社"}, headers=AUTH_HEADERS
    )
    assert company_response.status_code == 201
    company_id = company_response.json()["id"]

    step_payload = {"type": "一次面接", "date": "2026-03-01", "memo": "メモ"}
    step_response = client.post(
        f"/companies/{company_id}/interview-steps", json=step_payload, headers=AUTH_HEADERS
    )
    assert step_response.status_code == 201
    step_id = step_response.json()["id"]

    delete_response = client.delete(f"/interview-steps/{step_id}", headers=AUTH_HEADERS)
    assert delete_response.status_code == 204
    list_response = client.get(
        f"/companies/{company_id}/interview-steps", headers=AUTH_HEADERS
    )
    assert step_id not in [s["id"] for s in list_response.json()]
