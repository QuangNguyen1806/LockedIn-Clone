from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user
from app.models import PracticeQuestion, User
from app.schemas import PracticeQuestionResponse

router = APIRouter(prefix="/practice", tags=["practice"])


@router.get("/questions", response_model=list[PracticeQuestionResponse])
async def list_practice_questions(
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PracticeQuestion).order_by(PracticeQuestion.topic.asc()))
    return [
        PracticeQuestionResponse(
            id=q.id,
            topic=q.topic,
            difficulty=q.difficulty,
            text=q.text,
            createdAt=q.created_at,
        )
        for q in result.scalars().all()
    ]
