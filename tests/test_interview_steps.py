"""InterviewStep作成・参照・削除エンドポイントのテスト。

実行中の開発用DBファイル（app.db）を汚染しないよう、テスト専用の一時ファイル
SQLiteエンジンを都度作成し、`get_db`依存関係をオーバーライドして使う。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.auth import API_KEY_ENV_VAR
from app.database import Base, build_engine, get_db
from app.main import app

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)

    db_path = tmp_path / "test_interview_steps.db"
    engine = build_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=engine)
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


def make_company_payload(**overrides):
    payload = {"name": "テスト株式会社"}
    payload.update(overrides)
    return payload


def create_company(client, **overrides):
    payload = make_company_payload(**overrides)
    response = client.post("/companies", json=payload, headers=AUTH_HEADERS)
    return response.json()["id"]


def make_interview_step_payload(**overrides):
    payload = {
        "type": "一次面接",
        "date": "2026-03-01",
        "memo": "メモ",
    }
    payload.update(overrides)
    return payload


def create_interview_step(client, company_id, **overrides):
    payload = make_interview_step_payload(**overrides)
    response = client.post(
        f"/companies/{company_id}/interview-steps", json=payload, headers=AUTH_HEADERS
    )
    return response.json()["id"]


# --- POST /companies/{id}/interview-steps ---


def test_create_interview_step_reflects_input_in_response(client):
    company_id = create_company(client)
    payload = make_interview_step_payload()

    response = client.post(
        f"/companies/{company_id}/interview-steps", json=payload, headers=AUTH_HEADERS
    )
    assert response.status_code == 201
    body = response.json()
    for key, value in payload.items():
        assert body[key] == value
    assert body["company_id"] == company_id
    assert body["is_deleted"] is False
    assert isinstance(body["id"], int)


def test_create_interview_step_defaults_prep_status_and_result(client):
    company_id = create_company(client)
    payload = make_interview_step_payload()

    response = client.post(
        f"/companies/{company_id}/interview-steps", json=payload, headers=AUTH_HEADERS
    )
    assert response.status_code == 201
    body = response.json()
    assert body["prep_status"] == "準備中"
    assert body["result"] == "未定"


def test_create_interview_step_reflects_explicit_non_default_prep_status_and_result(client):
    company_id = create_company(client)
    payload = make_interview_step_payload(prep_status="準備万端", result="通過")

    response = client.post(
        f"/companies/{company_id}/interview-steps", json=payload, headers=AUTH_HEADERS
    )
    assert response.status_code == 201
    body = response.json()
    assert body["prep_status"] == "準備万端"
    assert body["result"] == "通過"


def test_create_interview_step_rejects_mass_assignment_of_is_deleted(client):
    company_id = create_company(client)
    payload = make_interview_step_payload()
    payload["is_deleted"] = True

    response = client.post(
        f"/companies/{company_id}/interview-steps", json=payload, headers=AUTH_HEADERS
    )
    assert response.status_code == 201
    assert response.json()["is_deleted"] is False


def test_create_interview_step_not_found_for_unknown_company_id(client):
    response = client.post(
        "/companies/99999/interview-steps",
        json=make_interview_step_payload(),
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 404


def test_create_interview_step_not_found_for_deleted_company(client):
    company_id = create_company(client)
    client.delete(f"/companies/{company_id}", headers=AUTH_HEADERS)

    response = client.post(
        f"/companies/{company_id}/interview-steps",
        json=make_interview_step_payload(),
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 404


# --- GET /companies/{id}/interview-steps ---


def test_list_interview_steps_excludes_deleted(client):
    company_id = create_company(client)
    id1 = create_interview_step(client, company_id, type="書類選考")
    id2 = create_interview_step(client, company_id, type="一次面接")
    client.delete(f"/interview-steps/{id1}", headers=AUTH_HEADERS)

    response = client.get(f"/companies/{company_id}/interview-steps", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [s["id"] for s in response.json()]
    assert id1 not in ids
    assert id2 in ids


def test_list_interview_steps_not_found_for_unknown_company_id(client):
    response = client.get("/companies/99999/interview-steps", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_list_interview_steps_not_found_for_deleted_company(client):
    company_id = create_company(client)
    client.delete(f"/companies/{company_id}", headers=AUTH_HEADERS)

    response = client.get(f"/companies/{company_id}/interview-steps", headers=AUTH_HEADERS)
    assert response.status_code == 404


# --- DELETE /interview-steps/{id} ---


def test_delete_interview_step_marks_is_deleted_and_excludes_from_list(client):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id)

    delete_response = client.delete(
        f"/interview-steps/{interview_step_id}", headers=AUTH_HEADERS
    )
    assert delete_response.status_code == 204

    list_response = client.get(f"/companies/{company_id}/interview-steps", headers=AUTH_HEADERS)
    assert interview_step_id not in [s["id"] for s in list_response.json()]


def test_delete_interview_step_not_found_for_unknown_id(client):
    response = client.delete("/interview-steps/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_delete_interview_step_is_idempotent_not_found_on_second_call(client):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id)
    client.delete(f"/interview-steps/{interview_step_id}", headers=AUTH_HEADERS)

    second_delete = client.delete(f"/interview-steps/{interview_step_id}", headers=AUTH_HEADERS)
    assert second_delete.status_code == 404


# --- 認証 ---


def test_endpoints_require_api_key(client):
    company_id = create_company(client)
    response = client.get(f"/companies/{company_id}/interview-steps")
    assert response.status_code == 401
