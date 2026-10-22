"""デモ環境用シードデータ投入スクリプトのテスト。

実行中の開発用DBファイル（app.db）を汚染しないよう、tmp_path配下に作った
一時ファイルDBに対してのみ検証する。
"""

import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.orm import sessionmaker

from app import models
from app.database import Base, build_engine
from app.main import app as fastapi_app
from app.seed_demo_data import seed

BACKEND_DIR = Path(__file__).resolve().parents[1]

EXPECTED_COUNTS = {
    "company": 3,
    "interview_step": 5,
    "company_task": 4,
}


def make_session(tmp_path, name: str):
    engine = build_engine(f"sqlite:///{tmp_path / name}")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)(), engine


# --- 各テーブルに1件以上のダミーデータが投入される ---


def test_seed_populates_every_table_with_expected_counts(tmp_path):
    session, _ = make_session(tmp_path, "seed_counts.db")
    counts = seed(session)
    session.commit()

    assert counts == EXPECTED_COUNTS
    for model, expected_count in [
        (models.Company, EXPECTED_COUNTS["company"]),
        (models.InterviewStep, EXPECTED_COUNTS["interview_step"]),
        (models.CompanyTask, EXPECTED_COUNTS["company_task"]),
    ]:
        assert session.query(model).count() == expected_count
        assert expected_count >= 1

    session.close()


# --- 横断系エンドポイントでも何らかのデータが確認できる状態になる ---


def test_seed_produces_data_visible_via_upcoming_steps(tmp_path):
    session, _ = make_session(tmp_path, "seed_cross_cutting.db")
    seed(session)
    session.commit()

    today = date.today()
    upcoming_steps = (
        session.query(models.InterviewStep)
        .join(models.Company, models.InterviewStep.company_id == models.Company.id)
        .filter(
            models.InterviewStep.is_deleted.is_(False),
            models.Company.is_deleted.is_(False),
            models.InterviewStep.date.is_not(None),
            models.InterviewStep.date >= today - timedelta(days=1),
        )
        .all()
    )
    assert len(upcoming_steps) >= 1

    session.close()


# --- 実在の人物・企業を想起させる個人情報が含まれない（簡易チェック） ---


def test_seed_data_contains_no_email_addresses(tmp_path):
    session, _ = make_session(tmp_path, "seed_pii.db")
    seed(session)
    session.commit()

    text_fields = []
    for company in session.query(models.Company).all():
        text_fields.append(company.name)
    for step in session.query(models.InterviewStep).all():
        text_fields += [step.type, step.memo]
    for company_task in session.query(models.CompanyTask).all():
        text_fields += [company_task.name, company_task.memo]

    for value in text_fields:
        if value is not None:
            assert "@" not in value

    session.close()


# --- 再実行しても常に同じ内容のダミーデータのみが残る（冪等性） ---


def test_seed_is_idempotent_when_run_repeatedly(tmp_path):
    session, _ = make_session(tmp_path, "seed_idempotent.db")

    seed(session)
    session.commit()

    def snapshot():
        return {
            "company": sorted(c.name for c in session.query(models.Company)),
            "interview_step": sorted(
                (s.company_id, s.type, s.date, str(s.prep_status), str(s.result))
                for s in session.query(models.InterviewStep)
            ),
            "company_task": sorted(
                (ct.company_id, ct.name, str(ct.status)) for ct in session.query(models.CompanyTask)
            ),
        }

    first_snapshot = snapshot()

    seed(session)
    session.commit()
    second_snapshot = snapshot()

    assert first_snapshot == second_snapshot


def test_seed_reruns_to_same_state_even_after_vandalism(tmp_path):
    """荒らし（追加・変更・削除）が起きた状態から再実行しても同じ内容に収束する。"""
    session, _ = make_session(tmp_path, "seed_vandalism.db")

    seed(session)
    session.commit()

    # 荒らしを模して、勝手にデータを追加・変更・削除する
    session.add(models.Company(name="荒らしにより追加された企業"))
    vandal_course = models.Course(name="荒らしにより追加された授業")
    session.add(vandal_course)
    session.flush()
    session.add(
        models.Assignment(
            course_id=vandal_course.id, name="荒らしにより追加された課題", status="未着手"
        )
    )
    step = session.query(models.InterviewStep).first()
    step.type = "改ざんされた選考種別"
    company_task = session.query(models.CompanyTask).first()
    session.delete(company_task)
    session.commit()

    seed(session)
    session.commit()

    assert session.query(models.Company).count() == EXPECTED_COUNTS["company"]
    assert session.query(models.InterviewStep).count() == EXPECTED_COUNTS["interview_step"]
    assert session.query(models.CompanyTask).count() == EXPECTED_COUNTS["company_task"]
    assert session.query(models.Course).count() == 0
    assert session.query(models.Assignment).count() == 0
    assert {c.name for c in session.query(models.Company)} == {
        "架空フーズ株式会社",
        "サンプルテクノロジーズ株式会社",
        "デモ商事合同会社",
    }
    assert "改ざんされた選考種別" not in {s.type for s in session.query(models.InterviewStep)}

    session.close()


# --- HTTPエンドポイントとしては公開されない ---


def test_seed_is_not_exposed_as_an_http_endpoint():
    # openapi_url等は本人専用ツールという性質上main.pyで無効化されているため、
    # /docs等を叩く代わりに、アプリが実際に組み立てるOpenAPIスキーマから
    # 登録済みパス一覧を取得して確認する。
    paths = set(fastapi_app.openapi()["paths"].keys())
    assert paths, "no routes were registered; the endpoint list itself is broken"
    assert not any("seed" in path for path in paths)


# --- サーバープロセスとは独立に、コマンド一つで実行できる ---


def test_seed_script_runs_as_standalone_command(tmp_path):
    db_path = tmp_path / "seed_cli.db"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{db_path}"
    result = subprocess.run(
        [sys.executable, "-m", "app.seed_demo_data"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert result.returncode == 0, result.stderr
    assert db_path.exists()

    engine = build_engine(f"sqlite:///{db_path}")
    inspector = inspect(engine)
    assert {"company", "interview_step", "company_task"}.issubset(
        set(inspector.get_table_names())
    )
    session = sessionmaker(bind=engine)()
    assert session.query(models.Company).count() == EXPECTED_COUNTS["company"]
    session.close()
