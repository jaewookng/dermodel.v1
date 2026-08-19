# Region policy review — `billing_region_policy`

**Reviewed:** 2026-08-25 · **Reviewer:** engineering research pass, non-lawyer
**Subject:** the 54 rows seeded by `supabase/migrations/20260824_billing_regions.sql` §3
**Companion migration:** `supabase/migrations/20260825_region_policy_review.sql`

---

## 0. THIS IS NOT LEGAL ADVICE

I am not a lawyer and this document is not legal advice. It is a **research
pass**: publicly available statutes, regulator guidance and court decisions,
organised per country so that a qualified lawyer can review the seeded table
efficiently instead of starting from a blank page.

Read every "should be" cell as **"what the cited source says"**, never as a
determination that the current configuration is lawful, safe, or sufficient.
Nothing here tells you that you are compliant, because nothing here can.

Three things follow from that, and they matter:

1. The companion migration sets `legal_review_status = 'researched'`, **never
   `'reviewed'`**. `'reviewed'` is a human lawyer's signature and this pass has
   no authority to write it.
2. Where I could not find a source I have written **"no source found"** and
   marked the row **low** confidence rather than filling the gap with a
   plausible-sounding guess.
3. §7 is a prioritised list of questions that genuinely need a lawyer. It is
   the most important section in this file. The per-country tables are the
   cheap part; §7 is where the money should go.

**Confidence key.** *High* = primary source (statute, regulator, court) found
and read, directly on point. *Medium* = primary source found but its
application to this specific product is a judgement call, or the best source
available was a reputable secondary summary. *Low* = thin or conflicting
sourcing; treat as a research lead only.

---

## 1. What is actually being assessed

Two distinct questions ride on this one table, and they have different answers:

| | Question | Column |
| --- | --- | --- |
| **A** | May we take this consumer's money at all? | `sell_premium` |
| **B** | May we default the check-in email ON, or must we ask first? | `marketing_default_opt_in` |

**The product facts that drive question B.** The check-in email
(`supabase/functions/bella-checkin/index.ts`, `renderEmail()`) tells a paying
subscriber that a product they logged is running low, asks a satisfaction
survey, **and lists up to three other products** under the heading *"If you're
replacing it, these share what makes it work"*.

That third element is decisive. **The task brief's premise is correct**, and
I was able to verify it against primary sources rather than assume it:

- **US.** [16 CFR § 316.3(b)](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316/section-316.3):
  where a message contains *both* transactional/relationship content and
  "the commercial advertisement or promotion of a commercial product or
  service", the primary purpose "shall be deemed to be commercial" if a
  recipient reasonably interpreting the subject line would conclude it is.
  A three-product recommendation block is promotion of a commercial product.
  → **commercial**, so the full CAN-SPAM obligations attach.
- **EU/UK.** The message is sent "for the purposes of direct marketing" within
  ePrivacy Art. 13 / PECR reg. 22 the moment it promotes products the recipient
  has not bought. The replenishment reminder alone might have been arguable;
  the recommendation block ends the argument.

So: **this is a marketing email in every regime surveyed, not a transactional
one.** Everything below proceeds on that basis. If the owner ever wants the
opposite answer, the change is to the email, not to the table — strip the
referral block and the analysis genuinely changes. That is a real option and
worth pricing.

---

## 2. Seeded correctly — agree

I agree with the **policy tier** on all 54 seeded rows. Two rows carry a
factually wrong `rationale` (§3); the tier itself is defensible everywhere.

### 2.1 `always_on` — the home market

| Code | Seeded | Sources indicate | Agree? | Conf. | Authority |
| --- | --- | --- | --- | --- | --- |
| `US` | `always_on` | Opt-out regime. Commercial email is lawful without prior consent provided the message carries a working opt-out, honours it within 10 business days, is not deceptive, and **includes the sender's valid physical postal address**. | ✅ tier — ⚠️ **implementation gap, see §5.1** | High | [15 U.S.C. §7704(a)](https://www.law.cornell.edu/uscode/text/15/7704); [FTC CAN-SPAM Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business); [16 CFR §316.3](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316/section-316.3) |

`always_on` is the right *tier* for the US. But the tier only covers "may we
default it on". CAN-SPAM's *content* obligations are not expressible in this
table and **one of them is currently unmet** — see §5.1, which is the
highest-confidence finding in this document.

### 2.2 `consent_first` — EU / EEA

All 30 rows carry the same analysis, so the sources are given once.

