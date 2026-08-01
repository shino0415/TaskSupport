"""DBモデル定義とDB初期化のテスト。

- テーブル・カラムがテーブル設計通りに定義されていること
- is_deletedがデフォルトfalseで永続化されること
- 親子関係が外部キーとして表現されていること
- アプリケーション起動時にDBファイル・テーブルが自動生成されること
"""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import BOOLEAN, DATE, DATETIME, INTEGER, TEXT, VARCHAR, insert, inspect
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base, build_engine

EXPECTED_TABLES = {"project", "task", "work_log", "company", "interview_step"}


def make_initialized_engine():
    engine = build_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return engine


def test_all_tables_are_created():
    engine = make_initialized_engine()
    inspector = inspect(engine)
    assert set(inspector.get_table_names()) == EXPECTED_TABLES


def test_project_columns_match_spec():
    engine = make_initialized_engine()
    columns = {c["name"]: c for c in inspect(engine).get_columns("project")}

    assert columns["id"]["primary_key"] == 1
    assert isinstance(columns["id"]["type"], INTEGER)
    assert columns["name"]["nullable"] is False
    assert isinstance(columns["name"]["type"], VARCHAR)
    assert columns["client_name"]["nullable"] is False
    assert isinstance(columns["client_name"]["type"], VARCHAR)
    assert columns["status"]["nullable"] is False
    assert isinstance(columns["status"]["type"], VARCHAR)
    assert columns["reward"]["nullable"] is False
    assert isinstance(columns["reward"]["type"], INTEGER)
    assert columns["applied_date"]["nullable"] is False
    assert isinstance(columns["applied_date"]["type"], DATE)
    assert columns["deadline"]["nullable"] is True
    assert isinstance(columns["deadline"]["type"], DATE)
    assert columns["platform"]["nullable"] is False
    assert isinstance(columns["platform"]["type"], VARCHAR)
    assert columns["memo"]["nullable"] is True
    assert isinstance(columns["memo"]["type"], TEXT)
    assert columns["is_deleted"]["nullable"] is False
    assert isinstance(columns["is_deleted"]["type"], BOOLEAN)


def test_task_columns_match_spec():
    engine = make_initialized_engine()
    columns = {c["name"]: c for c in inspect(engine).get_columns("task")}

    assert columns["id"]["primary_key"] == 1
    assert isinstance(columns["id"]["type"], INTEGER)
    assert columns["project_id"]["nullable"] is False
    assert isinstance(columns["project_id"]["type"], INTEGER)
    assert columns["name"]["nullable"] is False
    assert isinstance(columns["name"]["type"], VARCHAR)
    assert columns["status"]["nullable"] is False
    assert isinstance(columns["status"]["type"], VARCHAR)
    assert columns["memo"]["nullable"] is True
    assert isinstance(columns["memo"]["type"], TEXT)
    assert columns["is_deleted"]["nullable"] is False
    assert isinstance(columns["is_deleted"]["type"], BOOLEAN)


def test_work_log_columns_match_spec():
    engine = make_initialized_engine()
    columns = {c["name"]: c for c in inspect(engine).get_columns("work_log")}

    assert columns["id"]["primary_key"] == 1
    assert isinstance(columns["id"]["type"], INTEGER)
    assert columns["task_id"]["nullable"] is False
    assert isinstance(columns["task_id"]["type"], INTEGER)
    assert columns["started_at"]["nullable"] is True
    assert isinstance(columns["started_at"]["type"], DATETIME)
    assert columns["ended_at"]["nullable"] is True
    assert isinstance(columns["ended_at"]["type"], DATETIME)
    assert columns["memo"]["nullable"] is True
    assert isinstance(columns["memo"]["type"], TEXT)
    assert columns["is_deleted"]["nullable"] is False
    assert isinstance(columns["is_deleted"]["type"], BOOLEAN)


def test_company_columns_match_spec():
    engine = make_initialized_engine()
    columns = {c["name"]: c for c in inspect(engine).get_columns("company")}

    assert columns["id"]["primary_key"] == 1
    assert isinstance(columns["id"]["type"], INTEGER)
    assert columns["name"]["nullable"] is False
    assert isinstance(columns["name"]["type"], VARCHAR)
    assert columns["is_deleted"]["nullable"] is False
    assert isinstance(columns["is_deleted"]["type"], BOOLEAN)


