# Ingredient duplicate audit

Manual read-through of all 21,192 rows in `sss_ingredients` (sorted
case-insensitively, 2026-07-20). Judgement-based — no scripts or regex were
used to decide what counts as a duplicate.

Counts in parentheses are `product_count` at time of audit.

**Headline:** a large share of the table is not distinct ingredients. The
biggest single cause is misspellings of very common INCI names, followed by
punctuation/format variants of the same name. My estimate is that
**roughly 6,000–8,000 of the 21,192 rows collapse into an existing row.**

---

## Tier 1 — Misspellings of high-traffic ingredients (highest value)

These are unambiguous. The canonical row has thousands of products; the
variants are typos that should merge into it. This tier alone is likely
1,500+ rows.

**Ethylhexylglycerin** (12,862) — `Ethylhexyglycerin` (61),
`Ethylhexlyglycerin` (376!), `Ethyhexylglycerin` (34), `Ethylhexlglycerin`
(11), `Ethylhexyl Glycerin` (138), `Ethylhexylglycerine` (8),
`Ethylhexylglycern` (3), `Ethylhexylglyerin` (3), `Ethylhexylgylcerin` (6),
`Ethlhexylglycerin` (5), `Ethylexylglycerin` (5), `Ethylhe Xylglycerin` (5),
`Ethylhexl Glycerin` (2), `Ethylhexylglyceri` (2), `Ethylhexylglycerol` (2),
`Ethylhexylglyercin` (1), `Ethylheyxlglycerin` (2), `Ethylheyxylglycerin` (1),
`Ethylhexylyglycerin` (1), `Ethylxeylglycerin` (1), `Ethythexylglycerin` (4),
`Ehtylhexylglycerin` (9), `Exythyhexyl Glcerin` (1) — **~23 variants**

**Phenoxyethanol** (22,292) — `Phenoxyethand` (7), `Phenoxyeth-Anol` (10),
`Phenoxy Ethanol` (18), `Phenoxy-Ethanol` (22), `Phenoxyethenol` (5),
`Phenoxyetanol` (3), `Phenoxythanol` (8), `Phenoxethanol` (9),
`Phenoryethanol` (8), `Pheoxyethanol` (5), `Phenaxyethanol` (7),
`Phenayethanol` (3), `Phencayethanol` (2), `Phenokyethanol` (4),
`Phenoyxethanol` (2), `Phen Oxyethanol` (1), `Phenoxyeihanol` (1),
`Phenaxyethanoi` (1), `Phenoxyethannol` (1), `Phenoxyethaqnol` (1),
`Penoxyethanol` (4), `Henoxyethanol` (7) — **~22 variants**

**Caprylyl Glycol** (10,754) — `Capryly Glycol` (27), `Caprylyl Gycol` (3),
`Caprylyl Gylcol` (2), `Caprylyl Glyocol` (1), `Caprylyl Glyocal` (1),
`Caprylyi Glycol` (2), `Capryl Glycol` (51), `Caprlyl Glycol` (3),
`Caprlylyl Glycol` (1), `Capryyl Glycol` (3), `Capyrylyl Glycol` (2),
`Carprylyl Glycol` (2), `Caprylylglycol` (10)

**Glycerin** (34,917) — `Glycerine` (268), `Giycerin` (17), `Gycerin` (17),
`Gylcerin` (6), `Glycern` (4), `Glycein` (1), `Glycenn` (2), `Glyoerin` (2),
`Glyce Rin` (2), `Glicerin` (3), `Clycerin` (3), `Hlycerin` (1)

**Cetearyl Alcohol** (9,732) — `Ceteary Alcohol` (23), `Cetearylalcohol` (15),
`Cetearly Alcohol` (2), `Ceterayl Alcohol` (2), `Ceteryl Alcohol` (5),
`Cetery Alcochol` (1), `Cetearyl Alc` (1)

