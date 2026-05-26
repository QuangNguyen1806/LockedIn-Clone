from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class SessionConfigSchema(BaseModel):
    mode: str = "behavioral"
    company: str | None = None
    role: str | None = None
    tone: str = "conversational"
    customInstructions: str | None = None
    resumeContext: str | None = None
    jobDescriptionContext: str | None = None


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    displayName: str = Field(min_length=1)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserProfileResponse(BaseModel):
    id: str
    email: str
    displayName: str
    headline: str | None = None
    skills: list[str] = []
    createdAt: datetime


class AuthResponse(BaseModel):
    accessToken: str
    tokenType: str = "bearer"
    user: UserProfileResponse


class UpdateProfileRequest(BaseModel):
    displayName: str | None = None
    headline: str | None = None
    skills: list[str] | None = None
    deleteDataOnSessionEnd: bool | None = None


class CreateSessionRequest(BaseModel):
    title: str
    config: SessionConfigSchema


class SessionResponse(BaseModel):
    id: str
    userId: str
    title: str
    status: str
    config: SessionConfigSchema
    startedAt: datetime | None = None
    endedAt: datetime | None = None
    createdAt: datetime
    updatedAt: datetime


class TranscriptSegmentResponse(BaseModel):
    id: str
    sessionId: str
    speaker: str
    text: str
    isFinal: bool
    timestampMs: int
    createdAt: datetime


class AiOutputResponse(BaseModel):
    id: str
    sessionId: str
    kind: str
    content: str
    promptVersion: str
    createdAt: datetime


class SessionSummaryResponse(BaseModel):
    id: str
    sessionId: str
    summary: str
    questions: list[str]
    feedbackBullets: list[str]
    promptVersion: str
    createdAt: datetime


class SessionDetailResponse(SessionResponse):
    transcript: list[TranscriptSegmentResponse] = []
    aiOutputs: list[AiOutputResponse] = []
    summary: SessionSummaryResponse | None = None


class DocumentResponse(BaseModel):
    id: str
    userId: str
    kind: str
    filename: str
    parseStatus: str
    parsedText: str | None = None
    createdAt: datetime


class MetricsResponse(BaseModel):
    totalSessions: int
    completedSessions: int
    totalDurationMinutes: int
