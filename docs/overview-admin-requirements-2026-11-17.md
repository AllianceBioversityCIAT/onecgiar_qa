# Overview for the QA admin: detailed requirement

> Written for Ángel on 2026-11-17, so he can update the Jira user stories with it.
> Source: the Overview built in the design branch `jp-design/mockup-completo` (mock data). Its order and content were agreed with María Julia and Ángel (2026-10-16, 2026-10-27) and polished by Juanpa (up to 2026-11-11).
> Scope: only the **QA admin** view (María Julia). The views for the assessor, lead assessor, TPB and PPU are a separate requirement.

## 1. Purpose

The QA admin opens the Overview to answer, in one page and without asking the technical team:

1. Where is each timeline, and when does its current step close?
2. How is the whole cycle going, in Round 1 and in Round 2?
3. Will the open step close on time?
4. Which result types are behind?
5. Is the assessors' work balanced, and is anyone stuck?

Every number on the page is a way into the work: clicking it opens **Results** with the same filters already applied.

## 2. Who sees it

- Users with the **Admin** role (`ADMIN`).
- The other roles (assessor, lead assessor, TPB, PPU) get their own Overview ("Your work"), not this one.
- The sidebar's **Administration** group (Cycle, Fields, Assessors) and the "Open Cycle" / "Open Assessors" links are for admins only.

## 3. Page layout (top to bottom)

| # | Block | Question it answers |
|---|---|---|
| 0 | Header | Who am I and where am I |
| 1 | Filter bar | What part of the cycle am I looking at |
| 2 | Progress by timeline | Where is each timeline, and when does its step close |
| 3 | Round 1 and Round 2 (with "Quality assessed") | How is the whole cycle going |
| 4 | Assessment pace | Will the open step close on time |
| 5 | Progress by result type | Which result types are behind |
| 6 | Assessor load | Is the assessors' work balanced |

On wide screens, blocks 5 and 6 share a row. On phones every block stacks in this same order.

## 4. User stories and acceptance criteria

### US-1. Header
As the QA admin, I want a short greeting, so that I know the page is mine and current.

- Title: "Welcome back, {first name}" ("Welcome back" when the profile has no first name).
- Subtitle: "Here's how QA is going today."
- No status line in the header. Each timeline's status lives in Progress by timeline and in the sidebar's cycle card.
- The design shows a "Viewing as" menu to preview each role's Overview. In the product, the view comes from the signed-in user's role. The menu stays only for people who hold several roles.

### US-2. Filter bar for the whole page
As the QA admin, I want to narrow the whole page to one timeline, some science programs or some result types, so that every block answers for the same slice of the cycle.

- **Viewing {timeline} ⌄**, a context line with a searchable list:
  - Options: "All timelines" (default) plus each **live** timeline of the active cycle, each with its number of results.
  - The list groups them as "Main batch" (the official timeline) and "Complementary batches" (sub-timelines).
- **Science program** (multi-select) and **Result type** (multi-select), under the context line.
- The chosen filters show as chips ("Science program: SP02, SP05") with an × each and **Clear all**.
- **Every block** below counts only what the filters keep, so all the numbers on the page add up.
- Same pattern and look as the Results filter bar. It is not sticky; it scrolls with the page.
- Only one place picks the timeline. No block has a second timeline picker.

### US-3. Progress by timeline
As the QA admin, I want to see every timeline of the cycle with its steps, so that I know where each one is and when its current step closes.

- One row per timeline that is **live or scheduled** (closed timelines are not shown):
  - Order: the official timeline first, then live ones by closest closing date, then scheduled ones.
  - The filters hide timelines with no matching results. A scheduled timeline stays when its scope fits the filters.
- Each row shows:
  - **Name**, plus a "Scheduled" tag when it has not started.
  - **Kind · scope · size**: "Main batch · All programs · 989 results", or "Complementary batch · SP02, SP05 · 216 results". A test timeline says "Test" instead of the count.
  - **One bar with that timeline's own steps**. Not every timeline has all five steps: a timeline uses some of them, in order, each once.
    - The five steps: Assessors · Programs correct · Lead assessor · Third-party broker · PPU.
    - Each step is named under its segment by name, never by number, because the same step can be number 3 in one timeline and 4 in another.
    - Finished steps show a check, the open step is outlined and fills up with its progress ("Now · 88%"), and steps not started are grey.
  - On the right: "**870 of 989** done in this step" (or "Not started") and "Closes 23 Jul (4 days left)" / "Starts 01 Sep".
