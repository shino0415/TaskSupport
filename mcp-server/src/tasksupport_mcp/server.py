"""MCPサーバー本体と読み取り系ツールの定義。"""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from tasksupport_mcp.api_client import ApiClient

SERVER_NAME = "tasksupport"

_READ_ONLY = ToolAnnotations(read_only_hint=True)
_READ_ONLY_NOTE = "読み取り専用で、データは変更しない。論理削除済みのデータは含まれない。"


def _to_text(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


def build_server(api: ApiClient) -> MCPServer:
    @asynccontextmanager
    async def lifespan(_: MCPServer) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await api.aclose()

    server = MCPServer(
        SERVER_NAME,
        instructions="授業タスク・選考トラッカーAPIのデータ（授業・課題・企業・選考ステップ・企業タスク）を扱う。",
        lifespan=lifespan,
    )

    # ツールの結果は、APIの応答JSONをそのまま1つのテキストとして返す。
    def read_tool(name: str, title: str, description: str):
        return server.tool(
            name=name,
            title=title,
            description=f"{description}{_READ_ONLY_NOTE}",
            annotations=_READ_ONLY,
            structured_output=False,
        )

    @read_tool(
        "list_courses",
        "授業一覧",
        "授業の一覧を取得する（GET /courses）。",
    )
    async def list_courses() -> str:
        return _to_text(await api.get("/courses"))

    @read_tool(
        "get_course",
        "授業詳細",
        "指定したidの授業を取得する（GET /courses/{course_id}）。課題は含まない。",
    )
    async def get_course(course_id: int) -> str:
        return _to_text(await api.get(f"/courses/{course_id}"))

    @read_tool(
        "list_assignments",
        "授業ごとの課題一覧",
        "指定した授業に属する課題の一覧を取得する（GET /courses/{course_id}/assignments）。",
    )
    async def list_assignments(course_id: int) -> str:
        return _to_text(await api.get(f"/courses/{course_id}/assignments"))

    @read_tool(
        "get_assignment",
        "課題詳細",
        "指定したidの課題を取得する（GET /assignments/{assignment_id}）。",
    )
    async def get_assignment(assignment_id: int) -> str:
        return _to_text(await api.get(f"/assignments/{assignment_id}"))

    @read_tool(
        "list_upcoming_assignments",
        "締切が近い課題",
        "未提出で締切が設定された課題を、締切の早い順に授業名つきで取得する"
        "（GET /assignments/upcoming）。",
    )
    async def list_upcoming_assignments() -> str:
        return _to_text(await api.get("/assignments/upcoming"))

    @read_tool(
        "list_companies",
        "企業一覧",
        "企業の一覧を取得する（GET /companies）。",
    )
    async def list_companies() -> str:
        return _to_text(await api.get("/companies"))

    @read_tool(
        "get_company",
        "企業詳細",
        "指定したidの企業を取得する（GET /companies/{company_id}）。"
        "選考ステップ・企業タスクは含まない。",
    )
    async def get_company(company_id: int) -> str:
        return _to_text(await api.get(f"/companies/{company_id}"))

    @read_tool(
        "list_interview_steps",
        "企業ごとの選考ステップ一覧",
        "指定した企業の選考ステップの一覧を取得する"
        "（GET /companies/{company_id}/interview-steps）。",
    )
    async def list_interview_steps(company_id: int) -> str:
        return _to_text(await api.get(f"/companies/{company_id}/interview-steps"))

    @read_tool(
        "list_upcoming_interview_steps",
        "直近の選考ステップ",
        "全企業の選考ステップを予定日の早い順に取得する。予定日が未設定のものは末尾に含まれる"
        "（GET /interview-steps/upcoming）。",
    )
    async def list_upcoming_interview_steps() -> str:
        return _to_text(await api.get("/interview-steps/upcoming"))

    @read_tool(
        "list_company_tasks",
        "企業ごとの企業タスク一覧",
        "指定した企業の企業タスクの一覧を取得する（GET /companies/{company_id}/company-tasks）。",
    )
    async def list_company_tasks(company_id: int) -> str:
        return _to_text(await api.get(f"/companies/{company_id}/company-tasks"))

    return server
