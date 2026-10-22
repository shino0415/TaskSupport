"""DBモデル定義とDB初期化のテスト。

- テーブル・カラムがテーブル設計通りに定義されていること
- is_deletedがデフォルトfalseで永続化されること
- 親子関係が外部キーとして表現されていること
- アプリケーション起動時にDBファイル・テーブルが自動生成されること
"""

from fastapi.testclient import TestClient
from sqlalchemy import BOOLEAN, DATE, DATETIME, INTEGER, TEXT, VARCHAR, insert, inspect
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base, build_engine

EXPECTED_TABLES = {
    "course",
    "assignment",
    "company",
    "interview_step",
    "company_task",
}


def make_initialized_engine():
    engine = build_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return engine


def test_all_tables_are_created():
    engine = make_initialized_engine()
    inspector = inspect(engine)
    assert set(inspector.get_table_names()) == EXPECTED_TABLES


def test_course_columns_match_spec():
    engine = make_initialized_engine()
    columns = {c["name"]: c for c in inspect(engine).get_columns("course")}

    assert set(columns) == {
        "id",
        "name",
        "day_of_week",
        "period",
        "academic_year",
        "term",
        "memo",
        "is_deleted",
    }
    assert columns["id"]["primary_key"] == 1
    assert isinstance(columns["id"]["type"], INTEGER)
    assert columns["name"]["nullable"] is False
    assert isinstance(columns["name"]["type"], VARCHAR)
    assert columns["day_of_week"]["nullable"] is True
    assert isinstance(columns["day_of_week"]["type"], VARCHAR)
    assert columns["period"]["nullable"] is True
    assert isinstance(columns["period"]["type"], INTEGER)
    assert columns["academic_year"]["nullable"] is True
    assert isinstance(columns["academic_year"]["type"], INTEGER)
    assert columns["term"]["nullable"] is True
    assert isinstance(columns["term"]["type"], VARCHAR)
    assert columns["memo"]["nullable"] is True
    assert isinstance(columns["memo"]["type"], TEXT)
    assert columns["is_deleted"]["nullable"] is False
    assert isinstance(columns["is_deleted"]["type"], BOOLEAN)


def test_assignment_columns_match_spec():
    engine = make_initialized_engine()
    columns = {c["name"]: c for c in inspect(engine).get_columns("assignment")}

    assert set(columns) == {
        "id",
        "course_id",
        "name",
        "status",
        "deadline",
        "submission_method",
        "memo",
        "is_deleted",
    }
    assert columns["id"]["primary_key"] == 1
    assert isinstance(columns["id"]["type"], INTEGER)
    assert columns["course_id"]["nullable"] is False
    assert isinstance(columns["course_id"]["type"], INTEGER)
    assert columns["name"]["nullable"] is False
    assert isinstance(columns["name"]["type"], VARCHAR)
    assert columns["status"]["nullable"] is False
    assert isinstance(columns["status"]["type"], VARCHAR)
    assert columns["deadline"]["nullable"] is True
    assert isinstance(columns["deadline"]["type"], DATETIME)
    assert columns["submission_method"]["nullable"] is True
    assert isinstance(columns["submission_method"]["type"], VARCHAR)
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


def test_company_task_columns_match_spec():
    engine = make_initialized_engine()
    columns = {c["name"]: c for c in inspect(engine).get_columns("company_task")}

    assert columns["id"]["primary_key"] == 1
    assert isinstance(columns["id"]["type"], INTEGER)
    assert columns["company_id"]["nullable"] is False
    assert isinstance(columns["company_id"]["type"], INTEGER)
    assert columns["name"]["nullable"] is False
    assert isinstance(columns["name"]["type"], VARCHAR)
    assert columns["status"]["nullable"] is False
    assert isinstance(columns["status"]["type"], VARCHAR)
    assert columns["memo"]["nullable"] is True
    assert isinstance(columns["memo"]["type"], TEXT)
    assert columns["is_deleted"]["nullable"] is False
    assert isinstance(columns["is_deleted"]["type"], BOOLEAN)
    # 稼働時間計測に関する項目（started_at/ended_at相当）を一切持たない
    assert "started_at" not in columns
    assert "ended_at" not in columns


def test_foreign_keys_represent_parent_child_relations():
    engine = make_initialized_engine()
    inspector = inspect(engine)

    assignment_fks = inspector.get_foreign_keys("assignment")
    assert len(assignment_fks) == 1
    assert assignment_fks[0]["referred_table"] == "course"
    assert assignment_fks[0]["constrained_columns"] == ["course_id"]
    assert assignment_fks[0]["referred_columns"] == ["id"]

    interview_step_fks = inspector.get_foreign_keys("interview_step")
    assert len(interview_step_fks) == 1
    assert interview_step_fks[0]["referred_table"] == "company"
    assert interview_step_fks[0]["constrained_columns"] == ["company_id"]
    assert interview_step_fks[0]["referred_columns"] == ["id"]

    company_task_fks = inspector.get_foreign_keys("company_task")
    assert len(company_task_fks) == 1
    assert company_task_fks[0]["referred_table"] == "company"
    assert company_task_fks[0]["constrained_columns"] == ["company_id"]
    assert company_task_fks[0]["referred_columns"] == ["id"]


def test_is_deleted_defaults_to_false_at_db_level():
    engine = make_initialized_engine()
    session = sessionmaker(bind=engine)()

    with engine.begin() as conn:
        # is_deletedを明示せずINSERTし、DB側のデフォルト値が適用されることを確認する
        conn.execute(
            insert(models.Company.__table__).values(name="テスト企業")
        )
        conn.execute(insert(models.Course.__table__).values(name="テスト授業"))

    company = session.query(models.Company).one()
    course = session.query(models.Course).one()
    assert company.is_deleted is False
    assert course.is_deleted is False

    with engine.begin() as conn:
        conn.execute(
            insert(models.Assignment.__table__).values(
                course_id=course.id,
                name="テスト課題",
                status="未着手",
            )
        )
    assignment = session.query(models.Assignment).one()
    assert assignment.is_deleted is False

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

    with engine.begin() as conn:
        conn.execute(
            insert(models.CompanyTask.__table__).values(
                company_id=company.id,
                name="テスト企業タスク",
                status="未着手",
            )
        )
    company_task = session.query(models.CompanyTask).one()
    assert company_task.is_deleted is False

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