**Glyceryl Stearate** (9,141) — `Glycery Stearate` (25), `Glyceryl Sterate`
(7), `Glycerl Stearate` (4), `Glyceril Stearate` (3), `Giyceryl Stearate` (5),
`Glyeryl Stearate` (2), `Gylceryl Stearate` (2), `Glyceryl Stearote` (1),
`Glyceryi Stearate` (1), `Glycerylstearate` (6), `Grlyceryl Stearate` (1),
plus `Glyceryl Stearate Se` variants (`Glyceryl Sterate Se`,
`Glyceryl Stearatese`, `Glyceryl Stea Rate Se`)

**Cetyl Alcohol** (8,781) — `Cety Alcohol` (17), `Cetl Alcohol` (7),
`Cetyl Alchol` (3), `Cety Alchol` (1), `Cety! Alcohol` (1)

**Butyrospermum Parkii Butter** (6,661) — `Butyrospermum Parki Butter` (70),
`Butyrospemum Parki Butter` (8), `Butyrospemum Parkii Butter` (4),
`Butyrospermum Pakii Butter` (4), `Butyrospermum Park Butter` (2),
`Butrospermum Parkii Butter` (3), `Butryospermum Parkii Butter` (5),
`Butyospermum Parkii Butter` (3), `Butyrospermun Parkii Butter` (7),
`Butyrospermumparkii Butter` (7), `Butyrospernum Parki Butter` (1),
`Butyrospermum Parkiil/Parkili Butter` (2) — **~15 variants**

**Others in this pattern** (canonical → representative typos):
Tocopherol (13,581) → `Tocopheral` (14), `Tocpherol` (2), `Toco-Pherol` (6) ·
Tocopheryl Acetate (12,732) → `Tochopery Acetate` (21), `Tocopheryl Acetat`
(1), `Tocopheryl Acette` (2), `Tocopheyl Acetate` (5), `Tocophyeryl Acetate`
(1), `Tocopherylacetate` (22), `Tocoperyl Acetate` (2) ·
Xanthan Gum (12,717) → `Xantham Gum` (89), `Xanthum Gum` (37),
`Xan-Than Gum` (13), `Xathan Gum` (5), `Xanthane Gum` (5), `Xanthan Qum` (1) ·
Disodium EDTA (13,686) → `Disodium Etda` (4), `Disoidum Edta` (2),
`Disodiumedta` (8), `Disodium Ed Ta` (2), `Disosium Edta` (1),
`Disodiium Edta` (1), `Disodum/Sodum` forms ·
Sodium Hyaluronate (11,731) → `Sodium Hyaluro-Nate` (10), `Sodium Hyaluroate`
(3), `Sodiumhyaluronate` (13), `Sodium Yaluronate` (1) ·
Sodium Hydroxide (11,284) → `Sodium Hydrowide` (1), `Sodium Hydrowde` (1),
`Sodium Hydraxide` (3), `Sodium Hydoxide` (1), `Sodium Hyroxide` (4),
`Sodium Hydroxyde` (4), `Sodiumhydroxide` (8), `Soduim Hydroxide` (3) ·
Dimethicone (11,787) → `Dimethicol` (1), `Dimethocone` (1), `Dmethicone` (1),
`Dimeticone` (6), `Imethicone` (1) ·
Carbomer (9,624) → `Cabomer` (4), `Carbormer` (3), `Carmober` (1) ·
Citric Acid (15,560) → `Citic Acid` (4), `Citiric Acid` (2), `Citricacid` (20),
`Citrus Acid` (1) ·
Chlorphenesin (3,989) → `Chiorphenesin` (6), `Chlorphensin` (7),
`Chlor Phenesin` (2), `Chiorphenesit` (1) ·
Methylparaben (3,564) → `Methylparaber` (1), `Methylparben` (1),
`Methyparaben` (10), `Methyloparaben` (1), `Methy Paraben` (1) ·
Hydroxyacetophenone (3,020) → `Hydroxyaceto Phenone` (2), `Hydroxy
Acetophenone` (7) ·
Linalool (8,656) → `Linaloo` (11), `Linalol` (6), `Linallol` (1),
`Linanool` (2), `Linal0Ol` (1) ·
Limonene (8,772) → `Limonen` (9), `Umonene` (7), `Limonene-D` (4) ·
Citronellol (4,235) → `Citronelloi` (2), `Citronello` (2), `Cironellol` (3),
`Citroneliol` (3), `Citronnellol` (12), `Ctronellol` (1) ·
Geraniol (3,976) → `Gernaiol` (20), `Geranoil` (6), `Gerianol` (1) ·
Hydroxycitronellal (1,616) → `Hydroxycitronelial` (1), `Hydroxycitronellai`
(1), `Hydroxycitroellal` (1), `Hydraxycitronellal` (1), `Hydroyctronellal` (1),
`Hydroxcitronellal` (2), `Hydroxy Citronellal` (2)

