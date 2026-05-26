import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import create_access_token, get_user_by_email, hash_password, verify_password
from app.deps import get_current_user
from app.database import get_db
from app.models import AiOutput, Session, SessionSummary, TranscriptSegment, User
from app.schemas import (
    AuthResponse,
    LoginRequest,
    MetricsResponse,
    RegisterRequest,
    SessionConfigSchema,
    SessionDetailResponse,
    SessionResponse,
    TranscriptSegmentResponse,
    AiOutputResponse,
    SessionSummaryResponse,
    UpdateProfileRequest,
    UserProfileResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def user_to_response(user: User) -> UserProfileResponse:
    skills = json.loads(user.skills) if user.skills else []
    return UserProfileResponse(
        id=user.id,
        email=user.email,
        displayName=user.display_name,
        headline=user.headline,
        skills=skills,
        createdAt=user.created_at,
    )


@router.post("/register", response_model=AuthResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await get_user_by_email(db, body.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        display_name=body.displayName,
        skills="[]",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token(user.id)
    return AuthResponse(accessToken=token, user=user_to_response(user))


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_email(db, body.email)
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(user.id)
    return AuthResponse(accessToken=token, user=user_to_response(user))


@router.get("/me", response_model=UserProfileResponse)
async def me(user: User = Depends(get_current_user)):
    return user_to_response(user)


@router.patch("/me", response_model=UserProfileResponse)
async def update_me(
    body: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.displayName is not None:
        user.display_name = body.displayName
    if body.headline is not None:
        user.headline = body.headline
    if body.skills is not None:
        user.skills = json.dumps(body.skills)
    if body.deleteDataOnSessionEnd is not None:
        user.delete_data_on_session_end = body.deleteDataOnSessionEnd
    await db.commit()
    await db.refresh(user)
    return user_to_response(user)
