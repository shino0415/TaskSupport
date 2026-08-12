"""タスク（Task）の作成・参照・更新・削除エンドポイント。"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import TaskCreate, TaskPatchResponse, TaskRead, TaskUpdate
from app.status_transitions import TASK_STATUS_GRAPH, check_backward_transition

router = APIRouter(tags=["tasks"])


def _get_active_project_or_404(db: Session, project_id: int) -> models.Project:
    project = (
        db.query(models.Project)
        .filter(models.Project.id == project_id, models.Project.is_deleted.is_(False))
        .first()
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _get_active_task_or_404(db: Session, task_id: int) -> models.Task:
    task = (
        db.query(models.Task)
        .filter(models.Task.id == task_id, models.Task.is_deleted.is_(False))
        .first()
    )
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.post(
    "/projects/{project_id}/tasks", response_model=TaskRead, status_code=status.HTTP_201_CREATED
)
def create_task(
    project_id: int, payload: TaskCreate, db: Session = Depends(get_db)
) -> models.Task:
    _get_active_project_or_404(db, project_id)
    task = models.Task(project_id=project_id, **payload.model_dump())
    db.add(task)
    db.commit()
    return task


@router.get("/projects/{project_id}/tasks", response_model=list[TaskRead])
def list_tasks(project_id: int, db: Session = Depends(get_db)) -> list[models.Task]:
    _get_active_project_or_404(db, project_id)
    return (
        db.query(models.Task)
        .filter(models.Task.project_id == project_id, models.Task.is_deleted.is_(False))
        .all()
    )


@router.patch("/tasks/{task_id}", response_model=TaskPatchResponse)
def update_task(
    task_id: int, payload: TaskUpdate, db: Session = Depends(get_db)
) -> TaskPatchResponse:
    task = _get_active_task_or_404(db, task_id)

    update_data = payload.model_dump(exclude_unset=True)

    warning = None
    if "status" in update_data and update_data["status"] != task.status:
        warning = check_backward_transition(TASK_STATUS_GRAPH, task.status, update_data["status"])

    for field, value in update_data.items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)

    return TaskPatchResponse(**TaskRead.model_validate(task).model_dump(), warning=warning)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: Session = Depends(get_db)) -> None:
    task = _get_active_task_or_404(db, task_id)
    task.is_deleted = True
    db.commit()
