"""デモ環境用シードデータ投入スクリプト。

本アプリをポートフォリオとして公開し、訪問者が公開済みのデモ用API Keyで
フルCRUD操作を試せるようにするにあたり、荒らし・スパムで汚れたデータを
安全な状態に戻すための土台。実行するたびに授業・課題・企業・選考ステップ・
企業タスクの全テーブルの既存データを物理削除してから、実在の人物・企業を想起させない固定のダミーデータを再投入する（冪等）。

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
    AssignmentStatus,
    CompanyTaskStatus,
    InterviewStepPrepStatus,
    InterviewStepResult,
)


def seed(db: Session, today: date | None = None) -> dict[str, int]:
    """全テーブルを固定のダミーデータで置き換える。

    `today`を基準にした相対的な日付・日時（課題の提出期限を含む）のみを使う（`datetime.now()`等の
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
    db.query(models.Assignment).delete(synchronize_session=False)
    db.query(models.Course).delete(synchronize_session=False)
    db.query(models.InterviewStep).delete(synchronize_session=False)
    db.query(models.CompanyTask).delete(synchronize_session=False)
    db.query(models.Company).delete(synchronize_session=False)
    db.expunge_all()

    # 4月始まりの年度。固定の年を書くと時間が経つにつれ古いデモデータに見えるため。
    academic_year = today.year if today.month >= 4 else today.year - 1

    courses = [
        models.Course(
            name="線形代数入門",
            day_of_week="月",
            period=2,
            academic_year=academic_year,
            term="前期",
            memo="毎回小テストあり",
        ),
        models.Course(
            name="プログラミング演習",
            day_of_week="水",
            period=3,
            academic_year=academic_year,
            term="通年",
            memo=None,
        ),
        models.Course(
            name="英語コミュニケーション",
            day_of_week="金",
            period=1,
            academic_year=academic_year,
            term="後期",
            memo="出席重視",
        ),
        # オンデマンド授業を想定し、曜日・時限・学期は未設定にする
        models.Course(
            name="キャリアデザイン（オンデマンド）",
            day_of_week=None,
            period=None,
            academic_year=academic_year,
            term=None,
            memo=None,
        ),
    ]
    db.add_all(courses)
    db.flush()

    def deadline_at(days: int, hour: int, minute: int = 0) -> datetime:
        return datetime.combine(today + timedelta(days=days), time(hour, minute))

    assignments = [
        models.Assignment(
            course_id=courses[0].id,
            name="第3回 演習問題",
            status=AssignmentStatus.提出済み,
            deadline=deadline_at(-7, 23, 59),
            submission_method="WebClass",
            memo=None,
        ),
        models.Assignment(
            course_id=courses[0].id,
            name="第4回 演習問題",
            status=AssignmentStatus.未提出,
            deadline=deadline_at(-1, 23, 59),
            submission_method="WebClass",
            memo="解答は完成済み、提出を忘れている",
        ),
        models.Assignment(
            course_id=courses[1].id,
            name="課題2: ソートアルゴリズムの実装",
            status=AssignmentStatus.取組中,
            deadline=deadline_at(2, 23, 59),
            submission_method="WebClass",
            memo=None,
        ),
        models.Assignment(
            course_id=courses[1].id,
            name="最終課題 企画書",
            status=AssignmentStatus.未着手,
            deadline=deadline_at(21, 17, 0),
            submission_method="その他",
            memo="提出先は授業内で指示予定",
        ),
        models.Assignment(
            course_id=courses[2].id,
            name="エッセイ（500語）",
            status=AssignmentStatus.未提出,
            deadline=deadline_at(1, 9, 0),
            submission_method="紙",
            memo="授業開始時に回収",
        ),
        models.Assignment(
            course_id=courses[2].id,
            name="単語リストの復習",
            status=AssignmentStatus.未着手,
            deadline=None,
            submission_method=None,
            memo="期限なし、空き時間に進める",
        ),
        models.Assignment(
            course_id=courses[3].id,
            name="振り返りシート",
            status=AssignmentStatus.未着手,
            deadline=deadline_at(5, 23, 59),
            submission_method="その他",
            memo=None,
        ),
    ]
    db.add_all(assignments)

    companies = [
        models.Company(name="架空フーズ株式会社"),
        models.Company(name="サンプルテクノロジーズ株式会社"),
        models.Company(name="デモ商事合同会社"),
    ]
    db.add_all(companies)
    db.flush()

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
            status=CompanyTaskStatus.処理中,
            memo=None,
        ),
        models.CompanyTask(
            company_id=companies[0].id,
            name="ポートフォリオ資料の更新",
            status=CompanyTaskStatus.完了,
            memo=None,
        ),
        models.CompanyTask(
            company_id=companies[1].id,
            name="お礼メールの送付",
            status=CompanyTaskStatus.未着手,
            memo=None,
        ),
        models.CompanyTask(
            company_id=companies[2].id,
            name="日程調整の返信",
            status=CompanyTaskStatus.未着手,
            memo="候補日を3つ提示",
        ),
    ]
    db.add_all(company_tasks)
    db.flush()

    return {
        "course": len(courses),
        "assignment": len(assignments),
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
