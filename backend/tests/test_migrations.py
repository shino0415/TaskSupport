"""マイグレーション管理基盤（Alembic）のテスト。

実行中の開発用DBファイル（app.db）には一切触れず、tmp_path配下に作った
一時ファイルDBに対してのみAlembicコマンドを実行する。

- 空のDBに`alembic upgrade head`を適用すると「## テーブル設計」どおりの全5テーブル
  （course/assignment/company/interview_step/company_task）が作成され、
  案件系テーブル（project/task/work_log）は残らないこと
- 最新の状態までの適用／直前の状態への巻き戻しの両方がコマンド操作（Config + alembic.command）
  で行えること
- 現在どの変更単位まで適用済みかを確認できること
- 試しに加えた1つのスキーマ変更（列追加）が、適用・巻き戻しの両方で意図通りに
  反映・復元されること
- 企業タスク（company_task）追加リビジョンが、初期リビジョン適用済み（データ入り）の
  DBに対しても既存データへ影響を与えず適用・巻き戻しできること
- 案件系→授業系置き換えリビジョンが、案件系・選考系のデータ入りDBに対して
  案件系3テーブルを削除して course/assignment を作成し、選考系データを一切変えないこと。
  巻き戻すと案件系3テーブルが元のスキーマの空テーブルとして復元されること
- この仕組み（alembic upgrade head）で準備したDBに対しても、既存のFastAPIアプリ
  （選考系の全3リソース）が問題なく動作すること
"""

from datetime import date, datetime
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
from app.database import Base, build_engine, get_db
from app.main import app

BACKEND_DIR = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}

PROJECT_SYSTEM_TABLES = {"project", "task", "work_log"}
SELECTION_TABLES = ("company", "interview_step", "company_task")
EXPECTED_TABLES = {
    "course",
    "assignment",
    "company",
    "interview_step",
    "company_task",
}
EXPECTED_COLUMNS = {
    "course": {
        "id",
        "name",
        "day_of_week",
        "period",
        "academic_year",
        "term",
        "memo",
        "is_deleted",
    },
    "assignment": {
        "id",
        "course_id",
        "name",
        "status",
        "deadline",
        "submission_method",
        "memo",
        "is_deleted",
    },
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
    "company_task": {"id", "company_id", "name", "status", "memo", "is_deleted"},
}


def make_alembic_config(database_url: str) -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("sqlalchemy.url", database_url)
    return cfg


def get_current_revision(engine: sa.Engine) -> str | None:
    with engine.connect() as conn:
        context = MigrationContext.configure(conn)
        return context.get_current_revision()


INITIAL_REVISION = "522c9ff7a611"
COMPANY_TASK_REVISION = "974953724e96"
COURSE_REVISION = "b7c3e1a9d4f2"


def table_names(engine: sa.Engine) -> set[str]:
    return set(inspect(engine).get_table_names()) - {"alembic_version"}


def describe_table(engine: sa.Engine, table: str) -> dict:
    """スキーマ比較用に、列（名前・型・NULL可否・デフォルト・主キー）と外部キーを取り出す。"""
    inspector = inspect(engine)
    columns = [
        (
            c["name"],
            str(c["type"]),
            c["nullable"],
            str(c["default"]) if c["default"] is not None else None,
            c["primary_key"],
        )
        for c in inspector.get_columns(table)
    ]
    foreign_keys = sorted(
        (tuple(fk["constrained_columns"]), fk["referred_table"], tuple(fk["referred_columns"]))
        for fk in inspector.get_foreign_keys(table)
    )
    return {"columns": columns, "foreign_keys": foreign_keys}


def snapshot_rows(engine: sa.Engine, tables) -> dict[str, list[tuple]]:
    with engine.connect() as conn:
        return {
            table: [
                tuple(row) for row in conn.execute(sa.text(f"SELECT * FROM {table} ORDER BY id"))
            ]
            for table in tables
        }


# --- 空DBへの適用で全5テーブルが作成される ---


def test_upgrade_head_creates_all_tables_matching_spec(tmp_path):
    db_path = tmp_path / "migration_head.db"
    cfg = make_alembic_config(f"sqlite:///{db_path}")

    command.upgrade(cfg, "head")

    engine = build_engine(f"sqlite:///{db_path}")
    inspector = inspect(engine)
    assert table_names(engine) == EXPECTED_TABLES
    assert not PROJECT_SYSTEM_TABLES & table_names(engine)
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
        conn.execute(sa.insert(models.Course.__table__).values(name="テスト授業"))
    session = sessionmaker(bind=engine)()
    company = session.query(models.Company).one()
    assert company.is_deleted is False
    course = session.query(models.Course).one()
    assert course.is_deleted is False
    with engine.begin() as conn:
        conn.execute(
            sa.insert(models.Assignment.__table__).values(
                course_id=course.id, name="テスト課題", status="未着手"
            )
        )
    assert session.query(models.Assignment).one().is_deleted is False
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

    # 直前の変更単位（案件系→授業系の置き換え）のみを巻き戻す。それより前の変更単位
    # （company/interview_step/company_task）のテーブルには影響しない。
    command.downgrade(cfg, "-1")
    assert table_names(engine) == PROJECT_SYSTEM_TABLES | set(SELECTION_TABLES)

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


