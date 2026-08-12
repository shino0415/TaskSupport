"""DB接続設定。SQLite + SQLAlchemyで、Base.metadata.create_allにより
テーブルを初期化する（Alembic等のマイグレーションツールは使わない）。
"""

import os

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def build_engine(database_url: str) -> Engine:
    # SQLiteはデフォルトで接続したスレッドでのみ使用可能なため、
    # FastAPIのリクエストごとに別スレッドから使われる場合に備えて許可する。
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args)


DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./app.db")
engine = build_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False, bind=engine)


def init_db(target_engine: Engine | None = None) -> None:
    """DBファイル・テーブルが存在しなければ作成する。"""
    from app import models  # noqa: F401  Base.metadata にテーブル定義を登録するため

    Base.metadata.create_all(bind=target_engine or engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
