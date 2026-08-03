"""Pydanticスキーマ定義（リクエスト/レスポンス）。

mass assignment対策として、作成用スキーマには is_deleted 等のクライアントが
操作すべきでないフィールドを含めない。
"""

from datetime import date, datetime
from datetime import date as _Date
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator

from app.status_transitions import (
    INTERVIEW_STEP_PREP_STATUS_GRAPH,
    INTERVIEW_STEP_RESULT_GRAPH,
    PROJECT_STATUS_GRAPH,
    TASK_STATUS_GRAPH,
)

# ステータス集合はapp.status_transitionsのグラフ定義を単一の情報源とする
# （ここで独自に列挙すると、グラフ側だけ更新された際に不整合が起きるため）。
ProjectStatus = Literal[*PROJECT_STATUS_GRAPH]
TaskStatus = Literal[*TASK_STATUS_GRAPH]
InterviewStepPrepStatus = Literal[*INTERVIEW_STEP_PREP_STATUS_GRAPH]
InterviewStepResult = Literal[*INTERVIEW_STEP_RESULT_GRAPH]

# DB上nullable=FalseなProjectのカラム（PATCHで明示的なnullを許可しない項目）。
# deadline/memoはnullable=TrueのためPATCHでのnullクリアを許可する。
_PROJECT_REQUIRED_UPDATE_FIELDS = (
    "name",
    "client_name",
    "status",
    "reward",
    "applied_date",
    "platform",
)


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


class ProjectUpdate(BaseModel):
    name: str | None = None
    client_name: str | None = None
    status: ProjectStatus | None = None
    reward: int | None = None
    applied_date: date | None = None
    deadline: date | None = None
    platform: str | None = None
    memo: str | None = None

    @model_validator(mode="after")
    def _reject_explicit_null_for_required_fields(self) -> Self:
        # 未指定（exclude_unset対象外）は許可するが、必須項目（DB nullable=False）
        # に明示的なnullを送った場合はIntegrityError(500)ではなく422で弾く。
        null_required_fields = [
            field
            for field in _PROJECT_REQUIRED_UPDATE_FIELDS
            if field in self.model_fields_set and getattr(self, field) is None
        ]
        if null_required_fields:
            fields = ", ".join(null_required_fields)
            raise ValueError(f"次のフィールドにnullは指定できません: {fields}")
        return self


class ProjectPatchResponse(ProjectRead):
    warning: str | None = None


# DB上nullable=FalseなTaskのカラム（PATCHで明示的なnullを許可しない項目）。
# memoはnullable=TrueのためPATCHでのnullクリアを許可する。
_TASK_REQUIRED_UPDATE_FIELDS = ("name", "status")


class TaskBase(BaseModel):
    name: str
    memo: str | None = None


class TaskCreate(TaskBase):
    status: TaskStatus


class TaskRead(TaskBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    status: str
    is_deleted: bool


class TaskUpdate(BaseModel):
    name: str | None = None
    status: TaskStatus | None = None
    memo: str | None = None

    @model_validator(mode="after")
    def _reject_explicit_null_for_required_fields(self) -> Self:
        null_required_fields = [
            field
            for field in _TASK_REQUIRED_UPDATE_FIELDS
            if field in self.model_fields_set and getattr(self, field) is None
        ]
        if null_required_fields:
            fields = ", ".join(null_required_fields)
            raise ValueError(f"次のフィールドにnullは指定できません: {fields}")
        return self


class TaskPatchResponse(TaskRead):
    warning: str | None = None


class WorkLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    started_at: datetime | None = None
    ended_at: datetime | None = None
    memo: str | None = None
    is_deleted: bool


class RunningWorkLogRead(BaseModel):
    """稼働ログ横断一覧（/work-logs/running）専用のレスポンススキーマ。

    どのタスク・案件に属するかを判別できるよう、WorkLogRead相当のフィールドに
    加えてtask_name/project_id/project_nameを含める（横断一覧では所属先を
    追うためにIDだけでなく名前も一緒に返した方が呼び出し側の追加問い合わせを
    減らせるため）。
    """

    id: int
    task_id: int
    task_name: str
    project_id: int
    project_name: str
    started_at: datetime | None = None
    ended_at: datetime | None = None
    memo: str | None = None
    is_deleted: bool


class HourlyRateRead(BaseModel):
    project_id: int
    reward: int
    total_work_hours: float
    hourly_rate: float | None = None


class CompanyBase(BaseModel):
    name: str


class CompanyCreate(CompanyBase):
    pass


class CompanyRead(CompanyBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_deleted: bool


class InterviewStepBase(BaseModel):
    type: str
    # フィールド名が"date"のため、素の`date`型を直接注釈に使うと、クラス本体の
    # 実行順序（値の代入 → 注釈評価の順）でフィールド名自身が型名を上書きしてしまい
    # `date | None`評価時にTypeErrorになる。別名importの`_Date`で回避する。
    date: _Date | None = None
    memo: str | None = None


class InterviewStepCreate(InterviewStepBase):
    # 新規追加される選考ステップは、常にグラフの起点（未着手の状態）から始まる
    # のが自然なため、デフォルト値を設定しクライアントに毎回の指定を求めない。
    prep_status: InterviewStepPrepStatus = "準備中"
    result: InterviewStepResult = "未定"


class InterviewStepRead(InterviewStepBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company_id: int
    prep_status: str
    result: str
    is_deleted: bool


# DB上nullable=FalseなInterviewStepのカラム（PATCHで明示的なnullを許可しない項目）。
# date/memoはnullable=TrueのためPATCHでのnullクリアを許可する。
_INTERVIEW_STEP_REQUIRED_UPDATE_FIELDS = ("type", "prep_status", "result")


class InterviewStepUpdate(BaseModel):
    type: str | None = None
    date: _Date | None = None
    prep_status: InterviewStepPrepStatus | None = None
    result: InterviewStepResult | None = None
    memo: str | None = None

    @model_validator(mode="after")
    def _reject_explicit_null_for_required_fields(self) -> Self:
        null_required_fields = [
            field
            for field in _INTERVIEW_STEP_REQUIRED_UPDATE_FIELDS
            if field in self.model_fields_set and getattr(self, field) is None
        ]
        if null_required_fields:
            fields = ", ".join(null_required_fields)
            raise ValueError(f"次のフィールドにnullは指定できません: {fields}")
        return self


class InterviewStepPatchResponse(InterviewStepRead):
    warning: str | None = None
