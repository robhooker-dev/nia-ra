"""
Routes only -- no business logic lives here. Each handler validates,
calls a module, returns. There is no database and nothing is persisted
between requests: every endpoint is stateless by design (PRD Section 9),
so the frontend is the only thing holding a session's state, for exactly
as long as the browser tab is open.
"""
import base64
import secrets
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import assess, config, extract, facts as facts_module, llm, report, rules

app = FastAPI(title="NIA/BI Risk Assessment Generator (Prototype)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_site_password(request: Request, call_next):
    """Optional shared front-door gate for a semi-public deployment (a
    Render URL with no link-sharing control). This prototype has no
    per-user auth at all, so with no gate configured a stray link would
    let anyone burn the configured AI key. Off by default (blank
    SITE_PASSWORD). /api/health stays open so the hosting platform's own
    health check (which sends no credentials) still passes."""
    if not config.site_gate_configured() or request.url.path == "/api/health":
        return await call_next(request)

    auth = request.headers.get("Authorization", "")
    if auth.startswith("Basic "):
        try:
            username, _, password = base64.b64decode(auth[6:]).decode("utf-8").partition(":")
        except Exception:
            username, password = "", ""
        if secrets.compare_digest(username, config.SITE_USERNAME) and secrets.compare_digest(password, config.SITE_PASSWORD):
            return await call_next(request)

    return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="NIA-RA"'})


@app.get("/api/health")
def health():
    return {"ok": True, "modes": config.all_modes()}


@app.get("/api/rules/{mode}")
def get_rules(mode: str):
    try:
        return rules.load_rules(mode.upper())
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/extract")
async def extract_endpoint(mode: str = Form(...), file: UploadFile = File(...)):
    mode = mode.upper()
    if mode not in ("NIA", "BI"):
        raise HTTPException(400, "mode must be 'NIA' or 'BI'.")

    content = await file.read()
    try:
        source_text, extract_warning = extract.extract_text(file.filename, content)
    except ValueError as e:
        raise HTTPException(422, str(e))

    rules_doc = rules.load_rules(mode)
    extracted = await facts_module.extract_facts(mode, rules_doc, source_text)

    mock_preview = extracted.pop("_mock_preview", None)
    ai_warning = extracted.pop("_warning", None)

    return {
        "source_text": source_text,
        "facts": extracted,
        "llm_mode": llm.mode(),
        "extract_warning": extract_warning,
        "ai_warning": ai_warning,
        "mock_preview": mock_preview,
    }


class FactEntry(BaseModel):
    value: str = ""
    quote: Optional[str] = None
    locator: Optional[str] = None
    source: str = "user"


class AssessBody(BaseModel):
    mode: str
    facts: dict[str, FactEntry]
    allow_provisional: bool = False


@app.post("/api/assess")
async def assess_endpoint(body: AssessBody):
    mode = body.mode.upper()
    if mode not in ("NIA", "BI"):
        raise HTTPException(400, "mode must be 'NIA' or 'BI'.")

    facts_dict = {k: v.model_dump() for k, v in body.facts.items()}
    check = rules.sufficiency_check(mode, facts_dict)

    if not check["sufficient"] and not body.allow_provisional:
        return {"sufficient": False, "provisional": False, "missing": check["missing"]}

    rules_doc = rules.load_rules(mode)
    result = await assess.suggest_grade(mode, rules_doc, facts_dict)
    result["sufficient"] = check["sufficient"]
    result["provisional"] = not check["sufficient"]
    result["missing"] = check["missing"]
    return result


class Draft(BaseModel):
    mode: str
    case_reference: str = ""
    date: str = ""
    preparer: str = ""
    facts_summary: list[dict] = []
    grade: Optional[str] = None
    manageability: Optional[str] = None
    rationale_text: str = ""
    conditions_text: str = ""
    review_date: str = ""
    policy_basis: list[str] = []
    preparer_name: str = ""
    preparer_date: str = ""


class ExportBody(BaseModel):
    draft: Draft
    format: str  # "docx" | "pdf"


@app.post("/api/export")
def export_endpoint(body: ExportBody):
    draft = body.draft.model_dump()
    if body.format == "docx":
        data = report.build_docx(draft)
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        filename = "risk-assessment.docx"
    elif body.format == "pdf":
        data = report.build_pdf(draft)
        media_type = "application/pdf"
        filename = "risk-assessment.pdf"
    else:
        raise HTTPException(400, "format must be 'docx' or 'pdf'.")

    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


_FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
