"""課題（Assignment）の作成・参照・更新・削除エンドポイント。"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import (
    AssignmentCreate,
    AssignmentPatchResponse,
    AssignmentRead,
    AssignmentUpdate,
)
from app.status_transitions import ASSIGNMENT_STATUS_GRAPH, check_backward_transition

router = APIRouter(tags=["assignments"])

# SQLiteのINTEGERは符号付き64bitのため、範囲外の値をクエリに渡すとOverflowErrorで
# 500になる。範囲外のidは存在し得ないので、クエリ前に404として扱う。
_SQLITE_INT_MIN = -(2**63)
_SQLITE_INT_MAX = 2**63 - 1


def _is_storable_id(value: int) -> bool:
    return _SQLITE_INT_MIN <= value <= _SQLITE_INT_MAX


def _get_active_course_or_404(db: Session, course_id: int) -> models.Course:
    course = None
    if _is_storable_id(course_id):
        course = (
            db.query(models.Course)
            .filter(models.Course.id == course_id, models.Course.is_deleted.is_(False))
            .first()
        )
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _get_active_assignment_or_404(db: Session, assignment_id: int) -> models.Assignment:
    # 決定事項「論理削除済み授業に属する課題への個別操作の扱い」により、
    # 親授業の削除状態は見ず、課題自身のis_deletedのみで判定する。
    assignment = None
    if _is_storable_id(assignment_id):
        assignment = (
            db.query(models.Assignment)
            .filter(
                models.Assignment.id == assignment_id,
                models.Assignment.is_deleted.is_(False),
            )
            .first()
        )
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment


@router.post(
    "/courses/{course_id}/assignments",
    response_model=AssignmentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_assignment(
    course_id: int, payload: AssignmentCreate, db: Session = Depends(get_db)
) -> models.Assignment:
    _get_active_course_or_404(db, course_id)
    assignment = models.Assignment(course_id=course_id, **payload.model_dump())
    db.add(assignment)
    db.commit()
    return assignment


@router.get("/courses/{course_id}/assignments", response_model=list[AssignmentRead])
def list_assignments(course_id: int, db: Session = Depends(get_db)) -> list[models.Assignment]:
    _get_active_course_or_404(db, course_id)
    return (
        db.query(models.Assignment)
        .filter(
            models.Assignment.course_id == course_id,
            models.Assignment.is_deleted.is_(False),
        )
        .all()
    )


# /assignments/upcoming 等の固定パスを追加する場合は、/assignments/{assignment_id}
# として解釈されないよう、このコメントより上（先に登録される位置）に定義すること。


@router.get("/assignments/{assignment_id}", response_model=AssignmentRead)
def get_assignment(assignment_id: int, db: Session = Depends(get_db)) -> models.Assignment:
    return _get_active_assignment_or_404(db, assignment_id)


@router.patch("/assignments/{assignment_id}", response_model=AssignmentPatchResponse)
def update_assignment(
    assignment_id: int, payload: AssignmentUpdate, db: Session = Depends(get_db)
) -> AssignmentPatchResponse:
    assignment = _get_active_assignment_or_404(db, assignment_id)

    update_data = payload.model_dump(exclude_unset=True)

    warning = None
    if "status" in update_data and update_data["status"] != assignment.status:
        warning = check_backward_transition(
            ASSIGNMENT_STATUS_GRAPH, assignment.status, update_data["status"]
        )

    for field, value in update_data.items():
        setattr(assignment, field, value)
    db.commit()
    db.refresh(assignment)

    return AssignmentPatchResponse(
        **AssignmentRead.model_validate(assignment).model_dump(), warning=warning
    )


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)) -> None:
    assignment = _get_active_assignment_or_404(db, assignment_id)
    assignment.is_deleted = True
    db.commit()
