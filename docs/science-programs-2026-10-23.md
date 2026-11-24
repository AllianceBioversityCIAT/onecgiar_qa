# Science programs aligned with PRMS — 2026-10-23

## Done
- Mock program lists (results, overview, cycle and review mocks) now match the PRMS design file (`PROGRAMS` in "PRMS Reporting.dc.html"): 13 programs, SP01–SP13, same names and order. SP10 Gender Equality and Inclusion was missing.
- Results per program in the official timeline were redistributed so the total stays at 1,114 (1,330 in QA with the sub-timelines).
- Old names removed ("Rice Agrifood Systems", "Genetic Innovation"), including the review page ToC rows.

## Tested
- Results → Science program filter lists the 13 programs; SP03, SP06, SP08, SP10 and SP13 return results; total still 1,330. Overview loads.
- `npx ng build` passes.

## Pending
- Review page not opened in the browser.
- With the real API, the list should come from the server, not from the mocks.
