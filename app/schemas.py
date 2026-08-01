"""Pydanticスキーマ定義（リクエスト/レスポンス）。

mass assignment対策として、作成用スキーマには is_deleted 等のクライアントが
操作すべきでないフィールドを含めない。
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.status_transitions import PROJECT_STATUS_GRAPH

# ステータス集合はapp.status_transitionsのグラフ定義を単一の情報源とする
# （ここで独自に列挙すると、グラフ側だけ更新された際に不整合が起きるため）。
ProjectStatus = Literal[*PROJECT_STATUS_GRAPH]


class ProjectBase(BaseModel):
    name: str
    client_name: str
    reward: int
    applied_date: date
    deadline: date | None = None
    platform: str
    memo: str | None = None


class ProjectCreate(ProjectBase):
    status: ProjectStatus


class ProjectRead(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    is_deleted: bool
