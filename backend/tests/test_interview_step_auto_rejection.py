"""選考ステップの結果が不通過になったときの企業の自動お見送りのテスト。

実行中の開発用DBファイル（app.db）を汚染しないよう、テスト専用の一時ファイル
SQLiteエンジンを都度作成し、`get_db`依存関係をオーバーライドして使う。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from app import models
from app.auth import API_KEY_ENV_VAR
from app.database import Base, build_engine, get_db
from app.main import app

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}

INTERVIEW_STEP_READ_KEYS = {
    "id",
    "company_id",
    "type",
    "date",
    "memo",
    "prep_status",
    "result",
    "is_deleted",
}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)

    db_path = tmp_path / "test_interview_step_auto_rejection.db"
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
    engine.dispose()


def create_company(client, status=None):
    company_id = client.post(
        "/companies", json={"name": "テスト株式会社"}, headers=AUTH_HEADERS
    ).json()["id"]
    if status is not None:
        response = client.patch(
            f"/companies/{company_id}", json={"status": status}, headers=AUTH_HEADERS
        )
        assert response.status_code == 200
    return company_id


def post_step(client, company_id, **overrides):
    payload = {"type": "一次面接", "date": "2026-03-01", "memo": "メモ"}
    payload.update(overrides)
    return client.post(
        f"/companies/{company_id}/interview-steps", json=payload, headers=AUTH_HEADERS
    )


def patch_step(client, step_id, body):
    return client.patch(f"/interview-steps/{step_id}", json=body, headers=AUTH_HEADERS)


def company_status(client, company_id):
    return client.get(f"/companies/{company_id}", headers=AUTH_HEADERS).json()["status"]


# --- 作成 ---


def test_create_rejected_step_marks_in_progress_company_as_rejected(client):
    company_id = create_company(client)

    response = post_step(client, company_id, result="不通過")

    assert response.status_code == 201
    assert set(response.json()) == INTERVIEW_STEP_READ_KEYS
    assert response.json()["result"] == "不通過"
    assert company_status(client, company_id) == "お見送り"


@pytest.mark.parametrize("result", ["未定", "通過", None])
def test_create_non_rejected_step_keeps_company_in_progress(client, result):
    company_id = create_company(client)
    overrides = {} if result is None else {"result": result}

    response = post_step(client, company_id, **overrides)

    assert response.status_code == 201
    assert company_status(client, company_id) == "選考中"


@pytest.mark.parametrize("company_state", ["内定", "お見送り", "辞退"])
def test_create_rejected_step_does_not_change_finished_company(client, company_state):
    company_id = create_company(client, status=company_state)

    response = post_step(client, company_id, result="不通過")

    assert response.status_code == 201
    assert company_status(client, company_id) == company_state


# --- 更新 ---


@pytest.mark.parametrize("from_result", ["未定", "通過"])
def test_update_result_to_rejected_marks_in_progress_company_as_rejected(client, from_result):
    company_id = create_company(client)
    step_id = post_step(client, company_id, result=from_result).json()["id"]

    response = patch_step(client, step_id, {"result": "不通過"})

    assert response.status_code == 200
    assert set(response.json()) == INTERVIEW_STEP_READ_KEYS | {"warning"}
    assert response.json()["result"] == "不通過"
    assert company_status(client, company_id) == "お見送り"


def test_update_already_rejected_step_keeps_manually_restored_company(client):
    company_id = create_company(client)
    step_id = post_step(client, company_id, result="不通過").json()["id"]
    restore_response = client.patch(
        f"/companies/{company_id}", json={"status": "選考中"}, headers=AUTH_HEADERS
    )
    assert restore_response.status_code == 200

    response = patch_step(client, step_id, {"result": "不通過", "memo": "メモ修正"})

    assert response.status_code == 200
    assert response.json()["memo"] == "メモ修正"
    assert company_status(client, company_id) == "選考中"


@pytest.mark.parametrize("company_state", ["内定", "お見送り", "辞退"])
def test_update_to_rejected_does_not_change_finished_company(client, company_state):
    company_id = create_company(client, status=company_state)
    step_id = post_step(client, company_id).json()["id"]

    response = patch_step(client, step_id, {"result": "不通過"})

    assert response.status_code == 200
    assert company_status(client, company_id) == company_state


@pytest.mark.parametrize(
    "body",
    [
        {"result": "未定"},
        {"result": "通過"},
        {"memo": "結果を含まない更新"},
        {"prep_status": "準備万端"},
    ],
)
def test_update_without_rejection_keeps_company_in_progress(client, body):
    company_id = create_company(client)
    step_id = post_step(client, company_id).json()["id"]

    response = patch_step(client, step_id, body)

    assert response.status_code == 200
    assert company_status(client, company_id) == "選考中"


@pytest.mark.parametrize("to_result", ["未定", "通過"])
def test_reverting_rejected_result_does_not_restore_company(client, to_result):
    company_id = create_company(client)
    step_id = post_step(client, company_id, result="不通過").json()["id"]
    assert company_status(client, company_id) == "お見送り"

    response = patch_step(client, step_id, {"result": to_result})

    assert response.status_code == 200
    assert company_status(client, company_id) == "お見送り"


# --- インターン参加の企業 ---


def test_create_rejected_step_marks_internship_company_as_rejected(client):
    company_id = create_company(client, status="インターン参加")

    response = post_step(client, company_id, result="不通過")

    assert response.status_code == 201
    assert company_status(client, company_id) == "お見送り"


@pytest.mark.parametrize("result", ["未定", "通過", None])
def test_create_non_rejected_step_keeps_internship_company(client, result):
    company_id = create_company(client, status="インターン参加")
    overrides = {} if result is None else {"result": result}

    response = post_step(client, company_id, **overrides)

    assert response.status_code == 201
    assert company_status(client, company_id) == "インターン参加"


@pytest.mark.parametrize("from_result", ["未定", "通過"])
def test_update_result_to_rejected_marks_internship_company_as_rejected(client, from_result):
    company_id = create_company(client, status="インターン参加")
    step_id = post_step(client, company_id, result=from_result).json()["id"]

    response = patch_step(client, step_id, {"result": "不通過"})

    assert response.status_code == 200
    assert response.json()["result"] == "不通過"
    assert company_status(client, company_id) == "お見送り"


def test_update_already_rejected_step_keeps_internship_company(client):
    company_id = create_company(client)
    step_id = post_step(client, company_id, result="不通過").json()["id"]
    restore_response = client.patch(
        f"/companies/{company_id}", json={"status": "インターン参加"}, headers=AUTH_HEADERS
    )
    assert restore_response.status_code == 200

    response = patch_step(client, step_id, {"result": "不通過", "memo": "メモ修正"})

    assert response.status_code == 200
    assert response.json()["memo"] == "メモ修正"
    assert company_status(client, company_id) == "インターン参加"


def test_auto_rejection_affects_only_the_step_company(client):
    company_id = create_company(client)
    other_company_id = create_company(client)

    post_step(client, company_id, result="不通過")

    assert company_status(client, company_id) == "お見送り"
    assert company_status(client, other_company_id) == "選考中"


# --- 既存の逆行警告 ---


def test_update_to_rejected_has_no_warning(client):
    company_id = create_company(client)
    step_id = post_step(client, company_id).json()["id"]

    response = patch_step(client, step_id, {"result": "不通過"})

    assert response.json()["warning"] is None


def test_backward_result_warning_is_unchanged(client):
    company_id = create_company(client)
    step_id = post_step(client, company_id, result="不通過").json()["id"]

    response = patch_step(client, step_id, {"result": "未定"})

    assert response.status_code == 200
    assert response.json()["warning"] == (
        "不通過 から 未定 への変更です。意図的な変更か確認してください。"
    )


# --- 一体性 ---


@pytest.fixture
def fail_company_update():
    def raise_on_company_update(mapper, connection, target):
        raise RuntimeError("company update failed")

    event.listen(models.Company, "before_update", raise_on_company_update)
    yield
    event.remove(models.Company, "before_update", raise_on_company_update)


def list_steps(client, company_id):
    return client.get(
        f"/companies/{company_id}/interview-steps", headers=AUTH_HEADERS
    ).json()


def test_create_is_not_persisted_when_company_update_fails(client, request):
    company_id = create_company(client)
    request.getfixturevalue("fail_company_update")

    with pytest.raises(RuntimeError):
        post_step(client, company_id, result="不通過")

    assert list_steps(client, company_id) == []
    assert company_status(client, company_id) == "選考中"


def test_update_is_not_persisted_when_company_update_fails(client, request):
    company_id = create_company(client)
    step_id = post_step(client, company_id).json()["id"]
    request.getfixturevalue("fail_company_update")

    with pytest.raises(RuntimeError):
        patch_step(client, step_id, {"result": "不通過", "memo": "変更"})

    steps = list_steps(client, company_id)
    assert [(s["result"], s["memo"]) for s in steps] == [("未定", "メモ")]
    assert company_status(client, company_id) == "選考中"
