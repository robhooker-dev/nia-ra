# PRD: NIA/BI Risk Assessment Generator (Prototype)

## 1. Purpose

A single tool that takes an uploaded declaration document (a Notifiable Inappropriate Association or a Business Interest declaration) and produces a draft, graded risk assessment that the user can review, edit, and export — replacing manual drafting from scratch.

This is a **working prototype**, not a live operational system. It is not connected to force systems, does not store data persistently, and is not authorised for use on real, current cases involving identifiable individuals until independently reviewed for information security and data protection compliance.

## 2. Users

- Single user (the CCU practitioner) in the first instance.
- No authentication/roles required for the prototype — this is a personal working tool, not a multi-user deployment.

## 3. Core Concept

One app, two modes, selected up front:

- **Mode A: Notifiable Inappropriate Association (NIA)**
- **Mode B: Business Interest (BI)**

Each mode has its own input expectations, risk factors, and output template, but shares the same underlying workflow:

**Upload → Extract → Assess → Draft → Review/Edit → Export**

## 4. Workflow

### Step 1 — Mode selection
User picks NIA or BI before uploading.

### Step 2 — Document upload
User uploads a document (PDF, Word, or image of a scanned form). The app extracts text (OCR if needed for images/scans) and identifies the key declared facts relevant to that mode (see Section 5 for what "key facts" means per mode).

The extracted facts are shown back to the user in an editable summary panel **before** risk assessment runs, so incorrect extraction can be corrected first (extraction from a form is not always reliable, especially handwritten or scanned content).

### Step 3 — Risk assessment

**Core principle: the AI suggests, the human decides.** The risk grade that ends up on the final document is a value the user explicitly selects or confirms from a controlled vocabulary (Low/Medium/High) — it is never silently finalised by the model. The app's job is to produce a well-reasoned *suggestion* and show its working; the officer's selection is what gets echoed into the output as their own determination.

**Sufficiency check (runs first):** before attempting a grade, the app assesses whether the confirmed facts are sufficient to support a meaningful risk assessment for the selected mode (see Section 5 for the key facts expected per mode). If material information is missing:

- The app does **not** force a grade. It clearly states that there is insufficient information to assess risk.
- It lists, in plain language, what specific additional information is needed and why it matters (e.g. "Frequency of contact with the associate is not stated — this materially affects the risk rating and cannot be assumed"; "No indication of the declarant's role/access level — needed to judge what could be put at risk").
- The user can then either supply the missing information directly (free-text addition) or upload a supplementary document, and re-run the assessment.
- A partial/provisional assessment may still be offered where useful (e.g. "the information suggests at least Medium risk, but cannot rule out High without X"), clearly labelled as provisional.

**Where sufficient information exists**, the app applies a rules/reasoning engine (see Section 6) to produce:

- A **suggested** graded risk level: **Low / Medium / High**, presented as a proposal for the user to confirm or override
- A short rationale explaining which factors drove that suggestion, with each factual claim traceable back to a specific quote/location in the source document (see Section 6.3 — quote-then-locate)
- Suggested mitigations or conditions (e.g. review period, restrictions, monitoring requirement)
- A suggested next review date where applicable

### Step 4 — Draft generation
The app populates a structured RA document (see Section 7 for template) with the extracted facts, the grading, the rationale, and suggested conditions.

### Step 5 — Review and edit
The full draft is shown in an editable text/rich-text view. User can amend any section before export — the tool should never require an all-or-nothing accept.

### Step 6 — Export
User chooses PDF or Word (.docx) at export time. No case is saved after export — this is a stateless, one-off session tool (no database, no history log).

## 5. Key Facts to Extract Per Mode

### Mode A — Notifiable Inappropriate Association
- Declarant's name, role, and unit (or placeholder if anonymised for testing)
- Nature of the association (personal, family, prior professional, social, etc.)
- How the declarant knows the associate
- Frequency and duration of contact
- Category of concern the associate falls into, if any (e.g. subject of criminal proceedings, known criminal associations, extremist links, investigative/media/legal profession where conflict-relevant, commercial relationship with the force)
- Whether the association is ongoing or historic
- Declarant's role/access level (i.e. what information or operational access they hold that could be at risk)
- Any prior relevant intelligence already known about the associate (if included in the source document)
- Whether the declaration was proactive (self-reported) or came to light another way