---

## Tier 2 — Punctuation / spacing / dual-name format variants

Same substance, different typographic convention. Very high volume.

**Bilingual & slash forms** — the single largest cluster in the table:
- `Aqua` (7,169) vs `Water` (15,423) vs `Aqua/Water/Eau` (2,822) vs
  `Water\Aqua\Eau` (8,573) vs `Water/Aqua/Eau` (3,147) vs `Water/Eau` (577)
  vs `Aqua/Water` (689) vs `Water/Aqua` (367) vs `Aqua / Water / Eau` (368)
  … **~60 spellings of water**, including `Wateraquaeau`, `Watervaqualeau`,
  `Aquawatereau`, `Aqua ; Water ; Eau`, `Wate Aqua`.
- Beeswax: `Beeswax` (1,461) / `Cera Alba` (719) / `Beeswax/Cera Alba` (61) /
  `Cera Alba/Beeswax/Cire D'Abeille` (54) / `Beeswax\Cera Alba\Cire D'Abeille`
  (19) … **~35 forms**, including several mojibake variants
  (`Cire D‚Äôabeille`).
- Fragrance: `Fragrance` (12,517) / `Parfum` (4,367) / `Perfume` (1,605) /
  `Fragrance/Parfum` (981) / `Parfum/Fragrance` (1,487) /
  `Fragrance / Parfum` (253) / `Parfum / Fragrance` (410) … **~40 forms**
  plus typos `Fragranc`, `Frgrance`, `Fragrnce/Parfum`, `Partum` (7),
  `Perfum` (10), `Parfume` (6).
- Similar clusters for: Carnauba wax (`Copernicia Cerifera Cera/Wax` ~30
  forms), Candelilla (`Euphorbia Cerifera` ~30 forms), Microcrystalline wax
  (~25 forms), Honey/`Mel`/`Miel` (~20), Yeast/`Faex` (~15), Sea salt/
  `Maris Sal` (~12), Olus/Vegetable oil (~10), Shea/`Butyrospermum` (~15).

**Slash vs space vs hyphen in chemical names** (each pair is one substance):
- `Acrylates/C10-30 Alkyl Acrylate Crosspolymer` (4,252) has **~40 variants**:
  `Acrylates / C10-30…` (23), `Acrylates C10-30…` (26), `Acrylates/ C10-30…`
  (85), `Acrylates/C10 30…` (18), `Acrylatesc10-30…` (9),
  `Acrylates\C10-30…` (1), `Acylates/…` (4), `Aerylates/…` (1),
  `Acrylates/Ci0-30…` (5), `Acrylates/Cio-30…` (9), `Acrylates/C1030…` (2) …
- `Ammonium Acryloyldimethyltaurate/Vp Copolymer` (1,329) — **~15 variants**
- `Hydroxyethyl Acrylate/Sodium Acryloyldimethyl Taurate Copolymer` (1,772) —
  **~20 variants**
- `Pentaerythrityl Tetra-Di-T-Butyl Hydroxyhydrocinnamate` (1,102) —
  **~18 variants**
