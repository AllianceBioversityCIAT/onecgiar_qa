# Overview review with María Julia (2026-10-27)

Meeting "PRMS – QA Platform – Overview for the different roles", 27 Oct 2026, 57 min.
Present: María Julia Mariani (QA Admin), Ángel Jarrín, Juanpa, Juanda, Yeck.
Source: Teams transcript, shared by Juanpa on 2026-10-28. This note records what was said; nothing here is built yet.

## Overview (her screen, QA Admin)

| # | Feedback | Who | Status |
|---|---|---|---|
| O-1 | **Statuses inside steps.** Replace the Round 1 / Round 2 status cards with the steps, each showing its own statuses: | María Julia, Ángel | She wants the step and status names proposed to her (Teams or email) **before** we implement |
| | - **Step 1, assessors:** Pending · In review · Assessed by 1 assessor · Assessed by 2 assessors | | |
| | - **Step 2, submitters / science programs (new):** Pending reply · Comments replied | | |
| | - **Step 3, lead assessor:** Pending lead assessor review · Assessed by lead assessor | | |
| | - **Step 4, third party (new):** Pending third-party review · Assessed by third party | | |
| | - PPU "implemented or not" is optional ("not important") | | |
| O-2 | "In review" is of little interest (only the 1–10 results being assessed at that moment). It can be dropped and counted in Pending, or kept apart from "Pending = not touched" | María Julia | Our choice |
| O-3 | **Order of the page:** timelines (per-timeline steps) first, then the steps and statuses, then Assessment pace, Progress by result type, Assessor load | María Julia, Ángel | **Done 2026-10-28.** Assessment pace is now full width; in a wide card the summary sits left and the chart right |
| O-4 | **Global filters at the top** (timeline, which exists, plus science program and result type), changing every number on the page. Higher priority than notifications | Ángel, María Julia | Agreed |
| O-5 | **Remove the notifications block** ("Needs your attention") from the Overview | María Julia | **Done 2026-10-28.** `ov-attention.ts` deleted; its mock (`ATTENTION` in `overview.mock.ts`, a file shared with Yeck) is left in place |
| O-6 | **Assessment pace:** all results by default, filterable by result type ("indicator") and by assessor, to follow each assessor's daily work | María Julia | Agreed |
| O-7 | Assessor load is useful; pace per assessor is "another way to see the same data" | María Julia | Covered by O-6 |
| O-8 | **Names:** she suggested "Main batch" for the official timeline and "complementary batches" for sub-timelines. Ángel explained timeline names are typed by the admin, so they are customizable | María Julia, Ángel | Open: whether the type labels change too |
| O-9 | **Other roles** get a reduced subset of this Overview. To do after these revisions; she reviews it with the shared link and credentials | All | Later |

## Notifications
- Agreed by everyone: useful, but **low priority**; finish the QA core first. Keep it "a bit hidden".
- Events she would want:
  - All results of a batch reached the target status (assessed by 2, or by 1 for knowledge products and other outputs), so she can send them to the submitters.
  - The lead assessor finished a batch, so she can send it to the third party.
  - The third party finished a batch.
  - Science programs that have not started, or are going too slowly, in Round 1 step 2, after a couple of days.

## Other topics (for the team)
- **Cycle and loads:**
  - Step changes happen automatically by date.
  - The **hour** matters as much as the date. Times are in CET, her local time.
  - She needs a **manual "data transfer" button** to load results into a specific batch beyond what was planned; she says this happens a lot (Juanda: feasible).
- **Early start:** some results start on 25 Jan, before the official 1 Feb. Ideally they join the main batch when it starts, rather than staying a separate timeline.
- **Dates (María Julia):**
  - Official QA runs 1–21 Feb (3 weeks).
  - The realistic end is 30 Mar.
  - A test with assessors is planned for the 1st–2nd week of December, ideally finishing round 2 before Christmas.
- **Assessors** (Juanda's demo):
  - External users can be invited and receive a temporary-password email. That email still needs a better design and the platform URL.
  - CGIAR users who are not assessors enter as Guest, read-only.
  - A program can be blocked for an assessor (conflict of interest).
- **Fields:** the AI option should apply only to impact areas, not to every field.
- **AI integration:** reuse José's work. Preferred option (Juanda): QA calls his service and gets the AI scores back. A meeting with him is kept only if he joins.
- **Knowledge products** need only one round and may be submitted until round 1 ends. A KP "fast track" can be configured as a timeline with fewer steps.

## Tested (O-3, O-5)
- `eslint` on `overview/` exits 0.
- Full suite: 31 files, 260 tests passed. Two earlier runs lost one test file each to a Windows worker crash (exit 0xC0000409), on a different file each time; neither was an Overview file.
- Build exit 0.
- Browser, signed in with the design account:
  - Block order is timelines, then rounds, then Assessment pace, Progress by result type and Assessor load.
  - No horizontal scroll at 390, 768, 1024 and 1440 px.
  - The Assessment pace card is 484 px tall at 1440 px.
  - Light and dark modes both checked.

## Pending
- O-4 global filters, O-6 pace filters (mock data), O-1 steps with statuses (send names to María Julia first), O-8 names (Ángel).
