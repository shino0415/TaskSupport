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


# --- 選考状態（status） ---


def patch_company(client, company_id, body, headers=AUTH_HEADERS):
    return client.patch(f"/companies/{company_id}", json=body, headers=headers)


def get_company_body(client, company_id):
    return client.get(f"/companies/{company_id}", headers=AUTH_HEADERS).json()


def test_create_company_defaults_status_to_in_progress(client):
    response = client.post("/companies", json=make_company_payload(), headers=AUTH_HEADERS)
    assert response.status_code == 201
    assert response.json()["status"] == "選考中"


def test_create_company_ignores_status_in_payload(client):
    response = client.post(
        "/companies", json=make_company_payload(status="内定"), headers=AUTH_HEADERS
    )
    assert response.status_code == 201
    assert response.json()["status"] == "選考中"


def test_list_and_detail_include_status(client):
    company_id = create_company(client)

    listed = client.get("/companies", headers=AUTH_HEADERS).json()
    assert [c["status"] for c in listed if c["id"] == company_id] == ["選考中"]
    assert get_company_body(client, company_id)["status"] == "選考中"


def test_get_company_detail_does_not_include_next_step(client):
    company_id = create_company(client)
    client.post(
        f"/companies/{company_id}/interview-steps", json={"type": "一次面接"}, headers=AUTH_HEADERS
    )
    body = get_company_body(client, company_id)
    assert set(body) == {"id", "name", "status", "is_deleted"}


# --- PATCH /companies/{id} ---


@pytest.mark.parametrize("new_status", ["内定", "お見送り", "辞退"])
def test_patch_company_status_forward_has_no_warning(client, new_status):
    company_id = create_company(client)

    response = patch_company(client, company_id, {"status": new_status})
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == company_id
    assert body["status"] == new_status
    assert body["warning"] is None
    assert get_company_body(client, company_id)["status"] == new_status


@pytest.mark.parametrize("from_status", ["内定", "お見送り", "辞退"])
def test_patch_company_status_backward_returns_warning_without_blocking(client, from_status):
    company_id = create_company(client)
    patch_company(client, company_id, {"status": from_status})

    response = patch_company(client, company_id, {"status": "選考中"})
    assert response.status_code == 200
    assert response.json()["status"] == "選考中"
    assert (
        response.json()["warning"]
        == f"{from_status} から 選考中 への変更です。意図的な変更か確認してください。"
    )
    assert get_company_body(client, company_id)["status"] == "選考中"


@pytest.mark.parametrize(
    ("from_status", "to_status"),
    [("内定", "お見送り"), ("お見送り", "内定"), ("お見送り", "辞退"), ("辞退", "お見送り")],
)
def test_patch_company_status_between_branches_has_no_warning(client, from_status, to_status):
    company_id = create_company(client)
    patch_company(client, company_id, {"status": from_status})

    response = patch_company(client, company_id, {"status": to_status})
    assert response.status_code == 200
    assert response.json()["status"] == to_status
    assert response.json()["warning"] is None


def test_patch_company_offer_to_declined_has_no_warning(client):
    company_id = create_company(client)
    patch_company(client, company_id, {"status": "内定"})

    response = patch_company(client, company_id, {"status": "辞退"})
    assert response.status_code == 200
    assert response.json()["status"] == "辞退"
    assert response.json()["warning"] is None
    assert get_company_body(client, company_id)["status"] == "辞退"


def test_patch_company_declined_to_offer_returns_warning_without_blocking(client):
    company_id = create_company(client)
    patch_company(client, company_id, {"status": "辞退"})

    response = patch_company(client, company_id, {"status": "内定"})
    assert response.status_code == 200
    assert response.json()["status"] == "内定"
    assert (
        response.json()["warning"]
        == "辞退 から 内定 への変更です。意図的な変更か確認してください。"
    )
    assert get_company_body(client, company_id)["status"] == "内定"


def test_list_and_detail_return_declined_status(client):
    company_id = create_company(client)
    patch_company(client, company_id, {"status": "辞退"})

    listed = client.get("/companies", headers=AUTH_HEADERS).json()
    assert [c["status"] for c in listed if c["id"] == company_id] == ["辞退"]
    assert get_company_body(client, company_id)["status"] == "辞退"


def test_patch_company_same_status_has_no_warning(client):
    company_id = create_company(client)
    response = patch_company(client, company_id, {"status": "選考中"})
    assert response.status_code == 200
    assert response.json()["warning"] is None


@pytest.mark.parametrize("current_status", ["内定", "辞退"])
@pytest.mark.parametrize("bad_status", ["内々定", "", "不通過", "内定辞退", None, 1])
def test_patch_company_rejects_invalid_or_null_status(client, bad_status, current_status):
    company_id = create_company(client)
    patch_company(client, company_id, {"status": current_status})

    response = patch_company(client, company_id, {"status": bad_status})
    assert response.status_code == 422
    assert get_company_body(client, company_id)["status"] == current_status


def test_patch_company_ignores_fields_other_than_status(client):
    company_id = create_company(client, name="元の企業名")

    response = patch_company(
        client,
        company_id,
        {"status": "内定", "name": "変更後", "id": company_id + 100, "is_deleted": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "id": company_id,
        "name": "元の企業名",
        "status": "内定",
        "is_deleted": False,
        "warning": None,
    }
    assert get_company_body(client, company_id)["name"] == "元の企業名"
    assert company_id in [c["id"] for c in client.get("/companies", headers=AUTH_HEADERS).json()]


def test_patch_company_without_status_changes_nothing(client):
    company_id = create_company(client)
    response = patch_company(client, company_id, {"name": "変更後"})
    assert response.status_code == 200
    assert response.json()["name"] == "テスト株式会社"
    assert response.json()["status"] == "選考中"
    assert response.json()["warning"] is None


def test_patch_company_not_found_for_unknown_id(client):
    assert patch_company(client, 99999, {"status": "内定"}).status_code == 404


def test_patch_company_not_found_after_deletion(client):
    company_id = create_company(client)
    client.delete(f"/companies/{company_id}", headers=AUTH_HEADERS)
    assert patch_company(client, company_id, {"status": "内定"}).status_code == 404


def test_patch_company_not_found_for_out_of_range_id(client):
    assert patch_company(client, 2**63, {"status": "内定"}).status_code == 404


@pytest.mark.parametrize("headers", [{}, {"X-API-Key": "wrong-key"}])
def test_patch_company_requires_valid_api_key(client, headers):
    company_id = create_company(client)
    response = patch_company(client, company_id, {"status": "内定"}, headers=headers)
    assert response.status_code == 401
    assert get_company_body(client, company_id)["status"] == "選考中"
