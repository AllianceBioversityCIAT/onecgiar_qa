# QA context — the team's shared memory

> What holds now, not the history. Every fact with its source and date. Anything doubtful goes to *Open questions*.
> 🛑 No passwords, tokens, user names or personal data (rules in `CLAUDE.md` § 5).

## What it is
- A new **Quality Assurance (QA)** platform for the results reported in PRMS (Reporting Tool), built from scratch in Q4 2026. *(Yeck, 2026-10-05)*
- It replaces the current QA app (`qa.cgiar.org`), which PRMS today only shows inside an iframe, with no data exchange. *(Yeck, 2026-10-05)*
- Team: Yeck (front), Juanda (back), Juanpa (design), Santi (QA business). *(Yeck, 2026-10-06)*

## QA flow (per result)
1. **Assessor** reviews each field: approves it or comments what to change.
2. **Program member (SP)** accepts or rejects each comment; when accepting, corrects it in the Reporting Tool.
3. **Lead assessor** reviews the rejected comments and marks them *highlighted*.
4. **Third-party broker (TPB)** decides each highlighted field.
5. **PPU** applies the agreed correction in the Reporting Tool.

*(Santi, 2026-09-30)*

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
- **QA lead / coordination** — opens and closes phases, builds batches, assigns assessors.
- **Assessor** · **Lead assessor** · **Third-party broker** · **PPU** — see the flow above.
*(Juanpa's mockup, 2026-10-05)*

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
- There is no screen for the program member (SP) in the mockup.
- Only the Reporting → QA sync is modeled; the way back (PPU corrects) is missing.
- Can a user have several roles? The mockup assumes one.
- A module inside the Reporting Tool, or a standalone platform?
- The mockup's "AI match" is not the same as the AI input that exists today.
- When moving to the next year (2027), is a new phase created, or is the active one reconfigured (name and dates of the official timeline)?
- What does the business call the cycle tied to a reporting year ("cycle", "phase", "Annual report 2026"), and who names it? Do "Official timeline" and "Sub-timelines" work? (Question for Angel, 2026-10-21.)
- Releasing "Not in QA" KPs as `qaed` makes Reporting show them as Quality Assessed although QA never looked at them. Is that the wanted meaning, or should they go as `not_qaed`? (For Angel, 2026-11-04.)
