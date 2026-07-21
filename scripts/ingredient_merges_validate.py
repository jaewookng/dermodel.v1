import sys
names = set()
with open(f"{sys.argv[1]}") as f:
    for line in f:
        parts = line.rstrip("\n").split("\t")
        if parts and parts[0]:
            names.add(parts[0])

bad_v, bad_c, self_ref = [], [], []
seen = set()
dupe = []
n = 0
with open(sys.argv[2]) as f:
    next(f)
    for line in f:
        line = line.rstrip("\n")
        if not line:
            continue
        v, c, tier, conf = line.split("|")
        n += 1
        if v in seen:
            dupe.append(v)
        seen.add(v)
        if v not in names:
            bad_v.append(v)
        if c and c not in names:
            bad_c.append((v, c))
        if c and v == c:
            self_ref.append(v)

print(f"rows: {n}")
print(f"variant not found in table ({len(bad_v)}):")
for x in bad_v: print("   ", repr(x))
print(f"canonical not found in table ({len(bad_c)}):")
for v, c in bad_c: print("   ", repr(v), "->", repr(c))
print(f"variant == canonical ({len(self_ref)}):")
for x in self_ref: print("   ", repr(x))
pairs = {}
with open(sys.argv[2]) as f2:
    next(f2)
    for line in f2:
        line = line.rstrip("\n")
        if not line: continue
        a,b,_,_ = line.split("|")
        if b: pairs[a]=b
chains = [(a,b) for a,b in pairs.items() if b in pairs]
print(f"merge chains A->B->C ({len(chains)}):")
for a,b in chains: print("   ", repr(a), "->", repr(b), "->", repr(pairs[b]))
print(f"duplicate variant rows ({len(dupe)}):")
for x in dupe: print("   ", repr(x))
