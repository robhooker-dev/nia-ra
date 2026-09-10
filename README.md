# NIA/BI Risk Assessment Generator (Prototype)

A single-user tool that takes an uploaded NIA (Notifiable Inappropriate
Association) or BI (Business Interest) declaration and drafts a graded risk
assessment for review, editing and export. Built from
[`nia-bi-risk-assessment-prd.md`](nia-bi-risk-assessment-prd.md).

**This is a working prototype, not a live operational system.** It is not
connected to force systems, stores nothing after export, and is not
authorised for use on real, current cases involving identifiable individuals
until independently reviewed for information security and data protection
compliance. The app displays this notice on every screen.

## What it does

Upload → Extract → Assess → Draft → Review/Edit → Export, in one browser
session, with nothing saved anywhere:

1. **Mode** -- pick NIA or Business Interest up front.
2. **Upload** -- a PDF, Word doc, plain text, or paste text directly. Facts
   relevant to the mode are extracted automatically (if an AI key is
   configured) and shown back to you, editable, before anything else runs.
3. **Confirm facts** -- every AI-extracted fact carries a verbatim quote and
   a page locator from the source document. A quote the app can't find
   verbatim in the text is discarded rather than kept -- that field is
   treated as not stated, not guessed at.
4. **Risk assessment** -- a deterministic check first decides whether there
   is enough information to grade at all (see `backend/rules/*.json`). If
   not, it tells you exactly what's missing and why, and lets you supply it
   or ask for a clearly-labelled provisional assessment anyway. If there is
   enough, the AI suggests a grade (Low/Medium/High), a rationale tied back
   to specific confirmed facts, suggested conditions and a review date --
   all of it a suggestion. **You always confirm or override the grade
   yourself** before it goes anywhere near the output document.
5. **Review & export** -- every section of the draft is editable. Export as
   Word (.docx) or PDF.

## Degrade-loud

With no AI key configured, the app still runs end to end: extraction shows
you the raw document text to read and fill in fields yourself, and grading
tells you plainly that no suggestion could be drafted rather than guessing.
The header badge always shows the true state (`AI drafting: live/mock` ·
`OCR: on/off`).

## The risk rules are yours to edit

The actual national counter-corruption grading criteria aren't public, so
the grading logic isn't hardcoded. `backend/rules/nia_rules.json` and
`backend/rules/bi_rules.json` hold everything the app grades against: which
fields matter, what "enough information" means, the grading factors and
their weights, the NIA escalation triggers, and the grade definitions. Ship
starter versions are placeholders built from public sources (Vetting APP,
Code of Ethics, Working Time Regulations 1998, and public IOPC reporting
themes) -- edit these two files directly with your own CCU-informed
criteria; no code changes needed, and changes take effect on the next
request with no restart.

## Running it

```bash
python -m venv .venv
.venv/Scripts/activate          # or: source .venv/bin/activate
pip install -r requirements.txt
cd backend
python run.py
```

Open http://localhost:8000 (or whatever `PORT` you set). Copy
`.env.example` to `.env` and set `ANTHROPIC_API_KEY` to enable AI-assisted
extraction and grading -- everything works without it, just in mock mode.

## Notes on OCR

There's no cloud OCR configured for this prototype. Scanned PDFs and image
uploads (`.png`/`.jpg`) will only work if you separately install
[Tesseract OCR](https://github.com/tesseract-ocr/tesseract) (and Poppler,
for scanned PDFs) on the machine running the backend, plus
`pip install pytesseract pillow pdf2image`. Without that, scanned/image
uploads are rejected with a clear message and you can paste the declaration
text in manually instead -- the workflow still runs end to end.

## Out of scope (by design, per the PRD)

No authentication, no database, no case history, no audit log, no
integration with any case management system. This is a stateless,
single-user drafting tool -- close the tab and the session is gone.
