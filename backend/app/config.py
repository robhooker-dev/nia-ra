"""
Configuration resolution: real environment > .env file > safe default.

Never let callers test raw strings for "is this feature on" -- expose a
`*_configured()` predicate instead, and keep every predicate here so the
health endpoint can report all of them in one place.
"""
import os
import shutil
from pathlib import Path

_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"
_dotenv_values: dict[str, str] = {}

if _ENV_FILE.exists():
    for line in _ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        _dotenv_values[key.strip()] = value.strip().strip('"').strip("'")


def get(name: str, default: str = "") -> str:
    """Real environment wins, then .env file, then the given default."""
    if name in os.environ and os.environ[name] != "":
        return os.environ[name]
    if name in _dotenv_values and _dotenv_values[name] != "":
        return _dotenv_values[name]
    return default


def get_bool(name: str, default: bool = False) -> bool:
    val = get(name, "")
    if val == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


# ---- App identity / environment ----
ENVIRONMENT = get("ENVIRONMENT", "development")
PORT = int(get("PORT", "8000"))

# ---- Anthropic (chat) ----
ANTHROPIC_API_KEY = get("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = get("ANTHROPIC_MODEL", "claude-sonnet-5")


def anthropic_configured() -> bool:
    return bool(ANTHROPIC_API_KEY)


# ---- OCR (optional, for scanned/image declarations) ----
# No cloud OCR resource is provisioned for this prototype. If pytesseract
# and a local Tesseract binary happen to be installed, OCR is used;
# otherwise scanned/image uploads are rejected with a clear message and the
# user pastes the text manually instead. Checked lazily (not at import
# time) so a missing optional dependency never breaks startup.
_ocr_checked = False
_ocr_available = False


def ocr_configured() -> bool:
    global _ocr_checked, _ocr_available
    if _ocr_checked:
        return _ocr_available
    _ocr_checked = True
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        _ocr_available = False
        return False
    _ocr_available = bool(shutil.which("tesseract"))
    return _ocr_available


# ---- Shared front-door gate (optional) ----
# A coarse HTTP Basic Auth challenge in front of the whole app -- there is
# no per-user auth in this prototype at all (see PRD Section 2), so on a
# public Render URL this is the only thing standing between a stray link
# and your AI usage/API key. Off by default (blank password).
SITE_USERNAME = get("SITE_USERNAME", "nia-ra")
SITE_PASSWORD = get("SITE_PASSWORD")


def site_gate_configured() -> bool:
    return bool(SITE_PASSWORD)


def all_modes() -> dict:
    """Everything /api/health reports. Add new predicates here, not ad hoc."""
    return {
        "environment": ENVIRONMENT,
        "llm": "live" if anthropic_configured() else "mock",
        "ocr": "on" if ocr_configured() else "off",
    }
