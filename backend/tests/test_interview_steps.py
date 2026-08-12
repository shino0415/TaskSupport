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


# --- GET /interview-steps/upcoming ---


def test_upcoming_interview_steps_sorted_by_date_ascending(client):
    company_id = create_company(client)
    id_far = create_interview_step(client, company_id, type="最終面接", date="2026-05-01")
    id_near = create_interview_step(client, company_id, type="書類選考", date="2026-03-10")
    id_mid = create_interview_step(client, company_id, type="一次面接", date="2026-04-01")

    response = client.get("/interview-steps/upcoming", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [s["id"] for s in response.json()]
    assert ids.index(id_near) < ids.index(id_mid) < ids.index(id_far)


def test_upcoming_interview_steps_spans_multiple_companies(client):
    company_a = create_company(client, name="A社")
    company_b = create_company(client, name="B社")
    id_a = create_interview_step(client, company_a, date="2026-03-10")
    id_b = create_interview_step(client, company_b, date="2026-03-01")

    response = client.get("/interview-steps/upcoming", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [s["id"] for s in response.json()]
    assert id_a in ids
    assert id_b in ids
    assert ids.index(id_b) < ids.index(id_a)


def test_upcoming_interview_steps_excludes_deleted(client):
    company_id = create_company(client)
    id_deleted = create_interview_step(client, company_id, date="2026-01-01")
    id_active = create_interview_step(client, company_id, date="2026-02-01")
    client.delete(f"/interview-steps/{id_deleted}", headers=AUTH_HEADERS)

    response = client.get("/interview-steps/upcoming", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [s["id"] for s in response.json()]
    assert id_deleted not in ids
    assert id_active in ids


def test_upcoming_interview_steps_with_unset_date_are_included_at_the_end(client):
    company_id = create_company(client)
    id_no_date = create_interview_step(client, company_id, date=None)
    id_dated = create_interview_step(client, company_id, date="2026-06-01")

    response = client.get("/interview-steps/upcoming", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [s["id"] for s in response.json()]
    assert id_no_date in ids
    assert id_dated in ids
    assert ids.index(id_dated) < ids.index(id_no_date)


def test_upcoming_interview_steps_excludes_steps_of_deleted_company(client):
    company_id = create_company(client)
    id_orphaned = create_interview_step(client, company_id, date="2026-01-01")
    client.delete(f"/companies/{company_id}", headers=AUTH_HEADERS)

    other_company_id = create_company(client)
    id_active = create_interview_step(client, other_company_id, date="2026-02-01")

    response = client.get("/interview-steps/upcoming", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [s["id"] for s in response.json()]
    assert id_orphaned not in ids
    assert id_active in ids


def test_upcoming_interview_steps_requires_api_key(client):
    response = client.get("/interview-steps/upcoming")
    assert response.status_code == 401


# --- PATCH /interview-steps/{id} ---


def test_update_interview_step_updates_fields(client):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id)

    response = client.patch(
        f"/interview-steps/{interview_step_id}",
        json={"type": "二次面接", "memo": "更新後メモ"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "二次面接"
    assert body["memo"] == "更新後メモ"
    # 更新していない項目は元の値のまま
    assert body["date"] == "2026-03-01"


@pytest.mark.parametrize("field", ["date", "memo"])
def test_update_interview_step_can_clear_nullable_field(client, field):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id)

    response = client.patch(
        f"/interview-steps/{interview_step_id}", json={field: None}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    assert response.json()[field] is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("type", None),
        ("prep_status", None),
        ("result", None),
    ],
)
def test_update_interview_step_rejects_explicit_null_for_required_field(client, field, value):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id)

    response = client.patch(
        f"/interview-steps/{interview_step_id}", json={field: value}, headers=AUTH_HEADERS
    )
    assert response.status_code == 422


def test_update_interview_step_not_found_for_unknown_id(client):
    response = client.patch(
        "/interview-steps/99999", json={"type": "二次面接"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 404


def test_update_interview_step_prep_status_backward_transition_returns_warning(client):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id, prep_status="完了")

    response = client.patch(
        f"/interview-steps/{interview_step_id}",
        json={"prep_status": "準備中"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["prep_status"] == "準備中"
    assert body["warning"] is not None
    assert "完了" in body["warning"]
    assert "準備中" in body["warning"]


@pytest.mark.parametrize(
    "from_status,to_status",
    [
        ("準備中", "準備中"),  # 同一
        ("準備中", "準備万端"),  # 隣接
        ("準備中", "完了"),  # 飛び越え
    ],
)
def test_update_interview_step_prep_status_forward_transition_has_no_warning(
    client, from_status, to_status
):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id, prep_status=from_status)

    response = client.patch(
        f"/interview-steps/{interview_step_id}",
        json={"prep_status": to_status},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["prep_status"] == to_status
    assert body.get("warning") is None


def test_update_interview_step_result_backward_transition_returns_warning(client):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id, result="通過")

    response = client.patch(
        f"/interview-steps/{interview_step_id}", json={"result": "未定"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["result"] == "未定"
    assert body["warning"] is not None
    assert "通過" in body["warning"]
    assert "未定" in body["warning"]


@pytest.mark.parametrize(
    "from_result,to_result",
    [
        ("未定", "未定"),  # 同一
        ("未定", "通過"),  # 分岐先1
        ("未定", "不通過"),  # 分岐先2
    ],
)
def test_update_interview_step_result_forward_transition_has_no_warning(
    client, from_result, to_result
):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id, result=from_result)

    response = client.patch(
        f"/interview-steps/{interview_step_id}",
        json={"result": to_result},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["result"] == to_result
    assert body.get("warning") is None


def test_update_interview_step_result_branch_to_branch_transition_has_no_warning(client):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id, result="通過")

    response = client.patch(
        f"/interview-steps/{interview_step_id}",
        json={"result": "不通過"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["result"] == "不通過"
    assert body.get("warning") is None


def test_update_interview_step_both_prep_status_and_result_backward_returns_combined_warning(
    client,
):
    company_id = create_company(client)
    interview_step_id = create_interview_step(
        client, company_id, prep_status="完了", result="通過"
    )

    response = client.patch(
        f"/interview-steps/{interview_step_id}",
        json={"prep_status": "準備中", "result": "未定"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["warning"] is not None
    # prep_status・result両方の逆行警告メッセージが" / "区切りで結合されていることを
    # 直接検証する（区切り文字自体の退行を検知するため、部分一致だけに頼らない）
    expected_prep_status_warning = (
        "完了 から 準備中 への変更です。意図的な変更か確認してください。"
    )
    expected_result_warning = (
        "通過 から 未定 への変更です。意図的な変更か確認してください。"
    )
    assert body["warning"] == f"{expected_prep_status_warning} / {expected_result_warning}"


def test_update_interview_step_without_status_change_has_no_warning(client):
    company_id = create_company(client)
    interview_step_id = create_interview_step(client, company_id)

    response = client.patch(
        f"/interview-steps/{interview_step_id}",
        json={"memo": "更新メモ"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    assert response.json().get("warning") is None


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
