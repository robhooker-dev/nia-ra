"""
Step 3 -- risk assessment. Sufficiency is decided deterministically
(rules.sufficiency_check); grading itself is one LLM call per assessment,
grounded in the same editable rules file the user can rewrite (PRD Section
6: "should not be hardcoded as if it were the definitive national
standard").

Core principle enforced here: the AI drafts a *suggestion*; the grade
never reaches the output document on its own authority. main.py never
lets a suggested grade skip the officer's explicit confirm/override.

Data minimisation (PRD Section 8): the grading prompt only receives fields
each mode's rules file marks `used_in_grading` -- e.g. the declarant's name
is never sent, because the reasoning never needs it.

Traceability instead of re-quoting: rather than asking the model to
re-emit quotes (a second chance to hallucinate), the rationale references
the *fact keys* that drove it. Each fact already carries its own
extraction-time quote and locator (or is honestly marked as user-added
with no source quote) -- so the UI can trace a rationale point back to its
evidence without the model touching quotes again.
"""
import json

from . import llm

GRADES = ("Low", "Medium", "High")
MANAGEABILITY = ("Manageable", "Escalate for manageability review")


def _grading_facts(rules: dict, facts: dict) -> dict:
    keys = {f["key"] for f in rules["fields"] if f.get("used_in_grading")}
    return {k: v.get("value", "") for k, v in facts.items() if k in keys and v.get("value")}


def _build_prompt(mode: str, rules: dict, facts_for_grading: dict) -> str:
    factors = "\n".join(f"- {f['factor']} (weight: {f['weight']})" for f in rules["grading_factors"])
    notes = "\n".join(f"- {n}" for n in rules.get("grading_notes", []))
    defs = "\n".join(f"- {g}: {d}" for g, d in rules["grading_definitions"].items())
    facts_block = "\n".join(f"- {k}: {v}" for k, v in facts_for_grading.items())

    manageability_block = ""
    if mode == "NIA":
        triggers = "\n".join(f"- {t}" for t in rules["manageability"]["escalation_triggers"])
        manageability_block = f"""

If your suggested grade is "High", also decide a manageability indicator:
- "Manageable" if conditions/monitoring could plausibly control the risk.
- "Escalate for manageability review" if the fact pattern matches one or \
more of these starter triggers (only claim this if a specific fact given \
above actually supports it):
{triggers}
If your grade is "Low" or "Medium", manageability is always "Manageable".
Include "manageability" and "manageability_reasoning" keys in your response \
(both "" if grade is not High and you are leaving it to the default)."""

    return f"""You are drafting a SUGGESTED risk grading for a UK police Counter \
Corruption Unit {rules['label']} case. This is a suggestion only -- a human \
officer will confirm or override it. Ground every part of your reasoning \
strictly in the facts given below; do not introduce facts not listed.

GRADING FACTORS TO WEIGH:
{factors}

IMPORTANT NOTES:
{notes if notes else "(none)"}

GRADE DEFINITIONS:
{defs}

CONFIRMED FACTS FOR THIS CASE:
{facts_block}
{manageability_block}

Respond with ONLY a single JSON object, no other text, no markdown fences:
{{
  "grade": one of "Low", "Medium", "High",
  "rationale": [ {{"text": "...", "supporting_fact_keys": ["..."]}}, ... ] -- \
2-5 bullet points, each citing which of the confirmed fact keys above \
supports it (use the exact key names, e.g. "nature_of_association"),
  "mitigations": ["...", "..."] -- suggested conditions/monitoring, empty list if grade is Low with no conditions needed,
  "review_date_suggestion": "..." -- a plain-language suggested review point (e.g. "6 months from approval"), or "" if not applicable,
  "manageability": "Manageable" | "Escalate for manageability review" | "",
  "manageability_reasoning": "..." or ""
}}"""


def _mock_response() -> dict:
    return {
        "mode_used": "mock",
        "grade": None,
        "rationale": [],
        "mitigations": [],
        "review_date_suggestion": "",
        "manageability": None,
        "manageability_reasoning": "",
        "warning": "No AI provider is configured, so no grading suggestion could be drafted. Assess the confirmed facts manually and select a grade below.",
    }


async def suggest_grade(mode: str, rules: dict, facts: dict) -> dict:
    facts_for_grading = _grading_facts(rules, facts)

    if llm.mode() != "live":
        return _mock_response()

    result = await llm.chat(_build_prompt(mode, rules, facts_for_grading), max_output_tokens=2000)
    raw = result.text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {
            "mode_used": "live",
            "grade": None,
            "rationale": [],
            "mitigations": [],
            "review_date_suggestion": "",
            "manageability": None,
            "manageability_reasoning": "",
            "warning": "The AI's response could not be read as a structured grading. Assess the confirmed facts manually and select a grade below.",
        }

    grade = data.get("grade")
    if grade not in GRADES:
        return {
            "mode_used": "live",
            "grade": None,
            "rationale": [],
            "mitigations": [],
            "review_date_suggestion": "",
            "manageability": None,
            "manageability_reasoning": "",
            "warning": f"The AI returned an invalid grade ('{grade}'). Assess the confirmed facts manually and select a grade below.",
        }

    known_keys = set(facts.keys())
    rationale = []
    for item in (data.get("rationale") or []):
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        keys = [k for k in (item.get("supporting_fact_keys") or []) if k in known_keys]
        rationale.append({"text": text, "supporting_fact_keys": keys})

    # Manageability is deterministic below High -- the rules file only lets
    # the model choose "Escalate" when the grade actually is High.
    manageability = None
    manageability_reasoning = ""
    if mode == "NIA":
        if grade == "High":
            m = data.get("manageability")
            manageability = m if m in MANAGEABILITY else "Manageable"
            manageability_reasoning = str(data.get("manageability_reasoning") or "")
        else:
            manageability = "Manageable"

    return {
        "mode_used": "live",
        "grade": grade,
        "rationale": rationale,
        "mitigations": [str(m) for m in (data.get("mitigations") or []) if str(m).strip()],
        "review_date_suggestion": str(data.get("review_date_suggestion") or ""),
        "manageability": manageability,
        "manageability_reasoning": manageability_reasoning,
        "warning": None,
    }
