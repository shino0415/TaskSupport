"""SQLAlchemyモデル定義。

案件系（Project/Task/WorkLog）と選考系（Company/InterviewStep）は
完全に独立したドメインであり、relationは互いに持たない。
"""

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.status_transitions import (
    InterviewStepPrepStatus,
    InterviewStepResult,
    ProjectStatus,
    TaskStatus,
)


class Project(Base):
    __tablename__ = "project"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    client_name: Mapped[str] = mapped_column(String, nullable=False)
    # DB上は素のTEXT/String型のまま（sqlalchemy.Enum型に変えるとCHECK制約が追加され
    # 挙動が変わるため使わない）。Mapped[ProjectStatus]はあくまで型チェッカー向けの注釈。
    status: Mapped[ProjectStatus] = mapped_column(String, nullable=False)
    reward: Mapped[int] = mapped_column(Integer, nullable=False)
    applied_date: Mapped[date] = mapped_column(Date, nullable=False)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    platform: Mapped[str] = mapped_column(String, nullable=False)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )


class Task(Base):
    __tablename__ = "task"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("project.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[TaskStatus] = mapped_column(String, nullable=False)
    memo: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )


class WorkLog(Base):
    __tablename__ = "work_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("task.id"), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
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