- `Caprylic/Capric Triglyceride` (9,915) — `Caprylic Capric Triglyceride`
  (53), `Caprylic / Capric Triglyceride` (28), `Caprylic/ Capric Triglyceride`
  (182), `Capric/Caprylic Triglyceride` (45, word order), `Caprilic/Capric…`
  (3), `Caprylic/Capri Triglyceride` (2), `Caprylicicapric…` (3),
  `Caprylie/Caprie Triglyeeride` (1) … **~30 variants**

**Trailing asterisks / daggers / superscripts** (organic-certification marks
that leaked into the name): thousands of rows. Examples: `Alcohol*` (10),
`Aqua*` (2), `Beeswax*` (3), `Citral*` (11), `Limonene*` (11),
`Linalool*` (10), `Geraniol*` (12), `Tocopheryl Acetate*` (4),
`Butyrospermum Parkii Butter Extract*` (10), `Helianthus Annuus Seed Oil*`
(44), `Cocos Nucifera Oil*` (40). Also `**`, `¬≤`, `¬≥`, `‚Ä†` suffixes.

**Mojibake / encoding damage** — should be normalized or deleted:
`Acetyl Hexapeptide‚Äì8`, `Aquaxyl‚Ñ¢`, `Alkylpolyglucoside C8‚Äìc16`,
`Arni¬≠¬≠¬≠¬≠Ca Montana Flower Extract`, `Coriandrum Sativum Fruit √Ïil`,
`C√≠3-14 Isoparaffin`, `Retinyl Safô¨Çowerate`, `Saponiô¨Åed Butyrospermum`,
`Soy Isoô¨Çavones`, `√Åcido L√°Ctico` (= Lactic Acid), `Œ≤-Pinene`,
`Ƒ†Inseng Radix…`, `‚Äã Dvb/Isobornyl…`

---

## Tier 3 — Latin/binomial vs common name (same ingredient, two vocabularies)

Whether to merge is a product decision, but they are the same substance:

| Latin | Common |
|---|---|
| Butyrospermum Parkii Butter (6,661) | Shea Butter (397) |
| Cocos Nucifera Oil (3,177) | Coconut Oil (751) |
| Simmondsia Chinensis Seed Oil (4,068) | Jojoba Oil (157) |
| Olea Europaea Fruit Oil (2,120) | Olive Oil (226) |
| Aloe Barbadensis Leaf Juice (7,302) | Aloe Vera (160), Aloe Vera Juice (55) |
| Theobroma Cacao Seed Butter (2,300) | Cocoa Butter (129) |
| Persea Gratissima Oil (1,863) | Avocado Oil (194) |
| Rosa Canina Fruit Oil (720) | Rosehip Oil (57), Rose Hip Oil (15) |
| Melaleuca Alternifolia Leaf Oil (698) | Tea Tree Oil (71) |
| Camellia Sinensis Leaf Extract (3,915) | Green Tea Extract (98) |
| Helianthus Annuus Seed Oil (5,519) | Sunflower Oil (149) |
| Vitis Vinifera Seed Oil (1,379) | Grapeseed Oil (86), Grape Seed Oil (66) |
| Prunus Amygdalus Dulcis Oil (2,106) | Sweet Almond Oil (87), Almond Oil (86) |
| Argania Spinosa Kernel Oil (1,182) | Argan Oil (51) |
| Hamamelis Virginiana Water (860) | Witch Hazel (89) |
| Lavandula Angustifolia Oil (1,531) | Lavender Oil (152) |

Also note **binomial misspellings** are their own large cluster — e.g.
Simmondsia Chinensis has ~15 (`Simmondia`, `Simmonsia`, `Simondsia`,
`Simmodsia`, `Sirnmondsia`, `Simmondsia Chineses/Chinesis`); Helianthus
Annuus ~20 (`Helianthas`, `Hellanthus`, `Helanthus`, `Heliantus`,
`Helianthus Annus/Annuss/Anuus`); Aloe Barbadensis ~25 (`Barbadenis`,
`Barbadensls`, `Barbandensis`, `Barbardensis`, `Barbendensis`, `Barbensis`,
`Barradensis`, `Albe Barbadensis`).

