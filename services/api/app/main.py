import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from sqlalchemy import text

from app.api.auth_routes import router as auth_router
from app.api.documents import router as documents_router
from app.api.sessions import router as sessions_router
from app.config import settings
from app.database import engine
from app.logging_config import configure_logging, logger
from app.models import Base
from app.realtime.ws import router as ws_router

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.log_level)
    os.makedirs(settings.upload_dir, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("api_started", mock_ai=settings.use_mock_ai)
    yield
    await engine.dispose()


app = FastAPI(title="LockedIn Copilot API", version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(sessions_router, prefix="/api")
app.include_router(documents_router, prefix="/api")
app.include_router(ws_router)


@app.get("/health")
@limiter.limit("60/minute")
async def health(request: Request):
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "mockAi": settings.use_mock_ai,
        "llmProvider": settings.active_llm_provider,
        "llmModel": settings.gemini_model if settings.active_llm_provider == "gemini" else settings.openai_model,
        "database": db_ok,
    }


@app.exception_handler(Exception)
async def global_exception_handler(_request: Request, exc: Exception):
    logger.error("unhandled_exception", error=str(exc))
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})
