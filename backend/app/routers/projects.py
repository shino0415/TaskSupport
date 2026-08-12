"""案件（Project）の作成・参照・更新・削除エンドポイント。"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import (
    HourlyRateRead,
    ProjectCreate,
    ProjectPatchResponse,
    ProjectRead,
    ProjectStatus,
    ProjectUpdate,
)
from app.status_transitions import PROJECT_STATUS_GRAPH, check_backward_transition

router = APIRouter(prefix="/projects", tags=["projects"])


def _get_active_project_or_404(db: Session, project_id: int) -> models.Project:
    project = (
        db.query(models.Project)
        .filter(models.Project.id == project_id, models.Project.is_deleted.is_(False))
        .first()
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> models.Project:
    project = models.Project(**payload.model_dump())
    db.add(project)
    db.commit()
    return project


@router.get("", response_model=list[ProjectRead])
def list_projects(
    project_status: ProjectStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
) -> list[models.Project]:
    query = db.query(models.Project).filter(models.Project.is_deleted.is_(False))
    if project_status is not None:
        query = query.filter(models.Project.status == project_status)
    return query.all()


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, db: Session = Depends(get_db)) -> models.Project:
    return _get_active_project_or_404(db, project_id)


@router.patch("/{project_id}", response_model=ProjectPatchResponse)
def update_project(
    project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)
) -> ProjectPatchResponse:
    project = _get_active_project_or_404(db, project_id)

    # exclude_unsetにより、リクエストに含まれなかったフィールドと明示的なnull
    # （deadline/memoのクリア）を区別する。
    update_data = payload.model_dump(exclude_unset=True)

    warning = None
    if "status" in update_data and update_data["status"] != project.status:
        warning = check_backward_transition(
            PROJECT_STATUS_GRAPH, project.status, update_data["status"]
        )

    for field, value in update_data.items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)

    return ProjectPatchResponse(**ProjectRead.model_validate(project).model_dump(), warning=warning)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db)) -> None:
    project = _get_active_project_or_404(db, project_id)
    project.is_deleted = True
    db.commit()


@router.get("/{project_id}/hourly-rate", response_model=HourlyRateRead)
def get_hourly_rate(project_id: int, db: Session = Depends(get_db)) -> HourlyRateRead:
    project = _get_active_project_or_404(db, project_id)

    # 進行中（ended_at IS NULL）のログは、終了時刻が未確定で稼働時間が変動し
    # 続けてしまうため合計時間の計算対象から除外する（完了済みログのみ集計）。
    completed_logs = (
        db.query(models.WorkLog)
        .join(models.Task, models.WorkLog.task_id == models.Task.id)
        .filter(
            models.Task.project_id == project_id,
            models.Task.is_deleted.is_(False),
            models.WorkLog.is_deleted.is_(False),
            models.WorkLog.ended_at.isnot(None),
        )
        .all()
    )
    total_seconds = sum(
        (log.ended_at - log.started_at).total_seconds()
        for log in completed_logs
        if log.started_at is not None
    )
    total_work_hours = total_seconds / 3600

    # 合計稼働時間が0の場合、0除算を避けるためhourly_rateはnullを返す
    # （0円/時と誤解されうる0や、JSONで表現できない無限大を避けるため）。
    hourly_rate = project.reward / total_work_hours if total_work_hours > 0 else None

    return HourlyRateRead(
        project_id=project.id,
        reward=project.reward,
        total_work_hours=total_work_hours,
        hourly_rate=hourly_rate,
    )
