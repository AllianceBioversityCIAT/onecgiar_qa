# QA context — the team's shared memory

> What holds now, not the history. Every fact with its source and date. Anything doubtful goes to *Open questions*.
> 🛑 No passwords, tokens, user names or personal data (rules in `CLAUDE.md` § 5).

## What it is
- A new **Quality Assurance (QA)** platform for the results reported in PRMS (Reporting Tool), built from scratch in Q4 2026. *(Yeck, 2026-10-05)*
- It replaces the current QA app (`qa.cgiar.org`), which PRMS today only shows inside an iframe, with no data exchange. *(Yeck, 2026-10-05)*
- Team: Yeck (front), Juanda (back), Juanpa (design), Santi (QA business). *(Yeck, 2026-10-06)*

## QA flow (per result)
1. **Assessor** reviews each field: approves it or comments what to change. They can withdraw a comment while the program has not answered it. Any answer from the program, a rejection included, opens the field again for the assessor. *(Santi via Yeck, 2026-11-12)*
2. **Program member (SP)** accepts or rejects each comment; when accepting, corrects it in the Reporting Tool. The program answers inside the Reporting Tool embed: there is no program screen in the new QA.
3. **Lead assessor** (step 3, round 2) works on core fields only. They validate what the program corrected, and on each core comment the program disagreed with they choose *Agree with the program* (the field turns green; the comment closes when the review ends) or *Escalate to TPB*, with a comment. When every core field is green the result becomes Quality Assessed by itself; otherwise the Lead finishes the review explicitly and the result is Pending for TPB review. *(P2-3912; back lead, 2026-11-19, spec `escalation/round-2`; replaces the earlier "highlight, no final step" reading of 2026-11-12)*
4. **Third-party broker (TPB)** decides each escalated core comment: *Agreed with program* or *Required changes*. With *Required changes* they leave a note for the PPU. (P2-3916 names the two choices *Agree with the program* and *Agree with the assessor*; designed in spec `escalation/round-2`, not built yet.)
5. **PPU** applies the required change in the Reporting Tool and marks it as done in QA (*Mark when done*). The program corrects the data in the Reporting Tool; QA shows whether the field was already changed there, but only the PPU closes the case. The PPU does not see AI suggestions. *(Ángel, meeting with Juanpa, 2026-11-17)*

*(Santi, 2026-09-30; steps 1, 2, 4 and 5 detailed by Santi via Yeck, 2026-11-11 and 2026-11-12; step 3 sourced inline)*

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

## Fields and comments export (P2-3914)
- Purpose: the QA coordinator downloads the fields and comments per step and per science program to analyse the process and keep a record. Works like the Excel export of the Reporting Tool's Result Center: the user picks the fields. *(Jira P2-3914, 2026-11-23)*
- The server builds the .xlsx (one endpoint) and checks each role's scope; the front only has the drawer and the download. *(Juanda, 2026-11-11)*
- Filters: timeline, step, science programs, result types, QA status, which fields (a checklist by review section, all checked at first), and "include deleted comments" (off by default). *(Juanda, 2026-11-11; Jira P2-3914 and Juanpa, 2026-11-23)*
- For each result and field the file has: the field value, every comment on it with the reviewer's nickname, date and time and the step it was made in, the program's response (Accept, Accept with comment, Disagree or Request clarification) and its text, the field's validation status (green or grey) and the result's current QA status. Per result: code, title, science program, result type, timeline, "Assessed by". *(Jira P2-3914, 2026-11-23)*
- Results in Editing are never exported; no scheduled or automatic exports. *(Jira P2-3914, 2026-11-23)*
- The three "Export comments" buttons (a result's menu in Results, a timeline's menu and a step's progress drawer in Cycle) open the same drawer with that scope set. *(Juanda, 2026-11-11)*
- One row per comment with the whole path, then the lead's decision and comment, the TPB's decision and the PPU's "done". Only step 1 exists today; the later columns come out empty until those steps are built. *(Juanda, 2026-11-11)*
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
- **Escalated**: a core-field comment the program disagreed with, which the Lead Assessor sends to the TPB ("Escalate to TPB"). Replaces the earlier term "Highlighted". *(P2-3912; back lead, 2026-11-19)*

## Open questions (do not assume an answer)
- Can Program and PPU download the comments export? Not in P2-3914; Juanda to confirm with Ángel (2026-11-11).
- Export: does a field with no comments still get its own row (value and validation status)? The drawer says so (P2-3914 asks for the value and status of each field); Juanda to confirm the file's shape (2026-11-23).
- Only the Reporting → QA sync is modeled; the way back (PPU corrects) is missing.
- Can a user have several roles? The mockup assumes one. Ángel (2026-11-17): a person can be lead assessor in one result type and assessor in another, never both in the same type. To confirm with Santi.
- **Lead assessor, two versions.** Santi via Yeck (2026-11-12): looks at every commented field, marks *highlight* with an instruction, closes nothing. Ángel (2026-11-17): reviews only the **core fields**; closes the comment when they agree with the program, or escalates it as *Pending for TPB review* when they agree with the assessor; the result becomes Quality assessed by itself once all its core fields are validated; can edit or delete other assessors' comments. Which one holds? (For Yeck and Santi, 2026-11-17.)
- **KPs to review:** step 1 (Juanda, 2026-11-04) or straight into round 2 for the lead assessor (Ángel, 2026-11-17)?
- A module inside the Reporting Tool, or a standalone platform?
- The mockup's "AI match" is not the same as the AI input that exists today.
- When moving to the next year (2027), is a new phase created, or is the active one reconfigured (name and dates of the official timeline)?
- What does the business call the cycle tied to a reporting year ("cycle", "phase", "Annual report 2026"), and who names it? Do "Official timeline" and "Sub-timelines" work? (Question for Angel, 2026-10-21.)
- Releasing "Not in QA" KPs as `qaed` makes Reporting show them as Quality Assessed although QA never looked at them. Is that the wanted meaning, or should they go as `not_qaed`? (For Angel, 2026-11-04.)