def test_interview_step_columns_match_spec():
    engine = make_initialized_engine()
    columns = {c["name"]: c for c in inspect(engine).get_columns("interview_step")}

    assert columns["id"]["primary_key"] == 1
    assert isinstance(columns["id"]["type"], INTEGER)
    assert columns["company_id"]["nullable"] is False
    assert isinstance(columns["company_id"]["type"], INTEGER)
    assert columns["type"]["nullable"] is False
    assert isinstance(columns["type"]["type"], VARCHAR)
    assert columns["date"]["nullable"] is True
    assert isinstance(columns["date"]["type"], DATE)
    assert columns["prep_status"]["nullable"] is False
    assert isinstance(columns["prep_status"]["type"], VARCHAR)
    assert columns["result"]["nullable"] is False
    assert isinstance(columns["result"]["type"], VARCHAR)
    assert columns["memo"]["nullable"] is True
    assert isinstance(columns["memo"]["type"], TEXT)
    assert columns["is_deleted"]["nullable"] is False
    assert isinstance(columns["is_deleted"]["type"], BOOLEAN)


def test_foreign_keys_represent_parent_child_relations():
    engine = make_initialized_engine()
    inspector = inspect(engine)

    task_fks = inspector.get_foreign_keys("task")
    assert len(task_fks) == 1
    assert task_fks[0]["referred_table"] == "project"
    assert task_fks[0]["constrained_columns"] == ["project_id"]
    assert task_fks[0]["referred_columns"] == ["id"]

    work_log_fks = inspector.get_foreign_keys("work_log")
    assert len(work_log_fks) == 1
    assert work_log_fks[0]["referred_table"] == "task"
    assert work_log_fks[0]["constrained_columns"] == ["task_id"]
    assert work_log_fks[0]["referred_columns"] == ["id"]

    interview_step_fks = inspector.get_foreign_keys("interview_step")
    assert len(interview_step_fks) == 1
    assert interview_step_fks[0]["referred_table"] == "company"
    assert interview_step_fks[0]["constrained_columns"] == ["company_id"]
    assert interview_step_fks[0]["referred_columns"] == ["id"]


def test_is_deleted_defaults_to_false_at_db_level():
    engine = make_initialized_engine()
    session = sessionmaker(bind=engine)()

    with engine.begin() as conn:
        # is_deletedを明示せずINSERTし、DB側のデフォルト値が適用されることを確認する
        conn.execute(
            insert(models.Company.__table__).values(name="テスト企業")
        )
        conn.execute(
            insert(models.Project.__table__).values(
                name="テスト案件",
                client_name="テストクライアント",
                status="提案中",
                reward=10000,
                applied_date=date(2026, 1, 1),
                platform="CrowdWorks",
            )
        )

    company = session.query(models.Company).one()
    project = session.query(models.Project).one()
    assert company.is_deleted is False
    assert project.is_deleted is False

    with engine.begin() as conn:
        conn.execute(
            insert(models.Task.__table__).values(
                project_id=project.id,
                name="テストタスク",
                status="未着手",
            )
        )
    task = session.query(models.Task).one()
    assert task.is_deleted is False

    with engine.begin() as conn:
        conn.execute(insert(models.WorkLog.__table__).values(task_id=task.id))
    work_log = session.query(models.WorkLog).one()
    assert work_log.is_deleted is False

    with engine.begin() as conn:
        conn.execute(
            insert(models.InterviewStep.__table__).values(
                company_id=company.id,
                type="書類選考",
                prep_status="準備中",
                result="未定",
            )
        )
    interview_step = session.query(models.InterviewStep).one()
    assert interview_step.is_deleted is False

    session.close()


def test_app_startup_creates_db_file_and_tables(tmp_path, monkeypatch):
    import app.database as database_module
    import app.main as main_module

    db_path = tmp_path / "startup_test.db"
    assert not db_path.exists()

    test_engine = database_module.build_engine(f"sqlite:///{db_path}")
    monkeypatch.setattr(database_module, "engine", test_engine)
    monkeypatch.setattr(database_module, "SessionLocal", sessionmaker(bind=test_engine))

    with TestClient(main_module.app):
        # withブロックに入ることでlifespanのstartupが実行され、init_db()が呼ばれる
        pass

    assert db_path.exists()
    inspector = inspect(test_engine)
    assert set(inspector.get_table_names()) == EXPECTED_TABLES
