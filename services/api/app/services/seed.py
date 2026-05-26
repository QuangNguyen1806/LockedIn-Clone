from sqlalchemy import func, select

from app.database import AsyncSessionLocal
from app.models import PracticeQuestion, SessionPreset, User

DEFAULT_PRESETS = [
    {
        "name": "FAANG Behavioral SWE",
        "mode": "behavioral",
        "tone": "star",
        "company": "Google",
        "role": "Software Engineer",
    },
    {
        "name": "Startup Founder Chat",
        "mode": "meeting",
        "tone": "conversational",
        "company": "Startup",
        "role": "Founder",
    },
    {
        "name": "System Design Interview",
        "mode": "technical",
        "tone": "concise",
        "company": "Meta",
        "role": "Senior Engineer",
    },
]

PRACTICE_QUESTIONS = [
    {
        "topic": "Conflict",
        "difficulty": "medium",
        "text": "Tell me about a time you had a conflict with a teammate and how you resolved it.",
    },
    {
        "topic": "Leadership",
        "difficulty": "hard",
        "text": "Describe a situation where you led a project without formal authority.",
    },
    {
        "topic": "Failure",
        "difficulty": "medium",
        "text": "Tell me about a time you failed and what you learned from it.",
    },
    {
        "topic": "Prioritization",
        "difficulty": "easy",
        "text": "How do you prioritize when everything is urgent?",
    },
    {
        "topic": "System Design",
        "difficulty": "hard",
        "text": "Design a URL shortener and explain your tradeoffs.",
    },
]


async def seed_practice_questions() -> None:
    async with AsyncSessionLocal() as db:
        count = await db.scalar(select(func.count()).select_from(PracticeQuestion))
        if count:
            return
        for item in PRACTICE_QUESTIONS:
            db.add(PracticeQuestion(**item))
        await db.commit()


async def seed_user_presets(user: User) -> None:
    async with AsyncSessionLocal() as db:
        count = await db.scalar(
            select(func.count()).select_from(SessionPreset).where(SessionPreset.user_id == user.id)
        )
        if count:
            return
        for preset in DEFAULT_PRESETS:
            db.add(SessionPreset(user_id=user.id, **preset))
        await db.commit()
