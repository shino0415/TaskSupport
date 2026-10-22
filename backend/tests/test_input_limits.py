"""入力値の上限・範囲チェックとURLパスidの404統一のテスト。

決定事項「入力値の上限とバリデーション強化」に対応する。実行中の開発用DBファイル
（app.db）を汚染しないよう、tmp_path配下の一時ファイルSQLiteに対してのみ検証する。
"""

import shutil
import subprocess
from datetime import date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import models
from app.auth import API_KEY_ENV_VAR
from app.database import Base, build_engine, get_db
from app.main import app
from app.schemas import (
    AssignmentCreate,
    CompanyCreate,
    CompanyTaskCreate,
    CourseCreate,
    InterviewStepCreate,
)
from app.seed_demo_data import seed

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}

REPO_ROOT = Path(__file__).resolve().parents[2]

NAME_OK = "名" * 32
NAME_NG = "名" * 33
MEMO_OK = "メ" * 1000
MEMO_NG = "メ" * 1001

# 64bit符号付き整数の範囲のすぐ外側と、さらに大きな値
OUT_OF_RANGE_IDS = [2**63, -(2**63) - 1, 10**20]


@pytest.fixture
def session_factory(tmp_path):
    engine = build_engine(f"sqlite:///{tmp_path / 'test_input_limits.db'}")
    Base.metadata.create_all(bind=engine)
    yield sessionmaker(autocommit=False, autoflush=False, bind=engine)
    engine.dispose()


@pytest.fixture
def client(monkeypatch, session_factory):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def post(client, path, body):
    return client.post(path, json=body, headers=AUTH_HEADERS)


def patch(client, path, body):
    return client.patch(path, json=body, headers=AUTH_HEADERS)


def create_course(client, **overrides):
    response = post(client, "/courses", {"name": "線形代数", **overrides})
    assert response.status_code == 201
    return response.json()["id"]


def create_company(client):
    response = post(client, "/companies", {"name": "テスト株式会社"})
    assert response.status_code == 201
    return response.json()["id"]


def create_assignment(client, course_id):
    response = post(client, f"/courses/{course_id}/assignments", {"name": "レポート"})
    assert response.status_code == 201
    return response.json()["id"]


def create_interview_step(client, company_id):
    response = post(client, f"/companies/{company_id}/interview-steps", {"type": "一次面接"})
    assert response.status_code == 201
    return response.json()["id"]


def create_company_task(client, company_id):
    response = post(
        client, f"/companies/{company_id}/company-tasks", {"name": "ES提出", "status": "未着手"}
    )
    assert response.status_code == 201
    return response.json()["id"]


# --- 作成時の名前・メモの上限 ---
# (作成先パスを返す関数, 名前項目のキー, 作成時に必要な他の項目)

CREATE_TARGETS = {
    "course": (lambda c: "/courses", "name", {}),
    "assignment": (lambda c: f"/courses/{create_course(c)}/assignments", "name", {}),
    "company": (lambda c: "/companies", "name", None),
    "interview_step": (
        lambda c: f"/companies/{create_company(c)}/interview-steps",
        "type",
        {},
    ),
    "company_task": (
        lambda c: f"/companies/{create_company(c)}/company-tasks",
        "name",
        {"status": "未着手"},
    ),
}


@pytest.mark.parametrize("target", list(CREATE_TARGETS))
@pytest.mark.parametrize(("name", "expected"), [(NAME_OK, 201), (NAME_NG, 422)])
def test_create_name_length_limit(client, target, name, expected):
    path_of, name_key, extra = CREATE_TARGETS[target]
    response = post(client, path_of(client), {name_key: name, **(extra or {})})
    assert response.status_code == expected
    if expected == 201:
        assert response.json()[name_key] == name


@pytest.mark.parametrize("target", [t for t, v in CREATE_TARGETS.items() if v[2] is not None])
@pytest.mark.parametrize(("memo", "expected"), [(MEMO_OK, 201), (MEMO_NG, 422)])
def test_create_memo_length_limit(client, target, memo, expected):
    path_of, name_key, extra = CREATE_TARGETS[target]
    response = post(client, path_of(client), {name_key: "名前", "memo": memo, **extra})
    assert response.status_code == expected
    if expected == 201:
        assert response.json()["memo"] == memo


# --- 更新時の名前・メモの上限 ---
# (更新対象を作成してPATCHパスを返す関数, 名前項目のキー)

UPDATE_TARGETS = {
    "course": (lambda c: f"/courses/{create_course(c)}", "name"),
    "assignment": (lambda c: f"/assignments/{create_assignment(c, create_course(c))}", "name"),
    "interview_step": (
        lambda c: f"/interview-steps/{create_interview_step(c, create_company(c))}",
        "type",
    ),
    "company_task": (
        lambda c: f"/company-tasks/{create_company_task(c, create_company(c))}",
        "name",
    ),
}