**Regime.** [ePrivacy Directive 2002/58/EC Art. 13(1)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32002L0058)
requires prior consent for unsolicited direct-marketing email to natural
persons. [GDPR Art. 4(11) / 7](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
set what "consent" must look like and require it to be demonstrable —
which is exactly what `email_consent_events` is for, and that design is sound.

**Nuance the owner should know (this is a "you may be stricter than you have
to be" finding, not a compliance problem).** Art. 13(2) contains the **soft
opt-in**: where the address was obtained "in the context of the sale of a
product or a service", the sender may market its own *similar* products
provided an easy free opt-out is offered at collection and in every message.
On [13 November 2025 the CJEU decided *Inteligo Media SA v ANSPDCP*
(C-654/23)](https://curia.europa.eu/juris/liste.jsf?num=C-654/23), confirming
the soft opt-in is a **standalone** ePrivacy basis needing no separate GDPR
consent. A Premium subscriber who logged a skincare product and receives
skincare recommendations is a plausible fit. **I am not recommending you rely
on it** — Art. 13(2) is transposed with real variation across member states,
`consent_first` is the safe setting, and this is precisely a lawyer question
(§7 Q3). Flagged so the option is visible rather than lost.

| Codes | Seeded | Should be | Agree? | Conf. |
| --- | --- | --- | --- | --- |
| `AT` `BE` `BG` `HR` `CY` `CZ` `DK` `EE` `FI` `FR` `DE` `GR` `HU` `IE` `IT` `LV` `LT` `LU` `MT` `NL` `PL` `PT` `RO` `SK` `SI` `ES` `SE` (EU-27) | `consent_first` | `consent_first` | ✅ | High |
| `IS` `LI` `NO` (EEA) | `consent_first` | `consent_first` — GDPR and ePrivacy are incorporated into the [EEA Agreement](https://www.efta.int/eea-lex) | ✅ | High |

⚠️ EU/EEA carries the heaviest **non-email** burden of any group — VAT from the
first euro and a 14-day withdrawal right. See §6.1 and §6.3. That is a
commercial decision about whether to sell here at all, not a tier correction.

### 2.3 `consent_first` — other opt-in regimes

| Code | Seeded | Sources indicate | Agree? | Conf. | Authority |
| --- | --- | --- | --- | --- | --- |
| `GB` | `consent_first` | Opt-in. PECR reg. 22(2); soft opt-in at reg. 22(3) exists on the same "similar products / opportunity to refuse at collection and in every message" terms as the EU. | ✅ | High | [PECR reg. 22](https://www.legislation.gov.uk/uksi/2003/2426/regulation/22); [ICO, Electronic mail marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/) |
| `CH` | `consent_first` | Opt-in for mass advertising, **but the operative statute is the Unfair Competition Act, not the FADP** — the seeded rationale names the wrong law (harmless; not worth an UPDATE, but noted). UCA Art. 3(1)(o) has a sale-context exception mirroring the EU soft opt-in. | ✅ tier | High | [UCA/UWG Art. 3(1)(o), SR 241](https://www.fedlex.admin.ch/eli/cc/1988/223_223_223/en); [BAKOM, "When is mass sending allowed?"](https://www.bakom.admin.ch/en/when-is-mass-sending-allowed) |
| `CA` | `consent_first` | Opt-in. CASL s.6 requires express or implied consent for a commercial electronic message. **Implied consent via an Existing Business Relationship** (s.10(9)(a), s.10(10)) covers a purchase within the preceding 2 years — a paying subscriber qualifies. Express consent is still cleaner because CASL puts the **burden of proving consent on the sender** (s.13). | ✅ | High | [CASL ss. 6, 10, 13](https://laws-lois.justice.gc.ca/eng/acts/E-1.6/); [CRTC Guidance on Implied Consent](https://crtc.gc.ca/eng/com500/guide.htm) |
| `AU` | `consent_first` | Opt-in. Spam Act 2003 Sch. 2 permits **inferred** consent from an existing business relationship where marketing is reasonably expected — but ACMA reads this narrowly and has been enforcing hard. | ✅ | High | [Spam Act 2003 (Cth), Sch. 2](https://www.legislation.gov.au/C2004A01214/latest/text); [ACMA](https://www.acma.gov.au/consent-send-marketing-messages) |
| `NZ` | `consent_first` | Opt-in, with an inferred-consent limb on the Australian pattern. | ✅ | Medium | [Unsolicited Electronic Messages Act 2007, ss. 9–11 & Sch.](https://www.legislation.govt.nz/act/public/2007/0007/latest/DLM405134.html) |
| `SG` | `consent_first` | Two statutes stack. PDPA's Consent Obligation governs *using* the address for marketing; the Spam Control Act governs *sending*. The SCA's own exemption is narrow (messages closely tied to an existing transaction), which the referral block defeats. | ✅ | Medium | [PDPA 2012](https://sso.agc.gov.sg/Act/PDPA2012); [Spam Control Act 2007](https://sso.agc.gov.sg/Act/SCA2007) |
| `JP` | `consent_first` | Opt-in since the 2008 amendment. **There is an express exception for a party in a business-transaction relationship** (Art. 3(1)(iii)) that a paying subscriber may well satisfy — so `consent_first` is likely stricter than required. Same posture as the EU soft opt-in: safe, flagged. | ✅ | Medium | [Act on Regulation of Transmission of Specified Electronic Mail, Art. 3 (official translation)](https://www.japaneselawtranslation.go.jp/en/laws/view/3767/en); [MIC/Dekyo guidelines (EN)](https://www.dekyo.or.jp/soudan/contents/antispam/data/en/EN_Guidelines_of_Japanese_anti-spam_law.pdf) |
| `KR` | `consent_first` | Opt-in — **and `consent_first` alone is not sufficient.** Network Act Art. 50 layers on obligations this table cannot express: `(광고)` in the subject line, a **separate additional consent for sending between 21:00 and 08:00**, and **periodic reconfirmation of consent** every 2 years. See §5.3. | ✅ tier, ⚠️ insufficient | Medium | [Act on Promotion of Information and Communications Network Utilization, Art. 50](https://elaw.klri.re.kr/eng_service/lawView.do?hseq=61859&lang=ENG); [KISA/KCC illegal-spam guide (rev. Mar 2026)](https://www.kisa.or.kr/) |
| `BR` | `consent_first` | LGPD Art. 7 permits processing on consent *or* legitimate interest, so LGPD alone is **not** clearly an opt-in mandate for email; there is no CAN-SPAM/CASL equivalent, and practice rests on the CDC plus the self-regulatory CAPEM code. `consent_first` is defensible as conservative, but the seeded rationale ("LGPD.") overstates how settled this is. | ✅ tier | **Low** | [LGPD Lei 13.709/2018 Art. 7](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) — *no source found* for a Brazilian statutory opt-in email mandate |
| `IN` | `consent_first` | DPDP Act 2023 is consent-based for processing personal data. Email marketing specifically is thinner than the seeded rationale implies. The **operational** flag in the rationale is the more important half — see §5.4. | ✅ tier | Medium | [DPDP Act 2023](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf) |
| `ZA` | `consent_first` | Opt-in, and **stricter than most**: POPIA s.69 permits direct marketing by electronic communication to a non-customer *only* with prior consent and *only one* consent request ever. Existing customers get a narrower s.69(3) carve-out for similar products with an opt-out at collection. | ✅ | High | [POPIA Act 4 of 2013, s.69](https://www.gov.za/sites/default/files/gcis_document/201409/3706726-11act4of2013protectionofpersonalinforcorrect.pdf) |
| `MX` | `consent_first` | Opt-in tier is fine. **The seeded rationale cites a repealed statute** — see §3.2. | ✅ tier, ❌ rationale | High | [New LFPPDPPP, DOF 20-03-2025](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf) |
| `ZZ` | `consent_first` | Correct and well-reasoned. Sell to someone we cannot geolocate; never default their email on. The asymmetry argument in §9.2 of `payment-model.md` is right. | ✅ | High | n/a (design choice) |

### 2.4 `avoid`

| Code | Seeded | Sources indicate | Agree? | Conf. | Authority |
| --- | --- | --- | --- | --- | --- |
| `CU` | `avoid` | Comprehensive embargo. Provision of services to persons in Cuba is broadly prohibited absent authorisation. | ✅ | High | [31 CFR Part 515 (CACR)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-V/part-515) |
| `IR` | `avoid` | Comprehensive. Note there *is* a general licence (ITSR §560.540) for certain personal communications software/services, but relying on it for a paid consumer subscription is a lawyer question, not an engineering one. `avoid` is correct. | ✅ | High | [31 CFR Part 560 (ITSR)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-V/part-560) |
| `KP` | `avoid` | Comprehensive; transactions require specific licence. | ✅ | High | [31 CFR Part 510 (NKSR)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-V/part-510) |
| `SY` | `avoid` | **Tier still right, rationale now false.** See §3.1. | ✅ tier, ❌ rationale | High | [OFAC final rule removing 31 CFR Part 542, 90 FR (26 Aug 2025)](https://www.federalregister.gov/documents/2025/08/26/2025-16324/syrian-sanctions-regulations); [E.O. 14312 (30 Jun 2025)](https://www.federalregister.gov/documents/2025/07/07/2025-12680/providing-for-the-revocation-of-syria-sanctions) |
| `RU` | `avoid` | Not a comprehensive US embargo, but there are **service-specific prohibitions squarely covering software/IT services to persons in Russia** on both sides of the Atlantic, plus unusable card rails. `avoid` is well-founded. | ✅ | High | [EU Reg. 833/2014 Art. 5n](https://eur-lex.europa.eu/eli/reg/2014/833/oj); [OFAC determination on IT & software services, 12 Sep 2024](https://ofac.treasury.gov/recent-actions/20240912) |
| `BY` | `avoid` | Targeted, not comprehensive; broad EU/US measures and unreliable rails. A defensible **business** call. | ✅ | Medium | [31 CFR Part 548](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-V/part-548) |
| `AF` | `avoid` | No comprehensive country embargo; risk is Taliban/HQN SDN exposure plus non-functioning rails. Business call. | ✅ | Medium | [OFAC Afghanistan program](https://ofac.treasury.gov/sanctions-programs-and-country-information/afghanistan-related-sanctions) |
| `MM` | `avoid` | Targeted (Burma sanctions, E.O. 14014). Business call. | ✅ | Medium | [31 CFR Part 525](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-V/part-525) |
| `VE` | `avoid` | Targeted (government/PdVSA-focused), not a consumer embargo. Conservative business call. | ✅ | Medium | [31 CFR Part 591](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-V/part-591) |
| `SD` | `avoid` | The comprehensive Sudan program was **revoked in 2017**; current measures are targeted. `avoid` today rests on conflict conditions and rails, not on an embargo. Business call. | ✅ | Medium | [OFAC Sudan program](https://ofac.treasury.gov/sanctions-programs-and-country-information/sudan-program) |

**A framing point worth internalising.** Only `CU`, `IR` and `KP` are *legally
compelled* `avoid` rows. The other seven are commercial risk decisions wearing
a compliance costume. That is fine — but the `rationale` column should say
which is which, or a future reader will treat a business preference as a legal
constraint and be afraid to change it.

---

## 3. Seeded wrongly — recommend change

No **tier** changes are recommended for seeded rows. Two rows have a
`rationale` that is factually false as of today, and a rationale that lies to
the next reader is a real defect in a table whose whole purpose is to make the
reasoning inspectable.

### 3.1 `SY` — the rationale is out of date

> Seeded: `'US comprehensive sanctions program.'`

**That is no longer true.** [E.O. 14312](https://www.federalregister.gov/documents/2025/07/07/2025-12680/providing-for-the-revocation-of-syria-sanctions)
(30 June 2025) revoked the six executive orders underpinning the Syria program
and terminated the underlying national emergency; OFAC then
[removed the Syrian Sanctions Regulations, 31 CFR Part 542, from the CFR
effective 26 August 2025](https://www.federalregister.gov/documents/2025/08/26/2025-16324/syrian-sanctions-regulations).

**Keep `avoid`.** Caesar Act statutory provisions, Commerce/BIS export controls
and individual SDN designations survive the revocation, and payment rails to
Syria remain impractical. But the row must stop claiming a comprehensive
program that has been formally terminated — otherwise nobody will ever revisit
it, and the reason it says `avoid` today is genuinely different from the reason
it said `avoid` in 2024. **Confidence: high** on the facts, **medium** on the
policy call.

⚠️ Note for the reader: several widely-cited "OFAC sanctioned countries 2026"
listicles still name Syria as comprehensively embargoed. They are stale. This
is exactly why the brief said to prefer primary sources — I found the
secondary sources conflicting with the Federal Register and went with the
Federal Register.

### 3.2 `MX` — the rationale cites a repealed statute

> Seeded: `'LFPDPPP.'`

The 2010 LFPDPPP was **repealed and replaced** by a new Federal Law on the
Protection of Personal Data Held by Private Parties,
[published in the DOF on 20 March 2025 and effective 21 March 2025](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf).
INAI was dissolved; enforcement moved to the Secretaría Anticorrupción y Buen
Gobierno. The consent architecture and ARCO rights largely carry over, so
**`consent_first` remains right** — only the citation is wrong.
**Confidence: high.**

### 3.3 A code comment in `20260824` is wrong (not a table row)

`20260824_billing_regions.sql` line ~613 and `payment-model.md` §9.7 both list
**Kherson and Zaporizhzhia** among sub-nationally sanctioned regions resolving
to `UA`. For **US** purposes that appears to be incorrect: the "Covered
Regions" under [E.O. 14065](https://www.federalregister.gov/documents/2022/02/23/2022-04020/blocking-property-of-certain-persons-and-prohibiting-certain-transactions-with-respect-to-continued)
are the so-called DNR and LNR, plus Crimea under
[E.O. 13685](https://www.federalregister.gov/documents/2014/12/24/2014-30323/blocking-property-of-certain-persons-and-prohibiting-certain-transactions-with-respect-to-the-crimea);
Kherson and Zaporizhzhia are covered by **EU** restrictive measures, not by a
US Covered-Region determination. **I am not editing those files** (hard
constraint), and the practical conclusion is unchanged. **Confidence: medium** —
the Secretary of the Treasury may extend Covered Regions by determination, so
this needs a fresh check at review time rather than trust in this sentence.

---

## 4. Missing and should be added

| Code | Recommend | Why | Conf. |
| --- | --- | --- | --- |
| `UA` | **`avoid`** (interim) | Sub-national sanctions gap — see §5.2. Today `UA` is unseeded, falls through to `ZZ`, and **sells**. Crimea, DNR and LNR are US Covered Regions and all resolve to `UA`. `avoid` is the only setting this schema can express that certainly does not sell into a Covered Region. **It over-blocks ~35M people in unoccupied Ukraine, and that cost is real** — reversing it is one `UPDATE`, and §5.2 describes the schema change that would let you sell to Kyiv without selling to Sevastopol. | Medium |
| `IL` | `consent_first` | Communications Law (Bezeq and Broadcasts) 5742-1982 **s.30A** is an express opt-in regime for advertising by email/SMS/fax, with statutory damages that have driven a substantial class-action practice. Behaviourally identical to today's `ZZ` fallthrough — the value is that the row makes the reasoning explicit instead of accidental. [Israeli MoJ / s.30A](https://www.nevo.co.il/law_html/law01/055_001.htm) | Medium |
| `TR` | `consent_first` **and flag** | Law No. 6563 on the Regulation of Electronic Commerce requires prior consent for commercial electronic messages **and** requires senders to register consents with **İYS**, a centralised government message-management system, and to query it before each send. Whether that binds a non-resident service provider is genuinely unresolved in the sources I found. If it does, TR is operationally an `avoid`. [Law 6563](https://www.mevzuat.gov.tr/mevzuatmetin/1.5.6563.pdf) | **Low** |

**Everywhere else on Earth** currently falls through to `ZZ` → sells,
`consent_first`. That is a deliberate and, in my reading, sensible default:
strict on email, permissive on selling. But it does mean the table's silence is
a decision, and the countries that most deserve an explicit row are the ones in
§4 above plus any the lawyer adds in §7.

---

## 5. Structural findings — the parts a country-code table cannot hold

These are the findings that matter more than any individual row.

### 5.1 ⚠️ HIGHEST CONFIDENCE FINDING: the check-in email has no postal address

[15 U.S.C. §7704(a)(5)(A)(iii)](https://www.law.cornell.edu/uscode/text/15/7704)
requires every **commercial** email to include "a valid physical postal address
of the sender". Per §1, the check-in email is commercial in the US because of
the referral block.

`renderEmail()` in `supabase/functions/bella-checkin/index.ts` produces a
greeting, the low-stock notice, a survey CTA, the referral list, an estimate
disclaimer, and an unsubscribe link. **There is no postal address anywhere in
it.** The unsubscribe mechanism is present and looks fine; the address is
simply absent.

This is not a region-table problem — `always_on` for `US` is the correct tier
and the table has no column that could express "must carry a postal address".
It is a template problem, in the **home market**, on the **default-on** path,
which is the highest-volume send this product will ever make.
**Confidence: high.** *(Out of scope to fix here — the brief forbids touching
anything outside `docs/` and the one migration — but it should be the first
thing fixed after this review.)*

Two smaller adjacent notes from the same file:
- The `List-Unsubscribe` header is `mailto:`-only. Gmail and Yahoo bulk-sender
  requirements expect **one-click** (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`)
  with an HTTPS URL. Deliverability, not law — but a check-in product that
  lands in spam is worth nothing.
- Sending from `bella@dermodel.app` while the unsubscribe header points at
  `unsubscribe@dermodel.app` means that mailbox must actually exist and be
  processed. CAN-SPAM requires opt-outs be honoured within 10 business days
  regardless of which channel they arrive on.

### 5.2 ⚠️ The sub-national sanctions problem — what it actually means

**The design cannot express the obligation.** `billing_region_policy` is keyed
`country_code CHAR(2)`. Comprehensive US sanctions apply to *territories*:
Crimea ([E.O. 13685](https://www.federalregister.gov/documents/2014/12/24/2014-30323/blocking-property-of-certain-persons-and-prohibiting-certain-transactions-with-respect-to-the-crimea))
and the DNR/LNR Covered Regions
([E.O. 14065](https://www.federalregister.gov/documents/2022/02/23/2022-04020/blocking-property-of-certain-persons-and-prohibiting-certain-transactions-with-respect-to-continued)).
All of them are `UA` in ISO 3166-1 alpha-2. There is **no value** of
`billing_region_policy.country_code` that distinguishes Kyiv from Sevastopol.

Say the consequence plainly: **the table can be either wrong about Sevastopol
or wrong about Kyiv, and it cannot be right about both.** Today it is wrong
about Sevastopol — `UA` is unseeded, resolves via `ZZ`, and sells.

The current mitigation on record is "Stripe's own screening is the backstop."
That is a real control and not nothing, but note what it means: **the residual
risk has been transferred to a third party's screening, without a written
confirmation of what that screening covers.** That is a question for Stripe,
not for a lawyer (§7 Q7).

**What I recommend, in order:**

1. **Now (in the companion migration).** Seed `UA` = `avoid`. It over-blocks,
   the cost is visible and reversible with one `UPDATE`, and it is the only
   thing this schema can say that is certainly not wrong in the direction that
   carries strict-liability exposure.
2. **Next (schema, out of scope here).** Add a subdivision layer — a
   `billing_region_subdivision_policy` table keyed on **ISO 3166-2**
   (`UA-43` Crimea, `UA-40` Sevastopol, `UA-14` Donetsk, `UA-09` Luhansk), with
   the resolver reading `country || '-' || subdivision` first and falling back
   to the country row. Stripe's Checkout billing address already carries
   `address.state` and `address.city`, so `set_billing_country()` gains a
   sibling `set_billing_subdivision()`. Once that exists, `UA` moves back to
   `consent_first` and only the occupied oblasts stay blocked. **This is the
   actual fix.** Everything else is choosing which way to be wrong.
3. **Also.** Note that a subdivision layer is not Ukraine-specific. It is the
   same mechanism California's auto-renewal law needs (§6.2) and the same one
   US state sales-tax nexus needs. Building it once pays three times.
4. **Recurring.** Sanctions lists change — Syria (§3.1) moved *within the life
   of this file*. Put a calendar reminder on re-reading the `avoid` rows, and
   treat `legal_review_status` + `reviewed_at` as the staleness signal they
   were designed to be.

### 5.3 South Korea needs constraints the schema has no column for

Network Act Art. 50 imposes, beyond prior consent: `(광고)` in the subject
line; a **separate** consent to send between **21:00 and 08:00 KST**; and
**reconfirmation of consent every two years**, after which consent lapses.

`consent_first` gets you the first consent and nothing else. `bella-checkin`
sends on a cron with no timezone awareness and `email_consent_events` has no
expiry concept — a Korean consent recorded today would silently remain "valid"
in this system forever. **Confidence: medium** (the 2-year reconfirmation and
night-time rules are well attested in KISA/KCC guidance; I could not read the
Korean statutory text directly). If Korea is not a target market, the cheapest
correct answer may be to move `KR` to `avoid` rather than build reconsent
expiry. That is a product decision — I have **not** made it in the migration.

### 5.4 India: the operational flag in the seeded rationale is the real issue

The seeded rationale already says RBI e-mandate rules make recurring cards
painful. That has since been consolidated: the RBI issued a **Digital
Payments – E-mandate Framework, 2026** on 21 April 2026, covering domestic
*and cross-border* recurring transactions, requiring additional-factor
authentication at registration and on the first debit, and a pre-debit
notification at least 24 hours before each charge. For a solo operator on raw
Stripe this is a meaningful integration, not a checkbox. **Confidence: medium**
(secondary sources; the RBI circular itself should be read before acting).
`IN` stays `consent_first` — this is a business call, one `UPDATE` either way.

---

## 6. Obligations that attach regardless of what this table says

### 6.1 Consumption tax — likely the largest unpriced exposure

| Jurisdiction | Threshold for a non-resident B2C digital seller | Source |
| --- | --- | --- |
| **EU (27)** | **None. VAT is due from the first euro**, via non-Union OSS (single registration, one quarterly return, destination rates 17–27%). | [EU VAT rules for e-services](https://taxation-customs.ec.europa.eu/vat-e-commerce_en) |
| **UK** | **Nil threshold for non-established businesses** — UK VAT registration from the first sale. | [HMRC VAT Notice 700/1, §2](https://www.gov.uk/guidance/who-should-register-for-vat-notice-7001) |
| **Australia** | A$75,000 annual turnover | [ATO, GST on imported services and digital products](https://www.ato.gov.au/businesses-and-organisations/international-tax-for-business/gst-for-non-resident-businesses/gst-on-imported-services-and-digital-products) |
| **New Zealand** | NZ$60,000 | [IRD, GST on remote services](https://www.ird.govt.nz/gst/gst-for-overseas-business) |
| **Singapore** | S$1M global turnover **and** S$100k of Singapore B2C supplies — both must be met | [IRAS, Overseas Vendor Registration](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-and-digital-economy/overseas-businesses) |
| **South Africa** | ZAR 1M / 12 months | [SARS, electronic services](https://www.sars.gov.za/types-of-tax/value-added-tax/vat-on-electronic-services/) |
| **Canada** | CAD 30,000 / 12 months (simplified GST/HST) | [CRA, simplified GST/HST for digital economy](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/digital-economy-gsthst.html) |
| **Norway, Switzerland, Japan, South Korea, India, Brazil, Mexico** | Registration triggers vary from nil to a local turnover test | *Not individually verified in this pass — **low confidence**, flagged for the lawyer/accountant* |

**Read the EU and UK rows again.** They are the ones with teeth: a single
€8.99 subscription to a German consumer creates a VAT obligation from that
sale. It does not wait for a threshold. Neither does the UK for a
non-established seller.

**Where a merchant of record changes the picture.** Stripe (as used here) is a
payment processor: **you** are the seller of record and **you** carry the VAT
registration, collection, rate determination, filing and evidence-retention
duties. Stripe Tax calculates; it does not assume the liability. A **merchant
of record** — Paddle, Lemon Squeezy, FastSpring — contracts with the consumer
as the seller and takes on the VAT/GST registration and remittance across all
of the above, plus in most cases the consumer-contract and auto-renewal
disclosure obligations. The cost is roughly 5% + fixed vs Stripe's ~2.9% + 30¢.

For a solo-operator product at $8.99/mo, **the MoR question is probably the
single highest-leverage commercial decision in this whole review**, and it is
what determines whether the EU is worth selling to at all. `payment-model.md`
§10 already flags Stripe-vs-MoR as an open decision; this review is the
argument for resolving it before, not after, the first EU sale.

### 6.2 Auto-renewal and distance selling

| Where | Obligation | Bites on this product? | Source |
| --- | --- | --- | --- |
| **EU/EEA** | 14-day right of withdrawal from conclusion of a distance contract. **Art. 16(m) waiver requires three cumulative things**: prior express consent to begin performance, an explicit acknowledgement of losing the withdrawal right, and confirmation on a durable medium. [C-641/19 *PE Digital*](https://curia.europa.eu/juris/liste.jsf?num=C-641/19) says construe it strictly. | **Yes.** Stripe Checkout's default flow does **not** collect that acknowledgement. Without it, an EU subscriber can withdraw within 14 days. | [CRD 2011/83/EU Arts. 9, 16(m)](https://eur-lex.europa.eu/eli/dir/2011/83/oj) |
| **UK** | Equivalent 14-day right today. The **DMCCA 2024 subscription-contracts regime** adds pre-contract information, reminder notices before each renewal, easy exit and a **new 14-day renewal cooling-off period** — [commencement has slipped to Spring 2027](https://www.legislation.gov.uk/uksi/2026/284/made). | Not yet, but dated and coming. | [DMCCA 2024 Part 4 Ch. 2](https://www.legislation.gov.uk/ukpga/2024/13/part/4/chapter/2) |
| **California** | ARL as amended by **AB 2863, in force 1 July 2025**: express affirmative consent to the renewal terms, retained **3 years**; cost and frequency disclosed before billing info is confirmed; **cancellation by the same medium used to sign up**; renewal reminders. | **Yes — today, in the home market.** | [AB 2863](https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB2863); [Cal. Bus. & Prof. Code §17602](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=17602&lawCode=BPC) |
| **US federal** | The FTC's "click-to-cancel" Negative Option Rule was **vacated in full** by the Eighth Circuit on 8 July 2025 on procedural grounds. The FTC began a fresh ANPRM in January 2026. **Do not assume this stays vacated**, and note §5 FTC Act deception authority and the 1973 ROSCA/negative-option rule survive it. | Watch item. | [*Custom Communications v. FTC*, 8th Cir. No. 24-3137 (2025)](https://ecf.ca8.uscourts.gov/opndir/25/07/243137P.pdf) |
| **NY, VA, CO, IL, and others** | State auto-renewal statutes with their own notice and cancellation rules. Not surveyed. | Likely. | *no source found in this pass — **low confidence*** |

**The pattern to notice:** California's ARL binds this product **today**, in
the `always_on` home market, and `billing_region_policy` cannot express it —
it is sub-national, exactly like §5.2. Two of the four most concrete
obligations in this review are invisible to a country-code table.

### 6.3 Design question: is billing-address-first the right ordering?

The brief asks specifically. My reading, obligation by obligation:

| Obligation | Attaches to | Is `billing > declared` right? |
| --- | --- | --- |
| **Sanctions** | Where the person and the transaction actually are. A billing address is self-asserted and trivially falsified. | **Partly.** Billing address is better than a geo header but is *not* an authoritative sanctions control, and treating it as "authoritative" in the code comments risks reading as more assurance than it provides. The `avoid`-from-either-source rule is the genuinely good part of this design and is doing the real work. |
| **Marketing consent** | The **recipient's actual residence / where the terminal equipment is** — ePrivacy and PECR are not billing-address rules. | **No, and it does not matter**, because the AND-ratchet already resolves it the strict way. Defaulting email on based on a US billing address for someone resident in Germany would be wrong; the AND prevents it. Keep the ratchet — it is load-bearing, not belt-and-braces. |
| **VAT / GST place of supply** | Statutory presumptions and **two pieces of non-contradictory evidence** (billing address, IP, bank/card country, SIM). One self-declared address alone is not sufficient in the EU. | **Right source, insufficient evidence.** [Council Implementing Reg. 282/2011 Arts. 24b, 24f](https://eur-lex.europa.eu/eli/reg_impl/2011/282/oj) is the rule; Stripe Tax collects a second signal, but you must retain the evidence for the statutory period. |
| **Consumer / withdrawal / auto-renewal** | Where the consumer is **habitually resident** — [Rome I Art. 6](https://eur-lex.europa.eu/eli/reg/2008/593/oj) gives a consumer the mandatory protections of their habitual residence, and a term choosing another law cannot take those away. | **Weakest fit.** These attach to residence, not to a typed billing address, and a wrong answer is not curable after the fact. |

**Net.** The ordering is defensible and the two disagreement rules (avoid-wins,
AND-ratchet) are the strongest part of the whole design — they are what makes a
wrong signal fail safe. Two gaps worth naming: (a) `billing_country` is
described as "authoritative" in several comments, and for *sanctions* it is
authoritative-ish at best; (b) nothing retains the **two** non-contradictory
pieces of location evidence VAT requires, so a later audit has a billing
address and nothing to corroborate it. Neither is a table row; both are §7
questions.

---

## 7. Prioritised questions that need a lawyer

Ordered by expected cost of being wrong × likelihood of being wrong.

1. **Is the check-in email a "commercial" message, and does the current
   template meet CAN-SPAM's content requirements?** (§1, §5.1) — I believe the
   answer is yes-commercial and no-not-compliant, on a missing physical postal
   address. This is the highest-confidence defect found. *Cheapest to fix,
   highest certainty: fix it before asking.*
2. **Sub-national sanctions: what does Stripe's screening actually cover, and
   is `UA` = `avoid` the right interim posture?** (§5.2) — strict-liability
   exposure, structurally unrepresentable in the current schema. Needs both a
   lawyer's view and a written answer from Stripe.
3. **Can the check-in email rely on the EU/UK soft opt-in** (ePrivacy 13(2) /
   PECR 22(3)), given *Inteligo Media* C-654/23, and does the referral block
   defeat "similar products or services"? (§2.2) — a yes materially improves
   the product for the largest consent_first bloc; a no costs nothing because
   `consent_first` is already the setting.
4. **Merchant of record vs. Stripe** (§6.1) — EU VAT from the first euro and a
   nil UK threshold. This is the decision that determines whether selling
   outside the US is viable at all for a solo operator. Accountant as much as
   lawyer.
5. **California ARL compliance for the existing $8.99 / 6-month / annual
   plans** (§6.2) — binds **today**, in the home market, and the statute
   prescribes cancellation UX. Includes the 3-year consent-retention duty.
6. **EU 14-day withdrawal right and the Art. 16(m) waiver** (§6.2) — does the
   Stripe Checkout flow collect the express acknowledgement, and does the
   confirmation email satisfy Art. 8(7)? Construed strictly per *PE Digital*.
7. **Korea: are the `(광고)` label, 21:00–08:00 restriction and 2-year
   reconsent in scope, or should `KR` simply move to `avoid`?** (§5.3) — the
   schema cannot express any of the three.
8. **VAT place-of-supply evidence** — are we retaining the two
   non-contradictory items Art. 24b/24f requires, for the statutory period?
   (§6.3)
9. **Türkiye İYS**: does the central consent registry bind a non-resident
   service provider? If yes, `TR` is operationally `avoid`. (§4) — **lowest
   confidence item in this review.**
10. **Brazil** — is `consent_first` actually mandated, or is it just prudent?
    I found **no source** for a Brazilian statutory opt-in email mandate.
    (§2.3) Low stakes either way; listed for completeness rather than urgency.

---

## 8. What the companion migration does

`supabase/migrations/20260825_region_policy_review.sql` contains only `UPDATE`
and `INSERT` against `billing_region_policy`. It:

- rewrites the `SY` rationale to the post-E.O.-14312 position, keeping `avoid`;
- rewrites the `MX` rationale to cite the 2025 LFPPDPPP, keeping `consent_first`;
- clarifies the `RU`, `BY`, `AF`, `MM`, `VE`, `SD` rationales to distinguish
  legal compulsion from business judgement, keeping `avoid`;
- adds `UA` (`avoid`, interim, per §5.2), `IL` and `TR` (`consent_first`);
- annotates `US` and `KR` with the obligations the tier does not cover;
- sets `legal_review_status = 'researched'` on every row this pass examined.

Every statement is idempotent, and **no statement will overwrite a row a human
has already marked `'reviewed'`** — once a lawyer signs a row off, re-running
this migration is a no-op against it. `'researched'` means "a non-lawyer read
the sources and wrote them down". It is not `'reviewed'` and must not be
promoted to it by anyone but counsel.

**Verified** (throwaway Postgres 15 container, 2026-08-25, against the exact
`billing_region_policy` DDL and the 54-row seed extracted from `20260824`):
✅ applies clean · ✅ 3 consecutive runs produce a byte-identical table (the
appending `rationale || …` statements carry a re-append guard, without which
they duplicated their note on every run — caught in test, fixed) · ✅ 54 → 57
rows, all `'researched'`, none `'reviewed'`, `reviewed_at` left NULL
throughout · ✅ rows manually flipped to `'reviewed'` with different values
survive a re-run untouched, including on the `INSERT … ON CONFLICT` path for
`UA`/`IL`/`TR` · ✅ the `billing_region_policy_coherent` CHECK is satisfied by
every statement. **Nothing was written to any real database.**
