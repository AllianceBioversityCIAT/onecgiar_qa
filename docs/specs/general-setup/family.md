# Template — `family.md` (spec family manifest)

> Written by `/akili-propose` or `/akili-specify` **only when a proposal is split** into child specs. A spec without `family.md` is flat and carries no extra obligations. Place it in the parent folder: `docs/specs/<domain>/<family>/family.md`.

## Skeleton

```markdown
# <Family title> — Spec Family

## Document Control
| Parent spec | Created | Last updated | Family status |
|---|---|---|---|
| docs/specs/<domain>/<family> | YYYY-MM-DD | YYYY-MM-DD | open |

## Children
| # | Spec Path | Depends on | Parallel-safe | Status |
|---|---|---|---|---|
| 1 | <family>/<child-a> | none | no | pending |
| 2 | <family>/<child-b> | <family>/<child-a> | yes | pending |

> **Closed set.** This table is the exhaustive child set of the family. No AKILI command creates a child spec folder without a row here first; adding a row is a HITL-approved manifest edit.
```

## Column values

| Column | Values | Meaning |
|---|---|---|
| `#` | 1..n | Build order |
| `Spec Path` | `<family>/<child>` | Must match a real folder |
| `Depends on` | spec path(s) or `none` | Serial ordering constraint |
| `Parallel-safe` | `yes` / `no` | Can run in parallel with siblings |
| `Status` | `pending` / `active` / `done` / `blocked` | Phase detail lives in each child's own documents |

Family status is `open` until every child is `done`, then `complete`.