---

## Tier 4 — Concentration/qualifier suffixes (same ingredient, N rows)

The active is identical; the percentage belongs in a different column:
- **Avobenzone** — 18 rows (`Avobenzone`, `1%`, `1.5%`, `2%`, `2.0%`,
  `2.00 %`, `3%`, `3.0 %`, `3.00%`, `-3.0 %` …)
- **Octinoxate** — 20 rows · **Octocrylene** — 33 rows ·
  **Homosalate** — 25 rows · **Octisalate** — 15 rows ·
  **Oxybenzone** — 18 rows · **Zinc Oxide** — 40 rows ·
  **Titanium Dioxide** — 25 rows · **Salicylic Acid** — 12 rows ·
  **Benzoyl Peroxide** — 10 rows · **Benzalkonium Chloride** — 8 rows ·
  **Dimethicone** — 12 rows · **Petrolatum** — 8 rows ·
  **Colloidal Oatmeal** — 5 rows · **Adapalene** — 3 rows
- Same pattern with **"Organic"/"Certified Organic"/"Cold Pressed"/"Virgin"/
  "Non-GMO"/"Fair Trade"/"Wildcrafted" prefixes** — this is enormous:
  ~800 `Organic …` rows and ~40 `Certified Organic …` rows that duplicate an
  existing plain row (e.g. `Organic Aloe Barbadensis Leaf Juice` (112) vs
  `Aloe Barbadensis Leaf Juice` (7,302); `Organic Shea Butter` (73) vs
  `Shea Butter` (397); `Organic Jojoba Oil` (101) vs `Jojoba Oil` (157)).

---

## Tier 5 — Leading punctuation artifacts

Rows beginning with `*`, `**`, `+`, `&` — footnote markers captured as part of
the name. ~150 rows at the top of the sort, e.g. `*Aqua` (17),
`*Butyrospermum Parkii Butter` (5), `*Cocos Nucifera Oil` (11),
`*Limonene` (8), `*Linalool` (6), `**Avena Sativa Bran Extract` (2),
`+Fragrance` (1). All duplicate an existing clean row.

---

## Tier 6 — Junk / non-ingredient rows (delete candidates)

Not duplicates but not ingredients either:
`May Contain` (1), `May Contain : CI 77891` (7), `May Contain : Titanium
Dioxide` (6), `And Rose Hips` (1), `And Yarrow Flowers` (2),
`And Limonene Extract` (1), `Including: Œ±-Pinene` (1),
`Forms Of CIALIS` (1, OCR of "Forms of Cialis"?),
`The Essential Oil Of Centella Asiatica Contains Many Volatile Organic
Compounds` (1), `Paba Strict Cross Reactors: Removes Ppd And Caines: Esters
From Shopping List` (2), `Containing Certified Organic Alcohol` (1),
`3-Methyl` (1), `10X` / `20X` / `3A` / `Aga` / `Sr` / `Usp` / `Stem` /
`Leaves` / `Wood` / `Palms` / `Gum-1` / `Poacecae`.

---

## Suggested order of work

1. **Tier 5 + Tier 6** — trivial, small, immediate quality win.
2. **Tier 1** — biggest ratio of impact to effort; ~30 canonical ingredients
   absorb ~400 typo rows that are each obviously wrong.
3. **Tier 2 asterisks + mojibake** — mechanical normalization.
4. **Tier 4 percentages** — needs a schema decision (strip to a
   `concentration` column, or just merge and drop the number).
5. **Tier 2 bilingual/slash** and **Tier 3 Latin↔common** — biggest volume but
   need a product decision on canonical naming before merging.

Any merge should preserve `product_count` by summing and re-pointing
`sss_product_ingredients_join` rows, then re-running the popularity counters.
