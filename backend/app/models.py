"""SQLAlchemyモデル定義。

授業系（Course/Assignment）と選考系（Company/InterviewStep/CompanyTask）は
完全に独立したドメインであり、relationは互いに持たない。
"""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.status_transitions import (
    CompanyTaskStatus,
    InterviewStepPrepStatus,
    InterviewStepResult,
)


class Course(Base):
    __tablename__ = "course"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    day_of_week: Mapped[str | None] = mapped_column(String, nullable=True)
    period: Mapped[int | None] = mapped_column(Integer, nullable=True)
    academic_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    term: Mapped[str | None] = mapped_column(String, nullable=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )


class Assignment(Base):
    __tablename__ = "assignment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(Integer, ForeignKey("course.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    submission_method: Mapped[str | None] = mapped_column(String, nullable=True)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )


class Company(Base):
    __tablename__ = "company"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )


class InterviewStep(Base):
    __tablename__ = "interview_step"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("company.id"), nullable=False
    )
    type: Mapped[str] = mapped_column(String, nullable=False)
    date: Mapped[date | None] = mapped_column(Date, nullable=True)
    prep_status: Mapped[InterviewStepPrepStatus] = mapped_column(String, nullable=False)
    result: Mapped[InterviewStepResult] = mapped_column(String, nullable=False)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )


class CompanyTask(Base):
    """企業タスク。Companyの子（1対多）。稼働時間計測・時給換算に関する項目は
    一切持たない（決定事項「企業タスク（CompanyTask）の稼働ログ対象範囲」参照）。
    """

    __tablename__ = "company_task"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("company.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    # DB上は素のTEXT/String型のまま（sqlalchemy.Enum型に変えるとCHECK制約が追加され
    # 挙動が変わるため使わない）。Mapped[CompanyTaskStatus]は型チェッカー向けの注釈。
    status: Mapped[CompanyTaskStatus] = mapped_column(String, nullable=False)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
