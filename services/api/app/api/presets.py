from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.database import get_db
from app.models import SessionPreset, User
from app.schemas import CreatePresetRequest, PresetResponse, UpdatePresetRequest
from app.services.seed import seed_user_presets

router = APIRouter(prefix="/presets", tags=["presets"])


def preset_to_response(preset: SessionPreset) -> PresetResponse:
    return PresetResponse(
        id=preset.id,
        userId=preset.user_id,
        name=preset.name,
        isFavorite=preset.is_favorite,
        mode=preset.mode,
        tone=preset.tone,
        company=preset.company,
        role=preset.role,
        customInstructions=preset.custom_instructions,
        createdAt=preset.created_at,
        updatedAt=preset.updated_at,
    )


@router.get("", response_model=list[PresetResponse])
async def list_presets(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SessionPreset)
        .where(SessionPreset.user_id == user.id)
        .order_by(SessionPreset.is_favorite.desc(), SessionPreset.name.asc())
    )
    presets = result.scalars().all()
    if not presets:
        await seed_user_presets(user)
        result = await db.execute(
            select(SessionPreset)
            .where(SessionPreset.user_id == user.id)
            .order_by(SessionPreset.is_favorite.desc(), SessionPreset.name.asc())
        )
        presets = result.scalars().all()
    return [preset_to_response(p) for p in presets]


@router.post("", response_model=PresetResponse)
async def create_preset(
    body: CreatePresetRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    preset = SessionPreset(
        user_id=user.id,
        name=body.name,
        is_favorite=body.isFavorite,
        mode=body.mode,
        tone=body.tone,
        company=body.company,
        role=body.role,
        custom_instructions=body.customInstructions,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    return preset_to_response(preset)


@router.patch("/{preset_id}", response_model=PresetResponse)
async def update_preset(
    preset_id: str,
    body: UpdatePresetRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SessionPreset).where(SessionPreset.id == preset_id, SessionPreset.user_id == user.id)
    )
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    if body.name is not None:
        preset.name = body.name
    if body.isFavorite is not None:
        preset.is_favorite = body.isFavorite
    if body.mode is not None:
        preset.mode = body.mode
    if body.tone is not None:
        preset.tone = body.tone
    if body.company is not None:
        preset.company = body.company
    if body.role is not None:
        preset.role = body.role
    if body.customInstructions is not None:
        preset.custom_instructions = body.customInstructions
    await db.commit()
    await db.refresh(preset)
    return preset_to_response(preset)


@router.delete("/{preset_id}")
async def delete_preset(
    preset_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SessionPreset).where(SessionPreset.id == preset_id, SessionPreset.user_id == user.id)
    )
    preset = result.scalar_one_or_none()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    await db.delete(preset)
    await db.commit()
    return {"ok": True}
