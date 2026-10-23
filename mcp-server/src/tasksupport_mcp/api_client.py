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
        try:
            response = await self._client.get(path)
        except httpx2.TimeoutException:
            raise ApiError(
                f"APIが時間内に応答しませんでした（タイムアウト {self._timeout:g}秒）。"
            ) from None
        except httpx2.HTTPError as exc:
            raise ApiError(
                f"APIに接続できませんでした（{type(exc).__name__}）。"
                "設定ファイルの base_url と接続先の状態を確認してください。"
            ) from None

        if response.is_success:
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
