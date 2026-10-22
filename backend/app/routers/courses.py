"""授業（Course）の作成・参照・更新・削除エンドポイント。"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import CourseCreate, CourseRead, CourseUpdate

router = APIRouter(prefix="/courses", tags=["courses"])


def _get_active_course_or_404(db: Session, course_id: int) -> models.Course:
    course = (
        db.query(models.Course)
        .filter(models.Course.id == course_id, models.Course.is_deleted.is_(False))
        .first()
    )
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


@router.post("", response_model=CourseRead, status_code=status.HTTP_201_CREATED)
def create_course(payload: CourseCreate, db: Session = Depends(get_db)) -> models.Course:
    course = models.Course(**payload.model_dump())
    db.add(course)
    db.commit()
    return course


@router.get("", response_model=list[CourseRead])
def list_courses(db: Session = Depends(get_db)) -> list[models.Course]:
    return db.query(models.Course).filter(models.Course.is_deleted.is_(False)).all()


@router.get("/{course_id}", response_model=CourseRead)
def get_course(course_id: int, db: Session = Depends(get_db)) -> models.Course:
    return _get_active_course_or_404(db, course_id)


@router.patch("/{course_id}", response_model=CourseRead)
def update_course(
    course_id: int, payload: CourseUpdate, db: Session = Depends(get_db)
) -> models.Course:
    course = _get_active_course_or_404(db, course_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    return course


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: int, db: Session = Depends(get_db)) -> None:
    course = _get_active_course_or_404(db, course_id)
    course.is_deleted = True
    db.commit()
