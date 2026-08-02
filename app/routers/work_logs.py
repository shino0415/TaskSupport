"""稼働ログ（WorkLog）の計測開始・終了・参照・削除エンドポイント。

同一タスク内の多重start、案件間・タスク間の同時進行を許可する
（=進行中ログが複数存在してよい）。
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import WorkLogRead

router = APIRouter(tags=["work-logs"])


def _get_active_task_or_404(db: Session, task_id: int) -> models.Task:
    task = (
        db.query(models.Task)
        .filter(models.Task.id == task_id, models.Task.is_deleted.is_(False))
        .first()
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def _get_active_work_log_or_404(db: Session, work_log_id: int) -> models.WorkLog:
    work_log = (
        db.query(models.WorkLog)
        .filter(models.WorkLog.id == work_log_id, models.WorkLog.is_deleted.is_(False))
        .first()
    )
    if work_log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="WorkLog not found")
    return work_log


@router.post(
    "/tasks/{task_id}/work-logs/start",
    response_model=WorkLogRead,
    status_code=status.HTTP_201_CREATED,
)
def start_work_log(task_id: int, db: Session = Depends(get_db)) -> models.WorkLog:
    _get_active_task_or_404(db, task_id)
    # 多重start・案件/タスク間の同時進行を許可するため、進行中ログの有無は確認しない。
    work_log = models.WorkLog(task_id=task_id, started_at=datetime.now())
    db.add(work_log)
    db.commit()
    return work_log


@router.patch("/work-logs/{work_log_id}/stop", response_model=WorkLogRead)
def stop_work_log(work_log_id: int, db: Session = Depends(get_db)) -> models.WorkLog:
    work_log = _get_active_work_log_or_404(db, work_log_id)
    if work_log.ended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="WorkLog already stopped"
        )
    work_log.ended_at = datetime.now()
    db.commit()
    db.refresh(work_log)
    return work_log


@router.get("/tasks/{task_id}/work-logs", response_model=list[WorkLogRead])
def list_work_logs(task_id: int, db: Session = Depends(get_db)) -> list[models.WorkLog]:
    _get_active_task_or_404(db, task_id)
    return (
        db.query(models.WorkLog)
        .filter(models.WorkLog.task_id == task_id, models.WorkLog.is_deleted.is_(False))
        .all()
    )


@router.delete("/work-logs/{work_log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_work_log(work_log_id: int, db: Session = Depends(get_db)) -> None:
    work_log = _get_active_work_log_or_404(db, work_log_id)
    work_log.is_deleted = True
    db.commit()