- A legend: Step finished · Open now (fills up as results get done) · Not started.
- With more than **5** timelines, the rest are behind "Show all N →" / "Show less".
- **Open Cycle** link in the block header (admin only).
- Clicking a row opens the **stages pop-up** of that timeline (US-4).
- When the filters narrow the page, the counts are that share of each timeline.

### US-4. Stages pop-up of a timeline
As the QA admin, I want the detail of one timeline's steps, so that I can see dates and progress without opening Cycle.

- Title: the timeline name, plus "Main batch, 989 results. Each stage closes when its own condition is met."
- One row per step of that timeline, numbered in that timeline's order:
  - Full step name ("QA platform open for third-party broker"), its closing rule, dates ("06 Jul – 23 Jul", or "From 19 Jul" when the step has no end date) and status.
  - Status is one of **Completed · In progress · Behind · Not started**. *Behind* means less work done than the share of the step's window already gone.
  - Open step: a progress bar with "88% (870 of 989), 119 left".
  - Completed step: a one-line summary, for example "989 assessed · 372 returned" (Assessors), "372 answered · 38 unchanged" (Programs correct) or "85 highlighted" (Lead assessor).
- Closing rule per step (to confirm, see § 7):
  - Assessors: every assigned assessor has reviewed all of their results.
  - Programs correct: every returned result is corrected in the Reporting Tool, or the window ends.
  - Lead assessor: every case has a decision from a lead assessor.
  - Third-party broker: every highlighted field has a final decision from a broker.
  - PPU: the PPU has closed every result in the timeline.
- Read only. The steps do not link to Results.

### US-5. Round 1 and Round 2
As the QA admin, I want the whole cycle split into Round 1 and Round 2, with the status of the results inside each step, so that I can compare both rounds without mixing their data.

- Top line: "**1,330** results in QA, from 4 live timelines". With one timeline picked: "…, Step 4 of 5 · closes 23 Jul".
- Two cards side by side (stacked on phones):
  - **Round 1**, "Assessors and science programs".
  - **Round 2**, "Lead assessors and third-party brokers".
- Each card shows its total, one bar with all its statuses, and the list of its steps. Each step is named, with its statuses and counts:

| Round | Step | Statuses |
|---|---|---|
| Round 1 | Assessors | Pending · In review · Assessed by 1 assessor · Assessed by 2 assessors |
| Round 1 | Programs correct | Pending reply · Comments replied |
| Round 2 | Lead assessor | Pending lead assessor review · Assessed by lead assessor |
| Round 2 | Third-party broker | Pending third-party review · Assessed by third party |

- Only the steps used by the timelines in view are shown. If a timeline has no Round 2 steps, the card says "This timeline has no Round 2 steps."
- The PPU step is not in the cards: María Julia said it was not important here (2026-10-27).
- Colors: grey while waiting, the round's color as work gets done (indigo for Round 1, blue for Round 2). Green is only for the final state.
- Under the cards, a strip for **Quality assessed**, "Finished every QA step": count and % of the results in QA. It is the only place where "Quality assessed" appears on the page.
- Every status with a Results filter is a link that opens Results with that QA stage and the page's filters. Today these are the Assessors statuses (except "Assessed by 2 assessors") and Quality assessed. The others become links once Results can filter by them.

### US-6. Assessment pace
As the QA admin, I want to know whether the open step will close on time, so that I can act before it is late.

- It shows **one open step**: the most at risk among those the filters keep (behind pace first, then the soonest to close). The subtitle names it: "July 2026 sub-timeline · Step 1 · the step most behind of 2 open steps".
- Badge: **Behind pace** or **On pace**. *Behind* means that, at the pace of the last 7 days, the step would not get through all its results before it closes.
- Four figures in a row: **still to do** · **needed per day** · **per day, last 7 days** · **days left**.
- Chart across the card, from the step's start to its close:
  - Done so far (solid line).
  - At current pace (dotted projection).
  - Needed to finish on time (dashed line).
  - Hovering a day shows its value.
