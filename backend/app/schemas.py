"""Pydanticスキーマ定義（リクエスト/レスポンス）。

mass assignment対策として、作成用スキーマには is_deleted 等のクライアントが
操作すべきでないフィールドを含めない。
"""

from datetime import date as _Date
from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator

# ステータス集合はapp.status_transitionsで定義したEnumを単一の情報源とする
# （ここで独自に列挙すると、Enum側だけ更新された際に不整合が起きるため）。
from app.status_transitions import (
    CompanyTaskStatus,
    InterviewStepPrepStatus,
    InterviewStepResult,
)


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
    prep_status: InterviewStepPrepStatus = InterviewStepPrepStatus.準備中
    result: InterviewStepResult = InterviewStepResult.未定


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


# DB上nullable=FalseなCompanyTaskのカラム（PATCHで明示的なnullを許可しない項目）。
# memoはnullable=TrueのためPATCHでのnullクリアを許可する。
_COMPANY_TASK_REQUIRED_UPDATE_FIELDS = ("name", "status")


class CompanyTaskBase(BaseModel):
    name: str
    memo: str | None = None


class CompanyTaskCreate(CompanyTaskBase):
    status: CompanyTaskStatus


class CompanyTaskRead(CompanyTaskBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company_id: int
    status: str
    is_deleted: bool


class CompanyTaskUpdate(BaseModel):
    name: str | None = None
    status: CompanyTaskStatus | None = None
    memo: str | None = None

    @model_validator(mode="after")
    def _reject_explicit_null_for_required_fields(self) -> Self:
        null_required_fields = [
            field
            for field in _COMPANY_TASK_REQUIRED_UPDATE_FIELDS
            if field in self.model_fields_set and getattr(self, field) is None
        ]
        if null_required_fields:
            fields = ", ".join(null_required_fields)
            raise ValueError(f"次のフィールドにnullは指定できません: {fields}")
        return self


class CompanyTaskPatchResponse(CompanyTaskRead):
    warning: str | None = None
