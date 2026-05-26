import re


def sanitize_stt_error(exc: Exception) -> str:
    message = str(exc).strip()
    if not message:
        return "Speech transcription failed. Try again after a short pause."
    message = re.sub(r"key=[A-Za-z0-9_\-]+", "key=***", message)
    message = re.sub(r"https?://[^\s]+", "[api]", message)
    lowered = message.lower()
    if "400" in lowered or "bad request" in lowered:
        return "Could not transcribe that phrase. Pause when the interviewer finishes, then try again."
    if "403" in lowered or "401" in lowered:
        return "Speech API authentication failed. Check GEMINI_API_KEY or DEEPGRAM_API_KEY in .env."
    if "429" in lowered:
        return "Speech API rate limit hit. Wait a moment and try again."
    if "gemini" in lowered or "deepgram" in lowered:
        return message.split(" from ")[0] if " from " in message else message
    return "Speech transcription failed. Try again after a short pause."
