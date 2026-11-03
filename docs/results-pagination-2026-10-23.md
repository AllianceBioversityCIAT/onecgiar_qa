# Results table pagination — 2026-10-23

## Done
- New shared `qa-pagination` (`client/src/app/ui/pagination/`), styled after the PRMS table footer: "Showing 1–25 of 1,330", rows per page (10 / 25 / 50 / 100), previous / next and page numbers with "…". Narrow screens show "Page 1 of 54" between the arrows.
- The Results table shows it inside its card (projected with `qaTableFooter`). It replaces the "Show 50 more" link. Default: 25 per page.
- Changing filters, search, sort or rows per page goes back to page 1. Changing page scrolls the table top back into view.

## Tested
- In the browser (design user, mock data): next, last page (next disabled, 5 rows), 50 per page and back. 1440 and 390, no horizontal scroll.
- `npx ng build` passes (the existing 500 kB initial budget warning remains).

## Pending
- Not checked at 768 / 1024 or in dark mode.
- With the real API, paging should move to the server (page + size in the request).
