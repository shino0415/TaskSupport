"""API Key認証のテスト。

- verify_api_key単体での有効/無効/未設定パターンの検証
- app.main.appにグローバル依存関係として適用されていることの検証
  （業務エンドポイントが未実装のため、テスト用のダミールートを一時的に
  app本体へ追加し、後続タスクで実装される実際のエンドポイントも
  自動的に保護される設計であることを確認する）
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import API_KEY_ENV_VAR, verify_api_key
from app.main import app

TEST_API_KEY = "test-secret-key"
DUMMY_PATH = "/_test-only-dummy"


# --- verify_api_key単体テスト ---


def test_verify_api_key_accepts_valid_key(monkeypatch):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)
    verify_api_key(x_api_key=TEST_API_KEY)  # 例外が発生しなければ成功


def test_verify_api_key_rejects_missing_key(monkeypatch):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)
    with pytest.raises(HTTPException) as exc_info:
        verify_api_key(x_api_key=None)
    assert exc_info.value.status_code == 401


def test_verify_api_key_rejects_invalid_key(monkeypatch):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)
    with pytest.raises(HTTPException) as exc_info:
        verify_api_key(x_api_key="wrong-key")
    assert exc_info.value.status_code == 401


def test_verify_api_key_rejects_any_key_when_env_var_unset(monkeypatch):
    monkeypatch.delenv(API_KEY_ENV_VAR, raising=False)
    with pytest.raises(HTTPException) as exc_info:
        verify_api_key(x_api_key="anything")
    assert exc_info.value.status_code == 401


# --- アプリ全体への適用の検証（TestClient経由） ---


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)
    call_log = []

    @app.get(DUMMY_PATH)
    def _dummy_endpoint():
        call_log.append(1)
        return {"ok": True}

    with TestClient(app) as test_client:
        test_client.call_log = call_log
        yield test_client

    # 他のテストファイル（app.main.appを共有する）に影響しないよう、
    # 追加したダミールートを後始末する
    app.router.routes = [r for r in app.router.routes if getattr(r, "path", None) != DUMMY_PATH]


def test_valid_api_key_is_processed_normally(client):
    response = client.get(DUMMY_PATH, headers={"X-API-Key": TEST_API_KEY})
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert client.call_log == [1]


def test_missing_api_key_returns_401_and_does_not_run_endpoint(client):
    response = client.get(DUMMY_PATH)
    assert response.status_code == 401
    assert client.call_log == []


def test_invalid_api_key_returns_401_and_does_not_run_endpoint(client):
    response = client.get(DUMMY_PATH, headers={"X-API-Key": "wrong-key"})
    assert response.status_code == 401
    assert client.call_log == []


def test_dependency_is_applied_at_app_level_so_future_routes_are_protected():
    # 個別ルートにDependsを付与していなくても、appコンストラクタに登録した
    # グローバル依存関係により保護されることを確認する（後続タスクで
    # 追加される実際の業務エンドポイントも同様に自動保護される）。
    assert verify_api_key in [d.dependency for d in app.router.dependencies]


# --- /docs・/redoc・/openapi.json が認証をバイパスできないことの検証 ---
# これらはFastAPIのグローバルdependenciesの対象外（Starletteの素のルート）に
# なるため、docs_url等をNoneにして無効化する対応をとっている。
# API Keyなしでアクセスしても200で内容が返らない（無効化されている）ことを確認する。


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_docs_routes_are_disabled_and_not_accessible_without_api_key(path, monkeypatch):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)
    with TestClient(app) as test_client:
        response = test_client.get(path)
    assert response.status_code == 404


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_docs_routes_are_disabled_even_with_valid_api_key(path, monkeypatch):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)
    with TestClient(app) as test_client:
        response = test_client.get(path, headers={"X-API-Key": TEST_API_KEY})
    assert response.status_code == 404


# --- secrets.compare_digestによる定数時間比較への変更の検証 ---


def test_verify_api_key_rejects_none_header_even_if_expected_key_is_empty_string(monkeypatch):
    # expected_keyが空文字列(falsy)の場合もfail closedであることの確認
    # （compare_digest導入後もこのガードが機能し続けることを保証する）
    monkeypatch.setenv(API_KEY_ENV_VAR, "")
    with pytest.raises(HTTPException) as exc_info:
        verify_api_key(x_api_key=None)
    assert exc_info.value.status_code == 401