### Mode B — Business Interest
- Declarant's name, role, and unit
- Nature of the business/activity
- Hours per week involved, and cumulative hours combined with police role (Working Time Regulations 1998 — 48-hour week relevance)
- Whether the business could conflict with policing duties, the Code of Ethics, or create a perception of conflict
- Whether the business could exploit the declarant's role, access, or force information
- Financial structure (sole trader, director, partner, employee of the business, silent investor, etc.)
- Any existing conditions or monitoring already in place (for a renewal/review case)
- Line manager comments, if included in the source document

## 6. Risk Assessment Logic

**Important design decision:** the detailed national counter-corruption grading criteria are not publicly available (only the Vetting APP and fragments of the Counter Corruption APP are public), so the actual scoring logic should **not be hardcoded as if it were the definitive national standard**. Instead:

- Build the risk engine as an **editable, external rules/config file** (e.g. a structured JSON or Markdown "risk criteria" document) that the app reads at runtime.
- Ship the prototype with a **starter rule set** built from what is publicly documented (see Section 6.1) as placeholder logic — clearly labelled in the app as a draft/starting point.
- Design the config so the user can later replace or extend it with their own CCU-informed grading criteria without touching the app's code — this is the part of the tool that should reflect the practitioner's own expertise, not scraped policy.

### 6.1 Starter rule set (from public sources, to be refined by the user)

**NIA grading should weigh:**
- Proximity of the associate to criminality, extremism, or active corruption risk (highest weight)
- Whether the association gives the associate potential access to sensitive information or leverage over the declarant
- Frequency/currency of contact (ongoing vs historic/distant)
- Declarant's role and access level (higher access = higher risk for the same association)
- Whether full and proactive disclosure was made (mitigating factor)
- Note: professions such as journalists or legal professionals should **not** be treated as inherently high-risk by category alone — risk should turn on whether the specific relationship creates an actual conflict with the declarant's duties, per national guidance.

**BI grading should weigh:**
- Degree of conflict (or perceived conflict) with policing duties or the Code of Ethics
- Potential for the business to exploit the declarant's role, information, or contacts
- Working Time Regulations compliance (hours combined with police role)
- Public confidence/reputational impact if the interest became publicly known
- Whether conditions from a prior approval are being adhered to (renewal cases) — IOPC reporting flags non-adherence to conditions on approved interests, and continuation of declined interests, as recurring corruption risk areas

### 6.2 Output grading

- **Low**: no material conflict identified; disclosure was proactive and complete; recommend approve, note for routine review.
- **Medium**: some conflict or risk factor present but manageable with conditions; recommend approve with conditions and a defined review date.
- **High**: significant conflict, proximity to criminality/corruption risk, or access/leverage concern; recommend escalation to a senior decision-maker or ADC-equivalent process rather than automatic approval.

### 6.2.1 Manageability indicator (NIA mode only)

A risk grade alone doesn't say whether the association can realistically continue under conditions, or whether it likely can't. For NIA mode, the app should output a second, separate indicator alongside the grade:

