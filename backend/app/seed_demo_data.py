"""デモ環境用シードデータ投入スクリプト。

本アプリをポートフォリオとして公開し、訪問者が公開済みのデモ用API Keyで
フルCRUD操作を試せるようにするにあたり、荒らし・スパムで汚れたデータを
安全な状態に戻すための土台。実行するたびに案件・タスク・稼働ログ・企業・
選考ステップ・企業タスクの全テーブルの既存データを物理削除してから、
実在の人物・企業を想起させない固定のダミーデータを再投入する（冪等）。

DB全体を消去する操作であるため、HTTPエンドポイントとしては公開せず、
サーバープロセスとは独立したスクリプトとして実行する。

実行方法:
    uv run --directory backend python -m app.seed_demo_data
（デプロイ先のコンテナ内では、WORKDIR直下に app パッケージが配置されるため
`python -m app.seed_demo_data` だけで実行できる。スケジューラへの登録は対象外。）
"""

from datetime import date, datetime, time, timedelta

from sqlalchemy.orm import Session

from app import models
from app.database import SessionLocal, init_db
from app.status_transitions import (
    InterviewStepPrepStatus,
    InterviewStepResult,
    ProjectStatus,
    TaskStatus,
)


def seed(db: Session, today: date | None = None) -> dict[str, int]:
    """全テーブルを固定のダミーデータで置き換える。

    `today`を基準にした相対的な日付・日時のみを使う（`datetime.now()`等の
    実行タイミング依存の値は使わない）ため、同じ日に何度実行しても
    投入される内容は常に同一になる。
    """
    today = today or date.today()

    # 子→親の順で全件を物理削除する。is_deletedによる論理削除ではなく実削除
    # にすることで、荒らし・スパムによって追加・変更・削除された既存データの
    # 状態によらず、実行後は必ず下記の固定データのみが残る状態に収束させる。
    # synchronize_session=Falseで、削除件数分のUPDATE同期のためにセッション内の
    # 既存オブジェクトを走査させない（呼び出し元がすでに参照を保持している場合の
    # 余分な整合処理を避ける）。削除後に採番されるIDが、セッションに残った古い
    # オブジェクトのIDと衝突して警告が出ないよう、identity mapを明示的に空にする。
    db.query(models.WorkLog).delete(synchronize_session=False)
    db.query(models.Task).delete(synchronize_session=False)
    db.query(models.Project).delete(synchronize_session=False)
    db.query(models.InterviewStep).delete(synchronize_session=False)
    db.query(models.CompanyTask).delete(synchronize_session=False)
    db.query(models.Company).delete(synchronize_session=False)
    db.expunge_all()

    projects = [
        models.Project(
            name="ECサイトリニューアル案件",
            client_name="架空コマース株式会社",
            status=ProjectStatus.契約中,
            reward=450000,
            applied_date=today - timedelta(days=30),
            deadline=today + timedelta(days=20),
            platform="CrowdWorks",
            memo="フロントエンド刷新がメインスコープ",
        ),
        models.Project(
            name="業務システム保守運用",
            client_name="デモ工業株式会社",
            status=ProjectStatus.納品済み,
            reward=200000,
            applied_date=today - timedelta(days=60),
            deadline=None,
            platform="ランサーズ",
            memo=None,
        ),
        models.Project(
            name="コーポレートサイト制作",
            client_name="サンプル物産株式会社",
            status=ProjectStatus.提案中,
            reward=150000,
            applied_date=today - timedelta(days=5),
            deadline=today + timedelta(days=15),
            platform="Findy Freelance",
            memo="提案書提出済み、返答待ち",
        ),
    ]
    db.add_all(projects)
    db.flush()

    companies = [
        models.Company(name="架空フーズ株式会社"),
        models.Company(name="サンプルテクノロジーズ株式会社"),
        models.Company(name="デモ商事合同会社"),
    ]
    db.add_all(companies)
    db.flush()

    tasks = [
        models.Task(
            project_id=projects[0].id, name="デザインカンプ作成", status=TaskStatus.完了
        ),
        models.Task(
            project_id=projects[0].id, name="フロントエンド実装", status=TaskStatus.処理中
        ),
        models.Task(
            project_id=projects[1].id, name="月次保守対応", status=TaskStatus.処理中
        ),
        models.Task(
            project_id=projects[1].id, name="バグ修正対応", status=TaskStatus.未着手
        ),
        models.Task(
            project_id=projects[2].id, name="要件ヒアリング", status=TaskStatus.未着手
        ),
    ]
    db.add_all(tasks)
    db.flush()

    front_end_task = tasks[1]
    bug_fix_task = tasks[3]
    maintenance_task = tasks[2]

    work_logs = [
        # 完了済みログ（実質時給の算出材料になる）
        models.WorkLog(
            task_id=front_end_task.id,
            started_at=datetime.combine(today - timedelta(days=2), time(10, 0)),
            ended_at=datetime.combine(today - timedelta(days=2), time(15, 0)),
            memo="トップページ実装",
        ),
        # 進行中ログ（GET /work-logs/running で確認できる状態にする）
        models.WorkLog(
            task_id=front_end_task.id,
            started_at=datetime.combine(today, time(9, 0)),
            ended_at=None,
            memo=None,
        ),
        models.WorkLog(
            task_id=maintenance_task.id,
            started_at=datetime.combine(today - timedelta(days=1), time(9, 0)),
            ended_at=datetime.combine(today - timedelta(days=1), time(11, 30)),
            memo="月次レポート対応",
        ),
        # 別タスク・別案件でも並行して進行中ログがあることを確認できる状態にする
        models.WorkLog(
            task_id=bug_fix_task.id,
            started_at=datetime.combine(today, time(13, 0)),
            ended_at=None,
            memo="不具合調査中",
        ),
    ]
    db.add_all(work_logs)

    interview_steps = [
        models.InterviewStep(
            company_id=companies[0].id,
            type="書類選考",
            date=today + timedelta(days=3),
            prep_status=InterviewStepPrepStatus.準備万端,
            result=InterviewStepResult.未定,
            memo="オンライン提出済み",
        ),
        models.InterviewStep(
            company_id=companies[0].id,
            type="一次面接",
            date=today + timedelta(days=10),
            prep_status=InterviewStepPrepStatus.準備中,
            result=InterviewStepResult.未定,
            memo=None,
        ),
        models.InterviewStep(
            company_id=companies[1].id,
            type="書類選考",
            date=today - timedelta(days=5),
            prep_status=InterviewStepPrepStatus.完了,
            result=InterviewStepResult.通過,
            memo="通過連絡あり",
        ),
        models.InterviewStep(
            company_id=companies[1].id,
            type="最終面接",
            date=today + timedelta(days=1),
            prep_status=InterviewStepPrepStatus.準備万端,
            result=InterviewStepResult.未定,
            memo="模擬面接を実施予定",
        ),
        models.InterviewStep(
            company_id=companies[2].id,
            type="カジュアル面談",
            date=None,
            prep_status=InterviewStepPrepStatus.準備中,
            result=InterviewStepResult.未定,
            memo="日程調整中",
        ),
    ]
    db.add_all(interview_steps)

    company_tasks = [
        models.CompanyTask(
            company_id=companies[0].id,
            name="想定質問リストの作成",
            status=TaskStatus.処理中,
            memo=None,
        ),
        models.CompanyTask(
            company_id=companies[0].id,
            name="ポートフォリオ資料の更新",
            status=TaskStatus.完了,
            memo=None,
        ),
        models.CompanyTask(
            company_id=companies[1].id,
            name="お礼メールの送付",
            status=TaskStatus.未着手,
            memo=None,
        ),
        models.CompanyTask(
            company_id=companies[2].id,
            name="日程調整の返信",
            status=TaskStatus.未着手,
            memo="候補日を3つ提示",
        ),
    ]
    db.add_all(company_tasks)
    db.flush()

    return {
        "project": len(projects),
        "task": len(tasks),
        "work_log": len(work_logs),
        "company": len(companies),
        "interview_step": len(interview_steps),
        "company_task": len(company_tasks),
    }


def main() -> None:
    init_db()
    db = SessionLocal()
    try:
        counts = seed(db)
        db.commit()
    finally:
        db.close()

    print("デモ用シードデータを投入しました。")
    for table, count in counts.items():
        print(f"  {table}: {count}件")


if __name__ == "__main__":
    main()
