# QA context — the team's shared memory

> What holds now, not the history. Every fact with its source and date. Anything doubtful goes to *Open questions*.
> 🛑 No passwords, tokens, user names or personal data (rules in `CLAUDE.md` § 5).

## What it is
- A new **Quality Assurance (QA)** platform for the results reported in PRMS (Reporting Tool), built from scratch in Q4 2026. *(Yeck, 2026-10-05)*
- It replaces the current QA app (`qa.cgiar.org`), which PRMS today only shows inside an iframe, with no data exchange. *(Yeck, 2026-10-05)*
- Team: Yeck (front), Juanda (back), Juanpa (design), Santi (QA business). *(Yeck, 2026-10-06)*

## QA flow (per result)
1. **Assessor** reviews each field: approves it or comments what to change. They can withdraw a comment while the program has not answered it.
2. **Program member (SP)** accepts or rejects each comment; when accepting, corrects it in the Reporting Tool. The program answers inside the Reporting Tool embed: there is no program screen in the new QA.
3. **Lead assessor** does not close comments. They read the comments and the program's answers and, when something must be done, mark the field as *highlight* with an instruction for the TPB.
4. **Third-party broker (TPB)** decides each highlighted field: *Agreed with program* or *Required changes*.
5. **PPU** applies the required change in the Reporting Tool and marks it as done in QA (*Mark when done*).

*(Santi, 2026-09-30; steps 1–5 detailed by Santi via Yeck, 2026-11-11)*

## Knowledge Products (KPs)
When a load brings results into step 1, each KP falls into one of three groups (the 2025 rule):

| Group | Rule | In QA | In Reporting |
|---|---|---|---|
| Not in QA | Not MELIA and type ≠ Journal Article | Not assessed | Released as `qaed` right after the load |
| Auto-validated | Journal Article whose CGSpace and WoS data match (year, ISI, peer reviewed, accessibility) | "Auto-validated", not assessed | Released as `qaed` right after the load |
| Any other KP | — | "Pending", **assessed in step 1 like any other result** | Stays In QA until reviewed |

- KPs to review do **not** wait for step 3. Ticket P2-3905 AC13 and P2-3906 AC6 said the opposite; both were corrected by comment. *(Juanda, back lead, 2026-11-04; Angel to confirm on Jira)*
- Taking a result into QA ("intake") locks it In QA in Reporting: its program can no longer edit or unsubmit it until QA releases it. *(Reporting contract v1.29; step-1-loads spec, 2026-11-04)*

## Platform roles
- Six roles: **Admin** (QA coordination: opens and closes phases, builds batches, assigns assessors) · **Assessor** · **Lead assessor** · **Third-party broker (TPB)** · **PPU** · **Program**. There is no PCU and no Guest role. *(Santi via Yeck, 2026-11-11)*
- The server stores them as `ADMIN`, `ASSESSOR`, `LEAD_ASSESSOR`, `TPB`, `PPU`, `PROGRAM` (`client/src/app/core/auth/auth.models.ts`).

## Comments export (P2-3914)
- The server builds the .xlsx (one endpoint) and checks each role's scope; the front only has the drawer and the download. *(Juanda, 2026-11-11)*
- Filters: timeline, step, science programs, result types, QA stage, which fields, and "include withdrawn comments" (off by default). *(Juanda, 2026-11-11)*
- The three "Export comments" buttons (a result's menu in Results, a timeline's menu and a step's progress drawer in Cycle) open the same drawer with that scope set. *(Juanda, 2026-11-11)*
- One row per comment with the whole path: the result (code, title, program, type, timeline, assessed by), the comment (field, value when commented, author, date, status, withdrawn), then the program's answer, the lead's highlight and instruction, the TPB's decision and the PPU's "done". Only step 1 exists today; the later columns come out empty until those steps are built. *(Juanda, 2026-11-11)*
- Who downloads: the QA Admin, any timeline; lead assessors, TPB and assessors, only their scope. *(Juanda, 2026-11-11)*
- Not in the December batch. *(Juanda, 2026-11-11)*

## What coordination asks for
- Open and close phases without depending on the technical team.
- Batches and mini-batches with timelines; each program moves at its own pace.
- A reliable second round (round 2); automatic AI input; several processes in parallel.
*(Jira Discovery NOST-451, 2026-10-05)*
- Everything is configured from QA, on the **active phase**. There is no need to look at past years' phases from QA. *(Angel, 2026-10-21)*
- Each timeline (the official one and the sub-timelines) has its own steps; not all of them have the same ones. *(Juanpa, 2026-10-21)*

## Mockup screens
Overview · Results (+ per-field detail with "AI match") · Cycle (phases + batches) · Fields (configuration per result type) · Assessors. *(Juanpa's mockup, 2026-10-05)*

## Glossary
- **Result**: what a program reports in PRMS and goes through QA.
- **Batch / mini-batch**: a group of results that enters QA together.
- **Phase / cycle**: a QA period that coordination opens and closes.
- **Highlighted**: a field in disagreement that goes up to the broker.

## Open questions (do not assume an answer)
- Can Program and PPU download the comments export? Not in P2-3914; Juanda to confirm with Ángel (2026-11-11).
- Only the Reporting → QA sync is modeled; the way back (PPU corrects) is missing.
- Can a user have several roles? The mockup assumes one.
- A module inside the Reporting Tool, or a standalone platform?
- The mockup's "AI match" is not the same as the AI input that exists today.
- When moving to the next year (2027), is a new phase created, or is the active one reconfigured (name and dates of the official timeline)?
- What does the business call the cycle tied to a reporting year ("cycle", "phase", "Annual report 2026"), and who names it? Do "Official timeline" and "Sub-timelines" work? (Question for Angel, 2026-10-21.)
- Releasing "Not in QA" KPs as `qaed` makes Reporting show them as Quality Assessed although QA never looked at them. Is that the wanted meaning, or should they go as `not_qaed`? (For Angel, 2026-11-04.)
