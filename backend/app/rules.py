"""
Loads the editable risk-criteria config (backend/rules/*.json) at request
time -- never cached at import, so a user editing the file by hand sees the
effect on the next call with no restart. This is the file the practitioner
is meant to replace with their own CCU-informed grading criteria; nothing
in Section 6's logic is hardcoded in application code.

Also owns the one deterministic step in the whole assessment: the
sufficiency check (PRD Section 6.4). Whether "enough information" exists is
read straight off each field's `required_for_sufficiency` flag in the rules
file, never left to the model to decide -- the model may draft a grade, but
it never gets to decide whether it's allowed to.
"""
import json
from pathlib import Path

_RULES_DIR = Path(__file__).resolve().parent.parent / "rules"

_FILES = {"NIA": "nia_rules.json", "BI": "bi_rules.json"}


def load_rules(mode: str) -> dict:
    filename = _FILES.get(mode)
    if not filename:
        raise ValueError(f"Unknown mode '{mode}'.")
    path = _RULES_DIR / filename
    return json.loads(path.read_text(encoding="utf-8"))


def sufficiency_check(mode: str, facts: dict) -> dict:
    """facts: {field_key: {"value": str, "quote": str|None, "locator": str|None, "source": str}}.
    Returns {"sufficient": bool, "missing": [{"key","label","why_it_matters"}]}."""
    rules = load_rules(mode)
    missing = []
    for field in rules["fields"]:
        if not field.get("required_for_sufficiency"):
            continue
        entry = facts.get(field["key"]) or {}
        value = (entry.get("value") or "").strip()
        if not value:
            missing.append({
                "key": field["key"],
                "label": field["label"],
                "why_it_matters": field.get("why_it_matters", ""),
            })
    return {"sufficient": len(missing) == 0, "missing": missing}