- In the **assessors' step only**, an "Assessor ⌄" choice narrows the pace to one assessor ("All assessors" by default). It is the only filter a block keeps for itself.
- Empty state: "No open step matches these filters."

### US-7. Progress by result type
As the QA admin, I want each result type's progress, so that I can see which types are behind.

- One row per result type with results in view: **least advanced first**.
- Each row: type name, a 100% bar split into In Round 1 · In Round 2 · Quality assessed, and "**18%** 23 of 127" (share and count quality assessed).
- Same colors as the rounds (indigo, blue, green), with a legend.
- Clicking a row opens Results filtered by that type, plus the page's filters.
- Empty state: "No results match these filters."

### US-8. Assessor load
As the QA admin, I want to see how much each assessor has assessed and has left, so that I can rebalance the work or follow up with someone who is stuck.

- It counts only timelines whose **open step is the assessors' step**, and says which: "Timelines in the assessors' step: July 2026 sub-timeline, SP03 late reporting". When there is none: "No timeline in these filters is in the assessors' step".
- One row per assessor with work in view, **most pending first**:
  - Name.
  - A **Never signed in** tag when the assessor has never entered the platform.
  - A bar with Assessed and Still to assess, all bars on one shared scale.
  - "**25** left".
- **Open Assessors** link to the Assessors screen (admin only).

## 5. Rules that apply to the whole page

- **Active cycle only.** Everything is about the active phase. There is no need to look at past years from QA (Ángel, 2026-10-21).
- **One vocabulary** for result stages in the Overview, Results and Review: Round 1 (Pending · In review · Assessed by 1 assessor · Assessed by 2 assessors) · Round 2 (Pending · Assessed) · Quality assessed. "Automatic" results are not under assessment and are not counted.
- **Timeline kinds** read as "Main batch" (official timeline) and "Complementary batch" (sub-timelines) on screen.
- **Results deep links:**
  - `?timeline=<id>`, `?program=<codes>`, `?type=<types>`, `?stage=<stage>[,<stage>…]`.
  - Stages: `r1-pending`, `r1-review`, `r1-one`, `r1-two`, `r2-pending`, `r2-assessed`, `quality-assessed`.
- **Loading:** while data loads, each block shows a skeleton with its real shape. When the data lands, rows come in one after another.
- **Accessibility:** WCAG AA. Every bar has a text equivalent, and every link and row works with the keyboard.
- **Responsive:** desktop, tablet and phone, with the same order.

## 6. Data the page needs from the API

For the active cycle, narrowed by timeline, science programs and result types:

| Block | Data |
|---|---|
| Filter bar | Live timelines (id, name, kind, results count); science programs; result types |
| Progress by timeline | Per live or scheduled timeline: kind, scope (programs or types), results count, test flag, steps in order with start/end dates and state (done / open / future), and for the open step how many results are done of how many |
| Stages pop-up | Per step: closing rule, dates, status, progress, and a summary for completed steps |
| Round 1 / Round 2 | Count of results per step status (table in US-5), and count quality assessed |
| Assessment pace | Per open step: results to get through, and cumulative results done per day since the step opened (per assessor in the assessors' step) |
| Progress by result type | Per result type: count in Round 1, in Round 2 and quality assessed |
| Assessor load | Per assessor, in timelines whose open step is the assessors' step: assessed, still to assess, never signed in |

Today the design uses mock data (`client/src/app/pages/workspace/overview/overview.mock.ts`); every place to connect to the API is marked `TODO(api)`.

## 7. Open points

- **Lead assessor and TPB steps.** Their closing rules depend on how the lead works, and two versions are on the table: Santi's (the lead highlights fields with an instruction) and Ángel's (the lead reviews only core fields and closes or escalates). The status names of Round 2 may change with the answer (see `docs/qa-context.md` § Open questions).
- **Knowledge products:** whether they are assessed in step 1 or go straight to Round 2 changes which round counts them.
- **Statuses without a Results filter yet:** "Assessed by 2 assessors", Programs correct, Lead assessor and TPB. They are not links until Results can filter by them.
- **Step names in Round 1 and Round 2:** to confirm with María Julia.
