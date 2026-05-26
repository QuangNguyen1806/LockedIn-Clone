import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.deps import get_current_user
from app.database import get_db
from app.models import AiOutput, JobQueue, Session, SessionStatus, SessionSummary, TranscriptSegment, User
from app.schemas import (
    AiOutputResponse,
    CreateSessionRequest,
    MetricsResponse,
    SessionConfigSchema,
    SessionDetailResponse,
    SessionResponse,
    SessionSummaryResponse,
    TranscriptSegmentResponse,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


def session_config(session: Session) -> SessionConfigSchema:
    return SessionConfigSchema(
        mode=session.mode,
        company=session.company,
        role=session.role,
        tone=session.tone,
        customInstructions=session.custom_instructions,
        resumeContext=session.resume_context,
        jobDescriptionContext=session.job_description_context,
    )


def session_to_response(session: Session) -> SessionResponse:
    return SessionResponse(
        id=session.id,
        userId=session.user_id,
        title=session.title,
        status=session.status,
        config=session_config(session),
        startedAt=session.started_at,
        endedAt=session.ended_at,
        createdAt=session.created_at,
        updatedAt=session.updated_at,
    )


@router.get("", response_model=list[SessionResponse])
async def list_sessions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Session).where(Session.user_id == user.id).order_by(Session.created_at.desc())
    )
    return [session_to_response(s) for s in result.scalars().all()]


@router.post("", response_model=SessionResponse)
async def create_session(
    body: CreateSessionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = Session(
        user_id=user.id,
        title=body.title,
        status=SessionStatus.draft.value,
        mode=body.config.mode,
        company=body.config.company,
        role=body.config.role,
        tone=body.config.tone,
        custom_instructions=body.config.customInstructions,
        resume_context=body.config.resumeContext,
        job_description_context=body.config.jobDescriptionContext,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session_to_response(session)


@router.get("/metrics", response_model=MetricsResponse)
async def session_metrics(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    total = await db.scalar(select(func.count()).select_from(Session).where(Session.user_id == user.id))
    completed = await db.scalar(
        select(func.count())
        .select_from(Session)
        .where(Session.user_id == user.id, Session.status == SessionStatus.completed.value)
    )
    sessions = (
        await db.execute(
            select(Session).where(
                Session.user_id == user.id,
                Session.started_at.isnot(None),
                Session.ended_at.isnot(None),
            )
        )
    ).scalars().all()
    duration_minutes = 0
    for s in sessions:
        if s.started_at and s.ended_at:
            duration_minutes += int((s.ended_at - s.started_at).total_seconds() // 60)
    return MetricsResponse(
        totalSessions=total or 0,
        completedSessions=completed or 0,
        totalDurationMinutes=duration_minutes,
    )


@router.get("/{session_id}", response_model=SessionDetailResponse)
async def get_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session)
        .options(
            selectinload(Session.transcript_segments),
            selectinload(Session.ai_outputs),
            selectinload(Session.summary),
        )
        .where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    summary = None
    if session.summary:
        summary = SessionSummaryResponse(
            id=session.summary.id,
            sessionId=session.summary.session_id,
            summary=session.summary.summary,
            questions=json.loads(session.summary.questions_json),
            feedbackBullets=json.loads(session.summary.feedback_json),
            promptVersion=session.summary.prompt_version,
            createdAt=session.summary.created_at,
        )

    return SessionDetailResponse(
        **session_to_response(session).model_dump(),
        transcript=[
            TranscriptSegmentResponse(
                id=t.id,
                sessionId=t.session_id,
                speaker=t.speaker,
                text=t.text,
                isFinal=t.is_final,
                timestampMs=t.timestamp_ms,
                createdAt=t.created_at,
            )
            for t in session.transcript_segments
        ],
        aiOutputs=[
            AiOutputResponse(
                id=o.id,
                sessionId=o.session_id,
                kind=o.kind,
                content=o.content,
                promptVersion=o.prompt_version,
                createdAt=o.created_at,
            )
            for o in session.ai_outputs
        ],
        summary=summary,
    )


@router.post("/{session_id}/start", response_model=SessionResponse)
async def start_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.status = SessionStatus.active.value
    session.started_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(session)
    return session_to_response(session)


@router.post("/{session_id}/end", response_model=SessionResponse)
async def end_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.status = SessionStatus.completed.value
    session.ended_at = datetime.now(timezone.utc)
    job = JobQueue(
        job_type="summarize_session",
        payload_json=json.dumps({"session_id": session.id}),
        status="pending",
    )
    db.add(job)
    await db.commit()
    await db.refresh(session)
    return session_to_response(session)


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)
    await db.commit()
    return {"ok": True}
