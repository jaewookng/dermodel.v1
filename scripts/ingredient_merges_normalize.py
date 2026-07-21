"""Normalize docs/ingredient-merges.csv after appending a new slice.

  python3 normalize.py docs/ingredient-merges.csv

1. Drops duplicate variant rows, keeping the FIRST occurrence (earlier passes
   win — they were validated already). Reports any that disagreed.
2. Forces tier 5 when the variant differs from its canonical only by * / +.
3. Collapses A->B->C chains so every variant points at a terminal canonical.

Run validate.py afterwards; it must report 0 for every category.
"""
import re
import sys

p = sys.argv[1]
raw = open(p).read().split("\n")
header, rows = raw[0], [l for l in raw[1:] if l.strip()]

seen, order, conflict = {}, [], []
for l in rows:
    v, c, t, cf = l.split("|")
    if v in seen:
        if seen[v] != [c, t, cf]:
            conflict.append((v, list(seen[v]), [c, t, cf]))
    else:
        seen[v] = [c, t, cf]
        order.append(v)

retiered = 0
for v in order:
    c, t, _ = seen[v]
    if c and re.search(r"[*+]", v) and t != "5" \
            and re.sub(r"[*+]", "", v).replace("  ", " ").strip() == c:
        seen[v][1] = "5"
        retiered += 1

chains = 0
for v in order:
    c, hops = seen[v][0], 0
    while c in seen and seen[c][0] and seen[c][0] != c and hops < 10:
        c = seen[c][0]
        hops += 1
    if hops:
        chains += 1
        seen[v][0] = c

open(p, "w").write("\n".join([header] + ["|".join([v] + seen[v]) for v in order]) + "\n")
for v, a, b in conflict:
    print(f"CONFLICT {v!r}: kept {a} vs dropped {b}")
print(f"{len(order)} rows | dropped {len(rows)-len(order)} dupes "
      f"| retiered {retiered} | collapsed {chains} chains")
