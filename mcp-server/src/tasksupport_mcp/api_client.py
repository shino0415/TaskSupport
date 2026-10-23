"""既存REST APIを`X-API-Key`付きで呼ぶHTTPクライアント。"""

import json
from typing import Any

import httpx2
from mcp.server.mcpserver.exceptions import ToolError

from tasksupport_mcp.config import Config

DEFAULT_TIMEOUT_SECONDS = 10.0
# APIがJSON以外（プロキシのエラーページ等）を返したときに、結果へ載せる本文の上限。
_MAX_BODY_CHARS = 500


class ApiError(ToolError):
    """ツールのエラー結果として返す失敗。メッセージにAPI Keyを含めない。"""


class ApiClient:
    def __init__(
        self,
        config: Config,
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: httpx2.AsyncBaseTransport | None = None,
    ) -> None:
        self._timeout = timeout
        self._client = httpx2.AsyncClient(
            base_url=config.base_url,
            headers={"X-API-Key": config.api_key},
            timeout=timeout,
            transport=transport,
            # リダイレクト先にAPI Keyを送らないよう、リダイレクトには追従しない。
            follow_redirects=False,
        )

    def __repr__(self) -> str:
        return f"ApiClient(base_url={str(self._client.base_url)!r})"

    async def aclose(self) -> None:
        await self._client.aclose()

    async def get(self, path: str) -> Any:
        return await self.request("GET", path)

    async def post(self, path: str, body: dict[str, Any]) -> Any:
        return await self.request("POST", path, body)

    async def patch(self, path: str, body: dict[str, Any]) -> Any:
        return await self.request("PATCH", path, body)

    async def delete(self, path: str) -> None:
        await self.request("DELETE", path)

    async def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        """APIを呼び、成功時は応答JSONを返す（204等の本文なしはNone）。"""
        try:
            response = await self._client.request(method, path, json=body)
        except httpx2.TimeoutException:
            message = f"APIが時間内に応答しませんでした（タイムアウト {self._timeout:g}秒）。"
            if method != "GET":
                # 送信済みの書き込みがAPI側で反映されている可能性があるため。
                message += "変更が反映されたかは読み取り系ツールで確認してください。"
            raise ApiError(message) from None
        except httpx2.HTTPError as exc:
            raise ApiError(
                f"APIに接続できませんでした（{type(exc).__name__}）。"
                "設定ファイルの base_url と接続先の状態を確認してください。"
            ) from None

        if response.is_success:
            if response.status_code == 204:
                return None
            try:
                return response.json()
            except ValueError:
                raise ApiError(
                    f"APIの応答をJSONとして読めませんでした（HTTP {response.status_code}）。"
                ) from None

        raise ApiError(_format_error(response))


def _format_error(response: httpx2.Response) -> str:
    status = response.status_code
    try:
        detail: Any = response.json().get("detail")
    except (ValueError, AttributeError):
        detail = response.text[:_MAX_BODY_CHARS] or None

    if detail is None:
        detail_text = "（詳細なし）"
    elif isinstance(detail, str):
        detail_text = detail
    else:
        detail_text = json.dumps(detail, ensure_ascii=False)

    message = f"APIエラー（HTTP {status}）: {detail_text}"
    if status == 401:
        message += "\n認証に失敗しました。設定ファイルの api_key を確認してください。"
    return message
