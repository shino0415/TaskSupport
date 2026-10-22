"""Pydanticスキーマ定義（リクエスト/レスポンス）。

mass assignment対策として、作成用スキーマには is_deleted 等のクライアントが
操作すべきでないフィールドを含めない。
"""

from datetime import date as _Date
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    NaiveDatetime,
    model_validator,
)

# ステータス集合はapp.status_transitionsで定義したEnumを単一の情報源とする
# （ここで独自に列挙すると、Enum側だけ更新された際に不整合が起きるため）。
from app.status_transitions import (
    AssignmentStatus,
    CompanyTaskStatus,
    InterviewStepPrepStatus,
    InterviewStepResult,
)


def _reject_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("空白のみの値は指定できません")
    return value


# 入力値の上限・範囲（決定事項「入力値の上限とバリデーション強化」）。
# 既存DBに上限を超える値が残っていても取得が失敗しないよう、これらの型は
# 作成・更新用スキーマにのみ使い、Read系スキーマでは素のstr/intのままにする。
NAME_MAX_LENGTH = 32
MEMO_MAX_LENGTH = 1000

# 必須の名前項目。空文字・空白のみを「名前が無い」ものとして拒否する（値自体は加工しない）。
NonBlankStr = Annotated[
    str, Field(min_length=1, max_length=NAME_MAX_LENGTH), AfterValidator(_reject_blank)
]
# 空白チェックを従来から行っていない名前系項目（企業名・企業タスク名・選考ステップ種別）用。
NameStr = Annotated[str, Field(max_length=NAME_MAX_LENGTH)]
MemoStr = Annotated[str, Field(max_length=MEMO_MAX_LENGTH)]

DayOfWeek = Literal["月", "火", "水", "木", "金", "土", "日"]
Term = Literal["前期", "後期", "通年"]
Period = Annotated[int, Field(ge=1, le=6)]
AcademicYear = Annotated[int, Field(ge=2000, le=2100)]


class CourseCreate(BaseModel):
    name: NonBlankStr
    day_of_week: DayOfWeek | None = None
    period: Period | None = None
    academic_year: AcademicYear | None = None
    term: Term | None = None
    memo: MemoStr | None = None


class CourseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    day_of_week: str | None
    period: int | None
    academic_year: int | None
    term: str | None
    memo: str | None
    is_deleted: bool


# DB上nullable=FalseなCourseのカラム（PATCHで明示的なnullを許可しない項目）。
_COURSE_REQUIRED_UPDATE_FIELDS = ("name",)


class CourseUpdate(BaseModel):
    name: NonBlankStr | None = None
    day_of_week: DayOfWeek | None = None
    period: Period | None = None
    academic_year: AcademicYear | None = None
    term: Term | None = None
    memo: MemoStr | None = None

    @model_validator(mode="after")
    def _reject_explicit_null_for_required_fields(self) -> Self:
        null_required_fields = [
            field
            for field in _COURSE_REQUIRED_UPDATE_FIELDS
            if field in self.model_fields_set and getattr(self, field) is None
        ]
        if null_required_fields:
            fields = ", ".join(null_required_fields)
            raise ValueError(f"次のフィールドにnullは指定できません: {fields}")
        return self


SubmissionMethod = Literal["WebClass", "紙", "その他"]


# deadlineは旧WorkLog.started_atと同じくタイムゾーン無しの日時として保存する。
# オフセット付きの値を受け付けるとSQLite保存時にオフセットが黙って捨てられ、
# 別の時刻として記録されてしまうため、NaiveDatetimeで422として拒否する。
class AssignmentCreate(BaseModel):
    name: NonBlankStr
    # 新規課題は常にグラフの起点から始まるのが自然なため、省略時は未着手とする。
    status: AssignmentStatus = AssignmentStatus.未着手
    deadline: NaiveDatetime | None = None
    submission_method: SubmissionMethod | None = None
    memo: MemoStr | None = None


class AssignmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    name: str
    status: str
    deadline: datetime | None
    submission_method: str | None
    memo: str | None
    is_deleted: bool


# DB上nullable=FalseなAssignmentのカラム（PATCHで明示的なnullを許可しない項目）。
_ASSIGNMENT_REQUIRED_UPDATE_FIELDS = ("name", "status")


class AssignmentUpdate(BaseModel):
    name: NonBlankStr | None = None
    status: AssignmentStatus | None = None
    deadline: NaiveDatetime | None = None
    submission_method: SubmissionMethod | None = None
    memo: MemoStr | None = None

    @model_validator(mode="after")
    def _reject_explicit_null_for_required_fields(self) -> Self:
        null_required_fields = [
            field
            for field in _ASSIGNMENT_REQUIRED_UPDATE_FIELDS
            if field in self.model_fields_set and getattr(self, field) is None
        ]
        if null_required_fields:
            fields = ", ".join(null_required_fields)
            raise ValueError(f"次のフィールドにnullは指定できません: {fields}")
        return self


class AssignmentPatchResponse(AssignmentRead):
    warning: str | None = None


class UpcomingAssignmentRead(AssignmentRead):
    course_name: str


class CompanyCreate(BaseModel):
    name: NameStr


class CompanyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    id: int
    is_deleted: bool


class InterviewStepCreate(BaseModel):
    type: NameStr
    # フィールド名が"date"のため、素の`date`型を直接注釈に使うと、クラス本体の
    # 実行順序（値の代入 → 注釈評価の順）でフィールド名自身が型名を上書きしてしまい
    # `date | None`評価時にTypeErrorになる。別名importの`_Date`で回避する。
    date: _Date | None = None
    memo: MemoStr | None = None
    # 新規追加される選考ステップは、常にグラフの起点（未着手の状態）から始まる
    # のが自然なため、デフォルト値を設定しクライアントに毎回の指定を求めない。
    prep_status: InterviewStepPrepStatus = InterviewStepPrepStatus.準備中
    result: InterviewStepResult = InterviewStepResult.未定


class InterviewStepRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    type: str
    date: _Date | None = None
    memo: str | None = None
    id: int
    company_id: int
    prep_status: str
    result: str
    is_deleted: bool


# DB上nullable=FalseなInterviewStepのカラム（PATCHで明示的なnullを許可しない項目）。
# date/memoはnullable=TrueのためPATCHでのnullクリアを許可する。
_INTERVIEW_STEP_REQUIRED_UPDATE_FIELDS = ("type", "prep_status", "result")


class InterviewStepUpdate(BaseModel):
    type: NameStr | None = None
    date: _Date | None = None
    prep_status: InterviewStepPrepStatus | None = None
    result: InterviewStepResult | None = None
    memo: MemoStr | None = None

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


class CompanyTaskCreate(BaseModel):
    name: NameStr
    memo: MemoStr | None = None
    status: CompanyTaskStatus


class CompanyTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    memo: str | None = None
    id: int
    company_id: int
    status: str
    is_deleted: bool


class CompanyTaskUpdate(BaseModel):
    name: NameStr | None = None
    status: CompanyTaskStatus | None = None
    memo: MemoStr | None = None

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