@pytest.mark.parametrize("target", list(UPDATE_TARGETS))
@pytest.mark.parametrize(("name", "expected"), [(NAME_OK, 200), (NAME_NG, 422)])
def test_update_name_length_limit(client, target, name, expected):
    path_of, name_key = UPDATE_TARGETS[target]
    response = patch(client, path_of(client), {name_key: name})
    assert response.status_code == expected
    if expected == 200:
        assert response.json()[name_key] == name


@pytest.mark.parametrize("target", list(UPDATE_TARGETS))
@pytest.mark.parametrize(("memo", "expected"), [(MEMO_OK, 200), (MEMO_NG, 422)])
def test_update_memo_length_limit(client, target, memo, expected):
    path_of, _ = UPDATE_TARGETS[target]
    response = patch(client, path_of(client), {"memo": memo})
    assert response.status_code == expected
    if expected == 200:
        assert response.json()["memo"] == memo


def test_rejected_update_does_not_change_stored_value(client):
    course_id = create_course(client)
    assert patch(client, f"/courses/{course_id}", {"name": NAME_NG}).status_code == 422
    assert client.get(f"/courses/{course_id}", headers=AUTH_HEADERS).json()["name"] == "線形代数"


# --- 授業の時限・年度の範囲 ---


@pytest.mark.parametrize(
    ("field", "value", "expected_create", "expected_update"),
    [
        ("period", 1, 201, 200),
        ("period", 6, 201, 200),
        ("period", 0, 422, 422),
        ("period", 7, 422, 422),
        ("academic_year", 2000, 201, 200),
        ("academic_year", 2100, 201, 200),
        ("academic_year", 1999, 422, 422),
        ("academic_year", 2101, 422, 422),
    ],
)
def test_course_period_and_academic_year_range(
    client, field, value, expected_create, expected_update
):
    response = post(client, "/courses", {"name": "授業", field: value})
    assert response.status_code == expected_create
    if expected_create == 201:
        assert response.json()[field] == value

    course_id = create_course(client)
    response = patch(client, f"/courses/{course_id}", {field: value})
    assert response.status_code == expected_update
    if expected_update == 200:
        assert response.json()[field] == value


def test_course_period_and_academic_year_remain_optional(client):
    response = post(client, "/courses", {"name": "オンデマンド授業"})
    assert response.status_code == 201
    assert response.json()["period"] is None
    assert response.json()["academic_year"] is None

    course_id = create_course(client, period=2, academic_year=2026)
    response = patch(client, f"/courses/{course_id}", {"period": None, "academic_year": None})
    assert response.status_code == 200
    assert response.json()["period"] is None
    assert response.json()["academic_year"] is None


# --- URLパスの64bit範囲外id ---

OUT_OF_RANGE_ID_REQUESTS = [
    ("get", "/courses/{id}", None),
    ("patch", "/courses/{id}", {"memo": "x"}),
    ("delete", "/courses/{id}", None),
    ("post", "/courses/{id}/assignments", {"name": "課題"}),
    ("get", "/courses/{id}/assignments", None),
    ("get", "/assignments/{id}", None),
    ("patch", "/assignments/{id}", {"memo": "x"}),
    ("delete", "/assignments/{id}", None),
    ("get", "/companies/{id}", None),
    ("delete", "/companies/{id}", None),
    ("post", "/companies/{id}/interview-steps", {"type": "一次面接"}),
    ("get", "/companies/{id}/interview-steps", None),
    ("patch", "/interview-steps/{id}", {"memo": "x"}),
    ("delete", "/interview-steps/{id}", None),
    ("post", "/companies/{id}/company-tasks", {"name": "ES提出", "status": "未着手"}),
    ("get", "/companies/{id}/company-tasks", None),
    ("patch", "/company-tasks/{id}", {"memo": "x"}),
    ("delete", "/company-tasks/{id}", None),
]


@pytest.mark.parametrize("huge_id", OUT_OF_RANGE_IDS)
@pytest.mark.parametrize(("method", "path", "body"), OUT_OF_RANGE_ID_REQUESTS)
def test_out_of_range_id_returns_404(client, method, path, body, huge_id):
    kwargs = {"headers": AUTH_HEADERS}
    if body is not None:
        kwargs["json"] = body
    response = client.request(method.upper(), path.format(id=huge_id), **kwargs)
    assert response.status_code == 404


