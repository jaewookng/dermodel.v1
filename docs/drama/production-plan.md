# Vertical Production Studio — Plan of Record
**Updated 2026-09-08**

---

## 1 · Status

| Asset | State |
| --- | --- |
| Character Elements (Nora, Eleanor, Teddy) | ✅ **Saved in Kling.** The one durable asset produced so far. |
| Kling MCP connection | ✅ Authorized (user `104995592`), tools reachable |
| API generation | ❌ **Blocked — 0 spendable credits** |
| Pilot script | ⚠️ Superseded, see §3 |

**The credit finding, so it isn't rediscovered later:** the ~66 credits visible in
the Kling web UI are **not spendable through the API**. Confirmed three ways —
two balance queries returning `0.0`, and a real job submission rejected with
*"Insufficient credits."* Account IDs match, so this is a pool distinction, not a
wrong-account problem. **API generation requires separately purchased credits.**

Trial ceiling observed: 6 generations, 15 seconds total runtime.

---

## 2 · Strategy

**Channel.** YouTube Shorts, vertical 9:16.
**Audience.** Women 16–36, educated, cosmetics-interested — specifically those
who want to *know and own what they eat, apply and consume.*

**Why this audience matches the material.** The dominant 2026 skincare trend is
**ingredient literacy** — consumers moving past brand marketing to ask why an
ingredient is in a formula, with "skin longevity" displacing "anti-aging."
TikTok drives awareness; search captures the research intent. Our protagonist is
the dramatised form of that impulse.

**Monetization reality — do not build the business on YouTube ad revenue.**
YouTube's *inauthentic content* policy explicitly de-monetizes generic,
template-based video with little original input, and **detection is at channel
level**, so one templated batch taints everything. Shorts revenue also requires
10M qualified views per rolling 90 days.

So: **YouTube is the proving ground and the funnel. Licensing is the revenue.**
ReelShort and DramaBox buy series outright at **$150–250K per 60–90 episode
series**. A series that performs on Shorts becomes the sizzle reel for a platform
buyer.

⚠️ **The two paths conflict per series.** A platform buyer owns what it buys and
is unlikely to accept embedded placement for a business it has no stake in. Run
two tracks: licensed series with no placement, self-published series with it —
sharing characters, pipeline and crew.

---

## 3 · Creative direction (revised)

### Title: **NANNY, MD** — locked 2026-09-08
Full bible: `nanny-md-bible.md`. Protagonist is a third-year medical school
dropout, not a biochem graduate.

**The nanny job is the setting, not the subject.** Previous draft made the
household the story. It isn't.

### Engine
> **She is the most qualified person in the room and the least believed.**

A biochemistry graduate takes a live-in caregiving job wanting meaningful health
work, and is slotted into domestic staff. Every episode her expertise surfaces
something real. Every episode, the cost of saying it out loud goes up.

This is the emotional experience of being a young woman with credentials nobody
consults — which is exactly why it converts to this audience. They are not
watching a household drama. They are watching someone be right in a room that
has decided she isn't worth asking.

### What changes from the old draft
- The wound is **professional**, not domestic. The humiliation is not being
  treated badly; it is being *unasked*.
- Give her credentials visible presence: a lab notebook, a half-finished
  graduate application, a degree still in its cardboard tube.
- The word "nanny" stays as the recurring slight — it is the knife, not the
  premise.
- Teddy remains **the only person who listens to her.** That is the relationship
  the series is actually about.

### Characters (Elements already saved — do not regenerate)
- **NORA VANCE, 22.** Biochem BSc. Anchors: grey knit cardigan · tight low
  ponytail that loosens through the day · thin silver watch, left wrist · no
  makeup.
- **ELEANOR MERCER, 48.** Anchors: cream silk blouse · fine gold chain · chestnut
  blowout · the ring she turns when lying.
- **TEDDY MERCER, 14.** Intellectually disabled — written through **behaviour,
  never visual signifiers.** He keeps count of which nights his mother is home.
  Anchors: navy hoodie · handheld puzzle toy · his place at the window.

### Episode architecture
90s, six beats, cliffhanger on the last. The surviving structure from the pilot
work: accusation → the slight lands → Teddy notices something → she reads the
truth → she confirms it → being right becomes dangerous.

The serum plot still works and is **stronger** under this engine: she is accused
of contaminating cosmetics, and the only way to clear herself is to deploy the
expertise nobody hired her for.

**The reveal is real chemistry.** A genuine "caviar" vitamin C serum in the
dermodel database lists `Citrus Paradisi Peel Oil` at position 4 — grapefruit
peel oil, a furocoumarin-bearing **phototoxic** compound, present in 311
products. Over skin freshly stripped by a glycolic acid, in direct sun, the rash
is exactly what a biochemist would predict on sight. The show can be
fact-checked and holds up. That is the moat.

---

## 4 · Pipeline

**Stack.** Kling Image v3.0 / Image O1 for character references → save as
Elements → Kling Video v3.0 Omni (the only model accepting video subjects) for
shots → ElevenLabs for voice → CapCut/Premiere assembly → Topaz finish.

**Order of operations.**
1. Character references first, always. Faces are the gate.
2. Bind as Elements. Never re-describe a character in a shot prompt.
3. Generate shots, faces last-priority for long durations.
4. Assemble, cut hard, every clip starting already in motion.

**Hard-won production rules.**
- **Put critical story beats on hands and objects, not faces.** Zero drift risk,
  cheaper, and it is better filmmaking. The two best shots in the pilot draft
  show no face at all.
- **Cap continuous face time at ~3s.** Drift compounds with duration.
- **A long clip needs a long described action.** Ask for 15s while describing a
  5s beat and the model fills the rest with repetition or wandering.
- **Two locations, three faces, maximum.** Drift scales with cast.
- **Generate out of story order**, cleanest-face shot first, and hold one
  generation in reserve for a re-roll.

**Cost model.** $50–500 per episode, $3–30K per season for an indie team, with
usable-footage rates above 90%.

---

## 5 · Guardrails (non-negotiable)

- **Fictional brands only.** Real chemistry, invented products — *Maison Lelan*.
  Naming a real product and dramatising that it caused a rash is trade libel.
- **No skin-result footage. Ever.** Irritation may appear as irritation; never
  before/after. Implied results are the FTC's active enforcement area.
- **The app informs; the character deduces.** If dermodel is shown concluding or
  diagnosing, that is a product claim it cannot support and every viewer who
  downloads it is disappointed inside a minute.
- **Placement ceiling: ~6 seconds, once per episode**, and only as a tool she
  uses. Randomised across episodes, never in dialogue.
- **AI disclosure toggle ON** at every upload. Required, and costs nothing in
  this genre.
- **No astroturfing.** Single branded channel. Fake personas endorsing the
  product are illegal under the FTC's 2024 reviews-and-testimonials rule.

---

## 6 · Next actions

1. ~~Decide the title~~ — **NANNY, MD**, locked.
2. **Resolve API credits.** Confirm with Kling support whether purchased credits
   are required for MCP generation, before buying blind.
3. **Rewrite the pilot** under the overqualification engine (beats survive, spine
   changes).
4. **Then** the 6-shot generation, faces already bound.

Superseded: `pilot-01-the-nanny.md`, `pilot-01-teaser-15s.md`.
Still valid as reference: `pilot-01-shots-6.md` (shot craft), `pilot-01-prompts.md`
(character anchors).
