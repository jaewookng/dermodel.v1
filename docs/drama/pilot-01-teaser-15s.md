# THE NANNY — 15-second trial cut
### 3 shots × 5s · Kling Video v3.0 Omni · 9:16

**Use 3 shots, not 6.** You have six generations available but only 15 seconds of
runtime. Six clips would be 2.5s each — too short to establish a face, and each
extra clip is another chance to drift. Three 5-second shots is strictly better,
and it leaves three generations spare for re-rolls.

## What this is actually for

This is a **consistency test that doubles as a teaser.** The question that
decides whether this whole series is buildable is: *does Nora's face survive
between shots?* Shots 2 and 3 put her in two different locations under two
different lighting setups. If she reads as the same person across that cut, the
pipeline works and you can commit budget. If she doesn't, you found out for the
price of a trial.

It also happens to be a complete dramatic unit — accusation, humiliation, the
turn — so if it looks good, post it.

---

## SHOT 1 · 5s · The accusation

```
Vertical 9:16 cinematic drama, 5 seconds. Close-up of a poised 48-year-old woman
in a cream silk blouse with a fine gold chain necklace, standing in a cold
marble kitchen. The skin along her jaw and throat is red and irritated. She
holds a small glass serum bottle up near her face and speaks with quiet
controlled anger directly to someone off-screen. Soft overcast morning light,
muted desaturated palette, shallow depth of field, 50mm, static camera.
```
**Dialogue:** *"You used them. Don't lie to me."*

---

## SHOT 2 · 5s · The word — NORA, TEST A

```
Vertical 9:16 cinematic drama, 5 seconds. Close-up of a 22-year-old woman with
pale freckled skin and dark blonde hair in a tight low ponytail, wearing a grey
knit cardigan. She stands very still, listening, saying nothing. Her jaw tightens
slightly and her eyes lower. Cold marble kitchen behind her, soft overcast
window light from the side, muted desaturated palette, shallow depth of field,
50mm, static camera.
```
**Dialogue (off-screen, female, warm):** *"The nanny doesn't touch my things."*

---

## SHOT 3 · 5s · The turn — NORA, TEST B *(different light, different room)*

```
Vertical 9:16 cinematic drama, 5 seconds. The same 22-year-old woman with pale
freckled skin and dark blonde hair, now sitting on the edge of a narrow bed in a
small plain bedroom, lit only by a warm bedside lamp with the rest of the room
dark. She looks down at a phone in her hands, the screen lighting her face from
below. Her eyes track downward, then stop. She goes still. Muted palette,
shallow depth of field, 50mm, static camera, slow push in.
```
**No dialogue.** Cut to black on her stillness.
**End card (in edit, 1.5s):** THE NANNY — Ep. 1 coming

---

## How to read the result

Put shots 2 and 3 side by side and ask one question: **is that the same woman?**

- **Same person, different light** → the pipeline works. Bind her as an Element
  and commit to the six-shot episode.
- **Roughly similar but off** → fixable. Tighten the reference image and lean
  harder on the anchors (freckles, ponytail, grey cardigan).
- **Clearly two different people** → do not spend money on video yet. The fix is
  upstream: a stronger single reference image, bound as a subject on every
  generation rather than re-described in the prompt.

Shot 3 is the harder test on purpose — different room, different light source,
lit from below by a phone. If she holds there, she will hold anywhere in this
episode.

## Order of operations

1. Generate shot 2 first. It is the cleanest look at Nora.
2. If you like her, **save her as an Element** before generating shot 3, and
   bind it. That is the mechanism you are testing.
3. Generate shot 3. Compare.
4. Generate shot 1 last — Eleanor only appears once here, so she is the least
   risky and the least informative.

You have three spare generations. Spend them re-rolling shot 2 until Nora is
right, not on adding more shots.

## Guardrails

- Fictional brand only. No real product named or shown.
- Eleanor's irritation is shown once, as irritation. No before/after.
- AI disclosure toggle ON if you post it.
