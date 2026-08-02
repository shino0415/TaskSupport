"""Company作成・参照・削除エンドポイントのテスト。

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

    db_path = tmp_path / "test_companies.db"
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


# --- POST /companies ---


def test_create_company_reflects_input_in_response(client):
    payload = make_company_payload()
    response = client.post("/companies", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == payload["name"]
    assert body["is_deleted"] is False
    assert isinstance(body["id"], int)


def test_create_company_rejects_mass_assignment_of_is_deleted(client):
    payload = make_company_payload()
    payload["is_deleted"] = True
    response = client.post("/companies", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 201
    assert response.json()["is_deleted"] is False


# --- GET /companies ---


def test_list_companies_excludes_deleted(client):
    id1 = create_company(client, name="A社")
    id2 = create_company(client, name="B社")
    client.delete(f"/companies/{id1}", headers=AUTH_HEADERS)

    response = client.get("/companies", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [c["id"] for c in response.json()]
    assert id1 not in ids
    assert id2 in ids


# --- GET /companies/{id} ---


def test_get_company_detail_does_not_include_child_interview_step_info(client):
    company_id = create_company(client)

    response = client.get(f"/companies/{company_id}", headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == company_id
    assert "interview_steps" not in body


def test_get_company_detail_not_found_for_unknown_id(client):
    response = client.get("/companies/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_get_company_detail_not_found_after_deletion(client):
    company_id = create_company(client)
    client.delete(f"/companies/{company_id}", headers=AUTH_HEADERS)

    response = client.get(f"/companies/{company_id}", headers=AUTH_HEADERS)
    assert response.status_code == 404


# --- DELETE /companies/{id} ---


def test_delete_company_marks_is_deleted_and_excludes_from_list(client):
    company_id = create_company(client)

    delete_response = client.delete(f"/companies/{company_id}", headers=AUTH_HEADERS)
    assert delete_response.status_code == 204

    list_response = client.get("/companies", headers=AUTH_HEADERS)
    assert company_id not in [c["id"] for c in list_response.json()]


def test_delete_company_not_found_for_unknown_id(client):
    response = client.delete("/companies/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_delete_company_is_idempotent_not_found_on_second_call(client):
    company_id = create_company(client)
    client.delete(f"/companies/{company_id}", headers=AUTH_HEADERS)

    second_delete = client.delete(f"/companies/{company_id}", headers=AUTH_HEADERS)
    assert second_delete.status_code == 404


# --- 認証 ---


def test_endpoints_require_api_key(client):
    response = client.get("/companies")
    assert response.status_code == 401