# --- 企業タスク（company_task）追加リビジョンが既存データに影響しないこと ---


def insert_legacy_project(conn: sa.Connection, name: str) -> int:
    """案件系のORMモデルは削除済みのため、旧スキーマのprojectテーブルへは素のSQLで投入する。"""
    result = conn.execute(
        sa.text(
            "INSERT INTO project (name, client_name, status, reward, applied_date, platform) "
            "VALUES (:name, '既存クライアント', '提案中', 10000, '2026-01-01', 'CrowdWorks')"
        ),
        {"name": name},
    )
    return result.lastrowid


def test_company_task_migration_adds_table_without_affecting_existing_data(tmp_path):
    """既存DB（開発用DBを想定）を模し、初期リビジョンまで適用済み・かつ
    既存5テーブルにデータが入った状態から company_task 追加リビジョンを適用しても、
    既存データが一切変化せず、company_taskテーブルのみが追加で使えるようになることを
    確認する。巻き戻しでも既存データが保たれることも合わせて確認する。
    """
    db_path = tmp_path / "migration_company_task_existing_data.db"
    cfg = make_alembic_config(f"sqlite:///{db_path}")
    engine = build_engine(f"sqlite:///{db_path}")

    # 既存DBを模して、企業タスク追加より前の初期リビジョンまでだけ適用する
    command.upgrade(cfg, INITIAL_REVISION)
    assert "company_task" not in table_names(engine)

    with engine.begin() as conn:
        conn.execute(sa.insert(models.Company.__table__).values(name="既存企業"))
        insert_legacy_project(conn, "既存案件")
    before = snapshot_rows(engine, ["company", "project"])

    command.upgrade(cfg, COMPANY_TASK_REVISION)
    assert "company_task" in table_names(engine)
    assert snapshot_rows(engine, ["company", "project"]) == before

    # 追加された company_task テーブルが実際に使えること
    existing_company_id = before["company"][0][0]
    with engine.begin() as conn:
        conn.execute(
            sa.insert(models.CompanyTask.__table__).values(
                company_id=existing_company_id, name="企業タスク", status="未着手"
            )
        )
    session = sessionmaker(bind=engine)()
    company_task = session.query(models.CompanyTask).one()
    assert company_task.company_id == existing_company_id
    assert company_task.is_deleted is False
    session.close()

    # 巻き戻し後もcompany_task以外の既存データは影響を受けない
    command.downgrade(cfg, INITIAL_REVISION)
    assert "company_task" not in table_names(engine)
    assert snapshot_rows(engine, ["company", "project"]) == before


# --- 案件系→授業系置き換えリビジョン ---


def seed_pre_course_db(engine: sa.Engine) -> None:
    """置き換え直前のリビジョン（開発用DBと同じスキーマ）に、案件系・選考系の両方のデータを入れる。"""
    with engine.begin() as conn:
        project_id = insert_legacy_project(conn, "既存案件")
        task_id = conn.execute(
            sa.text(
                "INSERT INTO task (project_id, name, status) VALUES (:pid, '既存タスク', '処理中')"
            ),
            {"pid": project_id},
        ).lastrowid
        conn.execute(
            sa.text(
                "INSERT INTO work_log (task_id, started_at) "
                "VALUES (:tid, '2026-01-01 09:00:00')"
            ),
            {"tid": task_id},
        )

        company_ids = [
            conn.execute(sa.insert(models.Company.__table__).values(name=name)).lastrowid
            for name in ("既存企業A", "既存企業B")
        ]
        conn.execute(
            sa.update(models.Company.__table__)
            .where(models.Company.__table__.c.id == company_ids[1])
            .values(is_deleted=True)
        )
        conn.execute(
            sa.insert(models.InterviewStep.__table__),
            [
                {
                    "company_id": company_ids[0],
                    "type": "一次面接",
                    "date": date(2026, 3, 1),
                    "prep_status": "準備万端",
                    "result": "未定",
                    "memo": "メモ",
                },
                {
                    "company_id": company_ids[1],
                    "type": "書類選考",
                    "date": None,
                    "prep_status": "完了",
                    "result": "不通過",
                    "memo": None,
                    "is_deleted": True,
                },
            ],
        )
        conn.execute(
            sa.insert(models.CompanyTask.__table__),
            [
                {"company_id": company_ids[0], "name": "企業タスク", "status": "処理中"},
                {
                    "company_id": company_ids[0],
                    "name": "削除済み",
                    "status": "完了",
                    "is_deleted": True,
                },
            ],
        )


