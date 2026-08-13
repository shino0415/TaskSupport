from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# app.database.Base.metadataにテーブル定義を登録するため、モデルを一度importする
# （alembic.ini の prepend_sys_path で backend/ が sys.path に追加されているため import できる）。
from app import models  # noqa: F401
from app.database import DATABASE_URL, Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# autogenerate対象のメタデータ。テーブル設計はapp.modelsのSQLAlchemyモデルを正とする。
target_metadata = Base.metadata


def get_url() -> str:
    # alembic.iniにsqlalchemy.urlの指定は無い。Config.set_main_option()で明示的に
    # 上書きされていればそれを優先し（テストではこの方式で一時DBを指定する）、
    # 無ければアプリ本体と同じapp.database.DATABASE_URL（DATABASE_URL環境変数、
    # 未設定時はsqlite:///./app.db）にフォールバックする。
    return config.get_main_option("sqlalchemy.url") or DATABASE_URL


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # render_as_batch=True: SQLiteはALTER TABLEでの列変更・削除の制約が多いため、
        # 一時テーブルへの作り替えを介するAlembicのbatchモードを常時有効にする。
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
