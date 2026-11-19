"""企業一覧（GET /companies）の次回選考ステップの要約（next_step）のテスト。

実行中の開発用DBファイル（app.db）を汚染しないよう、テスト専用の一時ファイル
SQLiteエンジンを都度作成し、`get_db`依存関係をオーバーライドして使う。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from app.auth import API_KEY_ENV_VAR
from app.database import Base, build_engine, get_db
from app.main import app

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}


@pytest.fixture
def engine(tmp_path):
    db_path = tmp_path / "test_company_next_step.db"
    engine = build_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture
def client(monkeypatch, engine):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)
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


def create_company(client, name="テスト株式会社"):
    response = client.post("/companies", json={"name": name}, headers=AUTH_HEADERS)
    assert response.status_code == 201
    return response.json()["id"]


def create_step(client, company_id, **overrides):
    payload = {"type": "一次面接"}
    payload.update(overrides)
    response = client.post(
        f"/companies/{company_id}/interview-steps", json=payload, headers=AUTH_HEADERS
    )
    assert response.status_code == 201
    return response.json()["id"]


def list_companies(client):
    response = client.get("/companies", headers=AUTH_HEADERS)
    assert response.status_code == 200
    return response.json()


def next_step_of(client, company_id):
    [company] = [c for c in list_companies(client) if c["id"] == company_id]
    return company["next_step"]


def test_next_step_is_earliest_pending_step_summary(client):
    company_id = create_company(client)
    create_step(client, company_id, type="最終面接", date="2026-12-10")
    earliest_id = create_step(client, company_id, type="二次面接", date="2026-11-25")
    create_step(client, company_id, type="三次面接")

    assert next_step_of(client, company_id) == {
        "id": earliest_id,
        "type": "二次面接",
        "date": "2026-11-25",
    }


def test_step_without_date_comes_after_dated_steps(client):
    company_id = create_company(client)
    create_step(client, company_id, type="日付未定の面接")
    dated_id = create_step(client, company_id, type="一次面接", date="2027-03-01")

    assert next_step_of(client, company_id)["id"] == dated_id


def test_step_without_date_is_next_step_when_no_dated_pending_step(client):
    company_id = create_company(client)
    create_step(client, company_id, date="2026-11-01", result="通過")
    undated_id = create_step(client, company_id, type="二次面接")

    assert next_step_of(client, company_id) == {
        "id": undated_id,
        "type": "二次面接",
        "date": None,
    }


def test_past_pending_step_is_included(client):
    company_id = create_company(client)
    past_id = create_step(client, company_id, date="2000-01-01")
    create_step(client, company_id, date="2099-01-01")

    assert next_step_of(client, company_id)["id"] == past_id


@pytest.mark.parametrize("result", ["通過", "不通過"])
def test_decided_steps_are_excluded(client, result):
    company_id = create_company(client)
    create_step(client, company_id, date="2026-11-01", result=result)
    pending_id = create_step(client, company_id, date="2026-12-01")

    assert next_step_of(client, company_id)["id"] == pending_id


def test_deleted_step_is_excluded(client):
    company_id = create_company(client)
    deleted_id = create_step(client, company_id, date="2026-11-01")
    pending_id = create_step(client, company_id, date="2026-12-01")
    client.delete(f"/interview-steps/{deleted_id}", headers=AUTH_HEADERS)

    assert next_step_of(client, company_id)["id"] == pending_id


def test_next_step_is_null_without_steps(client):
    company_id = create_company(client)

    assert next_step_of(client, company_id) is None


def test_next_step_is_null_when_no_step_is_eligible(client):
    company_id = create_company(client)
    create_step(client, company_id, date="2026-11-01", result="通過")
    create_step(client, company_id, date="2026-11-02", result="不通過")
    deleted_id = create_step(client, company_id, date="2026-11-03")
    client.delete(f"/interview-steps/{deleted_id}", headers=AUTH_HEADERS)

    assert next_step_of(client, company_id) is None


def test_next_step_is_per_company(client):
    company_a = create_company(client, name="A社")
    company_b = create_company(client, name="B社")
    step_a = create_step(client, company_a, date="2026-12-01")
    step_b = create_step(client, company_b, date="2026-11-01")

    assert next_step_of(client, company_a)["id"] == step_a
    assert next_step_of(client, company_b)["id"] == step_b


def test_next_step_matches_first_pending_step_in_upcoming(client):
    # 同じ予定日の扱いを含め、upcomingで各企業の未定ステップのうち最初に並ぶものと一致する
    company_ids = [create_company(client, name=f"{i}社") for i in range(3)]
    for company_id in company_ids:
        create_step(client, company_id, type="同日A", date="2026-12-01")
        create_step(client, company_id, type="同日B", date="2026-12-01")
        create_step(client, company_id, type="日付なしA")
        create_step(client, company_id, type="日付なしB")
    # 予定日なしのステップだけが候補になる企業
    undated_only = create_company(client, name="日付なしのみ社")
    create_step(client, undated_only, type="日付なしA")
    create_step(client, undated_only, type="日付なしB")

    upcoming = client.get("/interview-steps/upcoming", headers=AUTH_HEADERS).json()
    expected = {}
    for step in upcoming:
        if step["result"] == "未定":
            expected.setdefault(step["company_id"], step["id"])

    listed = {c["id"]: c["next_step"]["id"] for c in list_companies(client)}
    assert listed == expected


def test_completed_prep_step_is_excluded_and_later_pending_step_is_next(client):
    company_id = create_company(client)
    create_step(client, company_id, date="2026-11-01", prep_status="完了")
    later_id = create_step(client, company_id, type="二次面接", date="2026-11-02")

    assert next_step_of(client, company_id) == {
        "id": later_id,
        "type": "二次面接",
        "date": "2026-11-02",
    }


def test_completed_prep_dated_step_is_skipped_for_undated_pending_step(client):
    company_id = create_company(client)
    create_step(client, company_id, date="2026-11-01", prep_status="完了")
    undated_id = create_step(client, company_id, type="日付未定の面接")

    assert next_step_of(client, company_id)["id"] == undated_id


def test_next_step_is_null_when_only_completed_prep_steps_are_pending(client):
    company_id = create_company(client)
    create_step(client, company_id, date="2026-11-01", prep_status="完了")
    create_step(client, company_id, prep_status="完了")
    create_step(client, company_id, date="2026-10-01", result="通過")

    assert next_step_of(client, company_id) is None


@pytest.mark.parametrize("prep_status", ["準備中", "準備万端"])
def test_not_completed_prep_step_is_candidate(client, prep_status):
    company_id = create_company(client)
    step_id = create_step(client, company_id, date="2026-11-01", prep_status=prep_status)
    create_step(client, company_id, date="2026-11-02")

    assert next_step_of(client, company_id)["id"] == step_id


def test_past_completed_prep_step_is_excluded_but_past_pending_step_is_included(client):
    company_id = create_company(client)
    create_step(client, company_id, date="2000-01-01", prep_status="完了")
    past_id = create_step(client, company_id, date="2000-01-02", prep_status="準備万端")
    create_step(client, company_id, date="2099-01-01")

    assert next_step_of(client, company_id)["id"] == past_id


@pytest.mark.parametrize("company_status", ["内定", "お見送り", "辞退"])
def test_next_step_does_not_filter_by_company_status(client, company_status):
    # upcomingの絞り込みのうち、企業の状態による絞り込みはnext_stepには入れない
    company_id = create_company(client)
    create_step(client, company_id, date="2026-11-01", prep_status="完了")
    pending_id = create_step(client, company_id, date="2026-11-02")
    response = client.patch(
        f"/companies/{company_id}", json={"status": company_status}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200

    upcoming = client.get("/interview-steps/upcoming", headers=AUTH_HEADERS).json()
    assert upcoming == []
    assert next_step_of(client, company_id)["id"] == pending_id


def test_list_still_excludes_deleted_companies(client):
    deleted_id = create_company(client, name="削除社")
    create_step(client, deleted_id, date="2026-11-01")
    active_id = create_company(client, name="有効社")
    client.delete(f"/companies/{deleted_id}", headers=AUTH_HEADERS)

    listed = list_companies(client)
    assert [c["id"] for c in listed] == [active_id]
    assert set(listed[0]) == {"id", "name", "status", "is_deleted", "next_step"}


def test_company_detail_does_not_include_next_step(client):
    company_id = create_company(client)
    create_step(client, company_id, date="2026-11-01")

    response = client.get(f"/companies/{company_id}", headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert set(response.json()) == {"id", "name", "status", "is_deleted"}


def count_list_queries(client, engine):
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        list_companies(client)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return len(statements)


def test_query_count_does_not_grow_with_number_of_companies(client, engine):
    first = create_company(client)
    create_step(client, first, date="2026-11-01")
    create_step(client, first)
    queries_with_one_company = count_list_queries(client, engine)

    for i in range(10):
        company_id = create_company(client, name=f"{i}社")
        create_step(client, company_id, date="2026-11-01")
        create_step(client, company_id)
    queries_with_many_companies = count_list_queries(client, engine)

    assert queries_with_many_companies == queries_with_one_company
    assert 0 < queries_with_one_company <= 2


def test_internship_company_has_next_step_with_same_rule(client):
    company_id = create_company(client)
    response = client.patch(
        f"/companies/{company_id}", json={"status": "インターン参加"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    create_step(client, company_id, type="最終面接", date="2026-12-10")
    earliest_id = create_step(client, company_id, type="インターン面談", date="2026-11-25")
    create_step(client, company_id, type="日付未定の面接")

    [company] = [c for c in list_companies(client) if c["id"] == company_id]
    assert company["status"] == "インターン参加"
    assert company["next_step"] == {
        "id": earliest_id,
        "type": "インターン面談",
        "date": "2026-11-25",
    }