def test_course_migration_replaces_project_tables_and_keeps_selection_data(tmp_path):
    db_path = tmp_path / "migration_course_existing_data.db"
    cfg = make_alembic_config(f"sqlite:///{db_path}")
    engine = build_engine(f"sqlite:///{db_path}")

    command.upgrade(cfg, COMPANY_TASK_REVISION)
    seed_pre_course_db(engine)
    selection_before = snapshot_rows(engine, SELECTION_TABLES)
    selection_schema_before = {t: describe_table(engine, t) for t in SELECTION_TABLES}

    command.upgrade(cfg, "head")

    assert get_current_revision(engine) == COURSE_REVISION
    assert table_names(engine) == EXPECTED_TABLES
    assert not PROJECT_SYSTEM_TABLES & table_names(engine)
    for table in ("course", "assignment"):
        actual_columns = {c["name"] for c in inspect(engine).get_columns(table)}
        assert actual_columns == EXPECTED_COLUMNS[table]

    # 選考系はデータもスキーマも適用前と完全に一致する
    assert snapshot_rows(engine, SELECTION_TABLES) == selection_before
    assert {t: describe_table(engine, t) for t in SELECTION_TABLES} == selection_schema_before

    # 作成された course/assignment は空で、実際に使える
    assert snapshot_rows(engine, ["course", "assignment"]) == {"course": [], "assignment": []}
    with engine.begin() as conn:
        course_id = conn.execute(
            sa.insert(models.Course.__table__).values(
                name="授業", day_of_week="月", period=2, academic_year=2026, term="前期"
            )
        ).lastrowid
        conn.execute(
            sa.insert(models.Assignment.__table__).values(
                course_id=course_id,
                name="課題",
                status="未着手",
                deadline=datetime(2026, 5, 1, 23, 59),
                submission_method="WebClass",
            )
        )
    session = sessionmaker(bind=engine)()
    assignment = session.query(models.Assignment).one()
    assert assignment.course_id == course_id
    assert assignment.deadline == datetime(2026, 5, 1, 23, 59)
    assert assignment.is_deleted is False
    session.close()


def test_course_migration_schema_matches_models(tmp_path):
    """マイグレーション適用後のスキーマが、アプリのモデル定義（create_all相当）と一致する。"""
    db_path = tmp_path / "migration_vs_models.db"
    cfg = make_alembic_config(f"sqlite:///{db_path}")
    command.upgrade(cfg, "head")
    migrated = build_engine(f"sqlite:///{db_path}")

    created = build_engine(f"sqlite:///{tmp_path / 'create_all.db'}")
    Base.metadata.create_all(bind=created)

    for table in EXPECTED_TABLES:
        assert describe_table(migrated, table) == describe_table(created, table)


def test_course_migration_downgrade_restores_empty_project_tables(tmp_path):
    db_path = tmp_path / "migration_course_downgrade.db"
    cfg = make_alembic_config(f"sqlite:///{db_path}")
    engine = build_engine(f"sqlite:///{db_path}")

    command.upgrade(cfg, COMPANY_TASK_REVISION)
    project_schema_before = {t: describe_table(engine, t) for t in PROJECT_SYSTEM_TABLES}
    seed_pre_course_db(engine)
    selection_before = snapshot_rows(engine, SELECTION_TABLES)

    command.upgrade(cfg, "head")
    with engine.begin() as conn:
        conn.execute(sa.insert(models.Course.__table__).values(name="消える授業"))
    command.downgrade(cfg, "-1")

    assert get_current_revision(engine) == COMPANY_TASK_REVISION
    assert table_names(engine) == PROJECT_SYSTEM_TABLES | set(SELECTION_TABLES)
    # 案件系は元のスキーマで復元されるが、削除したデータは戻らない
    assert {t: describe_table(engine, t) for t in PROJECT_SYSTEM_TABLES} == project_schema_before
    assert snapshot_rows(engine, PROJECT_SYSTEM_TABLES) == {t: [] for t in PROJECT_SYSTEM_TABLES}
    assert snapshot_rows(engine, SELECTION_TABLES) == selection_before

    # 復元した案件系テーブルにも旧スキーマどおりに投入できる
    with engine.begin() as conn:
        insert_legacy_project(conn, "復元後の案件")

    # 再適用も可能
    command.upgrade(cfg, "head")
    assert table_names(engine) == EXPECTED_TABLES
    assert snapshot_rows(engine, SELECTION_TABLES) == selection_before


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


def test_project_endpoints_do_not_exist_against_migrated_db(migrated_client):
    assert migrated_client.get("/projects", headers=AUTH_HEADERS).status_code == 404
    assert migrated_client.get("/work-logs/running", headers=AUTH_HEADERS).status_code == 404


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


def test_company_task_status_warning_works_against_migrated_db(migrated_client):
    client = migrated_client
    company_id = client.post(
        "/companies", json={"name": "テスト株式会社"}, headers=AUTH_HEADERS
    ).json()["id"]
    task_response = client.post(
        f"/companies/{company_id}/company-tasks",
        json={"name": "企業タスク", "status": "完了"},
        headers=AUTH_HEADERS,
    )
    assert task_response.status_code == 201
    task_id = task_response.json()["id"]

    backward = client.patch(
        f"/company-tasks/{task_id}", json={"status": "処理中"}, headers=AUTH_HEADERS
    )
    assert backward.status_code == 200
    assert backward.json()["status"] == "処理中"
    assert backward.json()["warning"] is not None