@pytest.mark.parametrize("edge_id", [2**63 - 1, -(2**63)])
def test_id_at_64bit_boundary_is_treated_as_not_found_without_error(client, edge_id):
    assert client.get(f"/courses/{edge_id}", headers=AUTH_HEADERS).status_code == 404
    assert client.get(f"/companies/{edge_id}", headers=AUTH_HEADERS).status_code == 404


# --- 既存の上限超過データの取得 ---


def test_existing_over_limit_data_can_still_be_read(client, session_factory):
    db = session_factory()
    course = models.Course(
        name=NAME_NG * 3,
        period=99,
        academic_year=1500,
        memo=MEMO_NG,
    )
    company = models.Company(name=NAME_NG)
    db.add_all([course, company])
    db.flush()
    assignment = models.Assignment(
        course_id=course.id,
        name=NAME_NG,
        status="未着手",
        deadline=datetime(2026, 11, 1, 23, 59),
        memo=MEMO_NG,
    )
    step = models.InterviewStep(
        company_id=company.id,
        type=NAME_NG,
        date=date(2026, 11, 1),
        prep_status="準備中",
        result="未定",
        memo=MEMO_NG,
    )
    task = models.CompanyTask(company_id=company.id, name=NAME_NG, status="未着手", memo=MEMO_NG)
    db.add_all([assignment, step, task])
    db.commit()
    ids = {
        "course": course.id,
        "assignment": assignment.id,
        "company": company.id,
    }
    db.close()

    def get_ok(path):
        response = client.get(path, headers=AUTH_HEADERS)
        assert response.status_code == 200, path
        return response.json()

    assert get_ok("/courses")[0]["period"] == 99
    assert get_ok(f"/courses/{ids['course']}")["academic_year"] == 1500
    assert get_ok(f"/courses/{ids['course']}/assignments")[0]["memo"] == MEMO_NG
    assert get_ok(f"/assignments/{ids['assignment']}")["name"] == NAME_NG
    assert get_ok("/assignments/upcoming")[0]["course_name"] == NAME_NG * 3
    assert get_ok("/companies")[0]["name"] == NAME_NG
    assert get_ok(f"/companies/{ids['company']}")["name"] == NAME_NG
    assert get_ok(f"/companies/{ids['company']}/interview-steps")[0]["type"] == NAME_NG
    assert get_ok("/interview-steps/upcoming")[0]["memo"] == MEMO_NG
    assert get_ok(f"/companies/{ids['company']}/company-tasks")[0]["name"] == NAME_NG


def test_existing_over_limit_data_can_be_partially_updated(client, session_factory):
    db = session_factory()
    course = models.Course(name=NAME_NG, period=99, memo=MEMO_NG)
    db.add(course)
    db.commit()
    course_id = course.id
    db.close()

    # 上限超過の項目に触れない更新は、保存済みの値に関わらず成功する
    response = patch(client, f"/courses/{course_id}", {"term": "前期"})
    assert response.status_code == 200
    assert response.json()["name"] == NAME_NG


# --- デモデータが上限・範囲内に収まる ---


def test_seed_demo_data_fits_within_input_limits(tmp_path):
    engine = build_engine(f"sqlite:///{tmp_path / 'seed_limits.db'}")
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    seed(db)
    db.commit()

    def as_dict(row, fields):
        return {field: getattr(row, field) for field in fields}

    for course in db.query(models.Course).all():
        CourseCreate.model_validate(
            as_dict(course, ["name", "day_of_week", "period", "academic_year", "term", "memo"])
        )
    for assignment in db.query(models.Assignment).all():
        AssignmentCreate.model_validate(
            as_dict(assignment, ["name", "status", "deadline", "submission_method", "memo"])
        )
    for company in db.query(models.Company).all():
        CompanyCreate.model_validate(as_dict(company, ["name"]))
    for step in db.query(models.InterviewStep).all():
        InterviewStepCreate.model_validate(
            as_dict(step, ["type", "date", "prep_status", "result", "memo"])
        )
    for task in db.query(models.CompanyTask).all():
        CompanyTaskCreate.model_validate(as_dict(task, ["name", "status", "memo"]))

    db.close()
    engine.dispose()


# --- 移行時バックアップファイルのgit除外 ---


@pytest.mark.skipif(shutil.which("git") is None, reason="gitが利用できない環境")
@pytest.mark.parametrize(
    "path", ["app.db.bak-20261022-120000", "backend/app.db.bak-20261022T120000"]
)
def test_migration_backup_files_are_ignored_by_git(path):
    if not (REPO_ROOT / ".git").exists():
        pytest.skip("gitリポジトリ外での実行")
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "-q", path],
        cwd=REPO_ROOT,
        check=False,
    )
    assert result.returncode == 0