- **Manageable** — conditions/monitoring can reasonably mitigate the risk. Applies to Low and Medium, and to some High cases where a credible mitigation exists (e.g. contact is infrequent and can be further restricted, or the declarant's access can be adjusted).
- **Escalate for manageability review** — the grade is High and the fact pattern suggests conditions alone may not be sufficient. The app states this explicitly, and explains which facts drove it, but **does not recommend an outcome** (e.g. cease contact, redeployment, misconduct referral) — that decision sits with the officer/ADC-equivalent process, not the tool.

**Starter fact patterns that should trigger "Escalate for manageability review"** (again, editable in the same rules config as the rest of Section 6):

- Ongoing (not historic) contact with someone who is the subject of a current criminal investigation or prosecution
- Evidence or strong indication that the associate has, or could obtain, leverage over the declarant (e.g. financial entanglement, coercion, blackmail potential)
- The declarant holds high-sensitivity access (e.g. to live intelligence, informant handling, or covert operations) and the association is both current and undisclosed until now
- A pattern of repeated notifiable associations with the same category of concern, suggesting the current declaration isn't an isolated instance
- No credible mitigation is identifiable from the facts available (i.e. conditions/monitoring alone would not plausibly reduce the risk)

Where none of these patterns are present, a High grade defaults to "Manageable" with recommended conditions, per Section 6.2.

Note: these three levels are a **controlled vocabulary**, not free text — the user selects/confirms one of exactly these three values; the app never invents a fourth label.

### 6.3 Quote-then-locate extraction (anti-hallucination gate)

Every fact the app extracts from the uploaded document — and every factual claim used in the rationale — must carry:

- A **locator**: which document, and roughly where in it (page number if available)
- A **verbatim short quote** from the source text supporting that fact

**A claim whose quote cannot be found verbatim in the source text is discarded**, not guessed at or softened into the output. This means the rationale panel should let the user click through from a stated factor (e.g. "ongoing contact, approx. weekly") back to the exact source text it came from. If a fact needed for grading has no locatable quote, it is treated as missing information and feeds into the sufficiency check in Step 3, not silently assumed.

### 6.4 Sufficiency criteria (what "enough information" means)

At minimum, before a non-provisional grade is offered:

**NIA mode** needs: nature of the association, how the declarant knows the associate, current frequency/status (ongoing vs historic), and the declarant's role/access level. Missing any of these triggers the insufficient-information path.

**BI mode** needs: nature of the business, hours involved, and whether/how it relates to the declarant's policing duties or access. Missing any of these triggers the insufficient-information path.

These are starter thresholds — like the grading logic itself, they should live in the same editable rules/config file (Section 6) so the user can tighten or loosen what counts as "enough" as their own criteria mature.

## 7. Output Document Template

1. **Header**: Case reference (user-entered, optional), date, mode (NIA/BI), preparer
2. **Declared facts summary** (from Step 2, as confirmed/edited by user)
3. **Risk grading**: Low/Medium/High, prominently displayed. For NIA mode, the manageability indicator (Manageable / Escalate for manageability review — see Section 6.2.1) is shown immediately alongside the grade, not buried in the rationale.
4. **Rationale**: narrative explanation of the grading, referencing the specific factors that applied
5. **Recommended conditions/mitigations**
6. **Recommended review date** (if applicable)
7. **Policy basis footer**: generic reference to the national frameworks the assessment is informed by (Vetting APP, Code of Ethics, Counter Corruption APP) — no reference to any specific force's internal policy
8. **Sign-off block**: preparer name/date, reviewing officer name/date (blank fields for manual completion)

## 8. Technical Approach (suggested)

- Single-page web app (e.g. React + a lightweight backend, or a self-contained HTML/JS app) — no persistent database needed given Section 9.
- Document upload with text extraction: PDF text extraction, OCR fallback for images/scans, Word doc parsing.
- Cloud AI (Claude API) handles: fact extraction from the raw document, and applying the risk rules file to generate the grading and rationale narrative.
- Export: generate .docx (e.g. via a docx-generation library) and PDF from the same underlying draft content, selectable by the user at export time.
- Risk rules file stored as a separate, human-readable config (JSON or Markdown) bundled with the app, not embedded in application logic — this is the file the user will iterate on.
- **Degrade-loud**: if OCR fails, if the AI call fails, or if extraction can only partially read a document, the app says so visibly in the UI and in the output draft (e.g. a badged warning) rather than silently producing a thinner or lower-confidence result. Never let a degraded run look identical to a full one.
- **Data minimisation in prompts**: each AI call should only receive the fields it actually needs for that step (e.g. the grading call doesn't need the declarant's full name if it isn't needed for the reasoning) — don't rely on prompt instructions to tell the model to "ignore" sensitive fields; simply don't include them.

## 9. Data Handling (Prototype Scope)

- No persistent storage of uploaded documents or generated assessments — session-only.
- Cloud AI processing is acceptable **for prototype/test data only**. The app should display a persistent, visible notice that it is not cleared for use with real, current personal data until reviewed for information security and data protection compliance.
- No integration with force systems in this phase.
- **DPIA note**: counter-corruption processing of employee/personal data is inherently high-risk from a data protection standpoint. Even as a prototype, it's worth starting a lightweight data protection impact assessment alongside the build rather than after it, ahead of any move toward real case data.

## 10. Out of Scope (for this prototype)

- Multi-user access, authentication, or role-based permissions
- Case history, audit log, or reporting/dashboard views
- Integration with the CCU case management system ([[ccu-case-management-system]]) — a future integration point, not part of this build
- Automated decision-making — the tool drafts and grades, a human always signs off

## 11. Open Questions for Later Iteration

- Exact wording/structure of the user's own CCU risk criteria (to replace the starter rule set in Section 6.1)
- Whether this should eventually feed into or sit alongside the Master Subject Record concept in the CCU platform PRD
- Whether OCR accuracy on handwritten declaration forms is good enough in practice, or whether typed/digital declarations should be the primary supported input
