-- Region policy: research pass over the rows seeded by 20260824_billing_regions.sql.
--
-- ⚠️ NOT LEGAL ADVICE. Written by a non-lawyer from public sources. The full
-- write-up, with a citation and a confidence level for every statement below,
-- is docs/region-policy-review.md. Read that file before acting on this one.
--
-- WHAT THIS FILE IS ALLOWED TO SAY
-- --------------------------------
-- Every row this pass examined gets legal_review_status = 'researched', which
-- means exactly: "a non-lawyer read the primary sources and wrote down what
-- they say". It is NOT 'reviewed'. 'reviewed' is counsel's signature and
-- nothing in this file may write it.
--
-- IDEMPOTENCY AND THE 'reviewed' GUARD
-- ------------------------------------
-- Every statement is re-runnable. Every statement additionally carries
--
--     AND legal_review_status <> 'reviewed'
--
-- so that once a lawyer has signed a row off, re-running this migration is a
-- no-op against that row and cannot stomp their conclusion with research
-- notes. That guard is the point; do not remove it.
--
-- SCOPE
-- -----
-- UPDATE and INSERT against billing_region_policy only. No schema changes, no
-- function changes, no other table. The two structural problems this review
-- found -- sub-national sanctions (Crimea/DNR/LNR all resolve to 'UA') and
-- sub-national consumer law (the California ARL) -- CANNOT be fixed here,
-- because a CHAR(2) country code cannot express either. See section 5.2 of
-- docs/region-policy-review.md for the proposed ISO 3166-2 subdivision layer,
-- which is the actual fix and is out of scope for this file.
--
-- NOTE ON THE COHERENCE CHECK
-- ---------------------------
-- billing_region_policy_coherent ties policy / sell_premium /
-- marketing_default_opt_in together. Every statement below sets all three
-- consistently even where only the rationale is changing, so a partially
-- applied edit cannot leave an incoherent row.


-- ===========================================================================
-- 1. Corrections: the tier is right, the stated reason is factually wrong
-- ===========================================================================

-- --- SY: the comprehensive Syria program no longer exists ------------------
-- The seeded rationale reads 'US comprehensive sanctions program.' That was
-- true when it was written and is not true now:
--
--   E.O. 14312 (30 Jun 2025) revoked the six executive orders underpinning the
--   Syria program and terminated the underlying national emergency.
--   https://www.federalregister.gov/documents/2025/07/07/2025-12680/providing-for-the-revocation-of-syria-sanctions
--
--   OFAC then removed the Syrian Sanctions Regulations, 31 CFR Part 542, from
--   the CFR effective 26 Aug 2025.
--   https://www.federalregister.gov/documents/2025/08/26/2025-16324/syrian-sanctions-regulations
--
-- ⚠️ Many "OFAC sanctioned countries 2026" listicles still show Syria as
-- comprehensively embargoed. They are stale. The Federal Register is not.
--
-- Tier stays 'avoid' -- Caesar Act statutory provisions, BIS export controls
-- and individual SDN designations survive the revocation, and payment rails
-- to Syria remain impractical. What changes is that the row now states the
-- CURRENT reason, so the next reader re-evaluates the right question.
-- Confidence: high on the facts, medium on the policy call.
UPDATE billing_region_policy SET
  policy                   = 'avoid',
  sell_premium             = false,
  marketing_default_opt_in = false,
  rationale = 'Business/risk call, NOT a comprehensive embargo. E.O. 14312 '
              '(2025-06-30) revoked the Syria sanctions EOs and OFAC removed '
              '31 CFR Part 542 effective 2025-08-26, so the comprehensive '
              'program cited by the original seed no longer exists. Retained '
              'as avoid for: surviving Caesar Act statutory provisions, BIS '
              'export controls, individual SDN designations, and impractical '
              'consumer payment rails. Revisit -- this changed once already.',
  legal_review_status = 'researched'
WHERE country_code = 'SY' AND legal_review_status <> 'reviewed';

-- --- MX: the cited statute was repealed ------------------------------------
-- Seeded rationale: 'LFPDPPP.' The 2010 LFPDPPP was repealed and replaced by
-- a new Federal Law on the Protection of Personal Data Held by Private
-- Parties, published in the DOF 2025-03-20, effective 2025-03-21. INAI was
-- dissolved; enforcement moved to the Secretaria Anticorrupcion y Buen
-- Gobierno. https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf
--
-- Consent architecture and ARCO rights carry over, so consent_first is
-- unchanged and correct. Only the citation was wrong. Confidence: high.
UPDATE billing_region_policy SET
  policy                   = 'consent_first',
  sell_premium             = true,
  marketing_default_opt_in = false,
  rationale = 'New Ley Federal de Proteccion de Datos Personales en Posesion '
              'de los Particulares (DOF 2025-03-20, in force 2025-03-21), '
              'which REPEALED the 2010 LFPDPPP named in the original seed. '
              'Consent-based; ARCO rights retained; enforcement moved from '
              'INAI (dissolved) to the Secretaria Anticorrupcion y Buen '
              'Gobierno.',
  legal_review_status = 'researched'
WHERE country_code = 'MX' AND legal_review_status <> 'reviewed';


-- ===========================================================================
-- 2. Clarifications: separating legal compulsion from business judgement
-- ===========================================================================
-- Of the ten seeded 'avoid' rows, only CU, IR and KP are legally compelled by
-- a comprehensive US embargo. The other seven are commercial risk decisions.
-- Both are legitimate reasons to refuse to sell -- but a row that dresses a
-- business preference as a legal constraint will never be revisited, because
-- the next reader will be afraid to touch it. The tier does not move on any
-- row in this section; only the honesty of the rationale.

-- CU / IR / KP: genuinely comprehensive. Confidence: high.
--   31 CFR 515 (Cuba)  https://www.ecfr.gov/current/title-31/subtitle-B/chapter-V/part-515
--   31 CFR 560 (Iran)  https://www.ecfr.gov/current/title-31/subtitle-B/chapter-V/part-560
--   31 CFR 510 (DPRK)  https://www.ecfr.gov/current/title-31/subtitle-B/chapter-V/part-510
-- Note on IR: ITSR 560.540 is a general licence covering certain personal
-- communications services. Whether a paid consumer subscription fits inside
-- it is a lawyer question, not an engineering one. Do not rely on it.
UPDATE billing_region_policy SET
  policy = 'avoid', sell_premium = false, marketing_default_opt_in = false,
  rationale = rationale || ' [2026-08-25 research: CONFIRMED comprehensive '
              'embargo -- 31 CFR 515 (CU) / 560 (IR) / 510 (KP). This row is '
              'legally compelled, not a business preference. For IR, do not '
              'rely on the ITSR 560.540 personal-communications general '
              'licence without counsel.]',
  legal_review_status = 'researched'
WHERE country_code IN ('CU','IR','KP')
  AND legal_review_status <> 'reviewed'
  -- Re-append guard: `rationale || ...` is only idempotent if it cannot run twice.
  AND rationale NOT LIKE '%2026-08-25 research%';

-- RU: not a comprehensive embargo, but service-specific prohibitions cover
-- software/IT services to persons in Russia on both sides of the Atlantic.
--   EU Reg. 833/2014 Art. 5n   https://eur-lex.europa.eu/eli/reg/2014/833/oj
--   OFAC IT/software services determination, 2024-09-12
--   https://ofac.treasury.gov/recent-actions/20240912
-- This is the best-founded of the seven non-comprehensive rows. Confidence: high.
UPDATE billing_region_policy SET
  policy = 'avoid', sell_premium = false, marketing_default_opt_in = false,
  rationale = 'Not a comprehensive US embargo, but service-specific '
              'prohibitions on supplying software/IT services to persons in '
              'Russia apply on both sides: EU Reg. 833/2014 Art. 5n and the '
              'OFAC IT-and-software-services determination of 2024-09-12. '
              'Consumer card rails are also unusable. Well-founded avoid.',
  legal_review_status = 'researched'
WHERE country_code = 'RU' AND legal_review_status <> 'reviewed';

-- BY / AF / MM / VE / SD: targeted programs, not consumer embargoes.
-- Keeping them at 'avoid' is defensible; it is a BUSINESS call.
--   BY 31 CFR 548 · AF (Taliban/HQN SDN exposure, no country embargo)
--   MM 31 CFR 525 (E.O. 14014) · VE 31 CFR 591 (government/PdVSA-focused)
--   SD -- the comprehensive Sudan program was REVOKED in 2017; current
--         measures are targeted. Today's avoid rests on conflict conditions
--         and payment rails, not on an embargo.
-- Confidence: medium (the legal characterisation is high; the business call
-- is the owner's and is not mine to make).
UPDATE billing_region_policy SET
  policy = 'avoid', sell_premium = false, marketing_default_opt_in = false,
  rationale = rationale || ' [2026-08-25 research: TARGETED sanctions only -- '
              'there is no comprehensive consumer embargo for this country '
              '(and for SD the comprehensive program was revoked in 2017). '
              'Retaining avoid is a defensible BUSINESS decision on rails and '
              'risk appetite, not a legal requirement. Reversible with one '
              'UPDATE if the owner decides otherwise.]',
  legal_review_status = 'researched'
WHERE country_code IN ('BY','AF','MM','VE','SD')
  AND legal_review_status <> 'reviewed'
  -- Re-append guard, as above.
  AND rationale NOT LIKE '%2026-08-25 research%';


-- ===========================================================================
-- 3. New rows
-- ===========================================================================

-- --- UA: the sub-national sanctions gap, made visible ----------------------
-- ⚠️ THIS IS THE MOST IMPORTANT ROW IN THIS FILE, AND IT IS A COMPROMISE.
--
-- Comprehensive US sanctions apply to TERRITORIES, not countries:
--   Crimea    E.O. 13685  https://www.federalregister.gov/documents/2014/12/24/2014-30323/blocking-property-of-certain-persons-and-prohibiting-certain-transactions-with-respect-to-the-crimea
--   DNR/LNR   E.O. 14065  https://www.federalregister.gov/documents/2022/02/23/2022-04020/blocking-property-of-certain-persons-and-prohibiting-certain-transactions-with-respect-to-continued
--
-- Every one of them is 'UA' in ISO 3166-1 alpha-2. There is NO value of
-- country_code that distinguishes Kyiv from Sevastopol. This table can be
-- wrong about Sevastopol or wrong about Kyiv; it cannot be right about both.
--
-- Today UA is unseeded, falls through to the 'ZZ' fallback, and SELLS -- i.e.
-- it is currently wrong in the direction that carries strict-liability
-- exposure. This row flips that to the other error.
--
-- ⚠️ STATE THE COST PLAINLY: this over-blocks roughly 35 million people in
-- unoccupied Ukraine. That is a real cost, not a rounding error, and it is
-- the owner's call to accept or reverse. Reversing is one UPDATE.
--
-- THE ACTUAL FIX (out of scope here -- needs a schema change):
--   1. Add billing_region_subdivision_policy keyed on ISO 3166-2
--      (UA-43 Crimea, UA-40 Sevastopol, UA-14 Donetsk, UA-09 Luhansk).
--   2. Have the resolver try country||'-'||subdivision first, then the
--      country row.
--   3. Add set_billing_subdivision() alongside set_billing_country(); Stripe
--      Checkout already collects address.state and address.city.
--   4. Then move UA back to consent_first -- only the occupied oblasts stay
--      blocked, and Kyiv can buy.
-- The same subdivision layer is what the California ARL (section 6.2 of the
-- review) and US state sales-tax nexus need. Build it once, it pays three
-- times.
--
-- Correction to a comment in 20260824 and to payment-model.md section 9.7,
-- which is NOT edited here (both are spoken for): those list Kherson and
-- Zaporizhzhia among US-sanctioned regions. For US purposes that appears
-- incorrect -- they are covered by EU restrictive measures, not by a US
-- Covered-Region determination. Confidence: medium; Treasury may extend
-- Covered Regions by determination, so re-check at review time.
INSERT INTO billing_region_policy
  (country_code, region_label, policy, sell_premium, marketing_default_opt_in,
   rationale, legal_review_status)
VALUES
  ('UA','Ukraine','avoid',false,false,
   'INTERIM, OVER-BLOCKING BY DESIGN. Crimea (E.O. 13685) and the DNR/LNR '
   'Covered Regions (E.O. 14065) are comprehensively sanctioned TERRITORIES '
   'that all resolve to ISO alpha-2 UA, which a CHAR(2)-keyed table cannot '
   'distinguish from Kyiv. Previously UA was unseeded and fell through to ZZ '
   'and SOLD. avoid is the only setting this schema can express that is not '
   'wrong in the strict-liability direction. COST: over-blocks ~35M people in '
   'unoccupied Ukraine. FIX: an ISO 3166-2 subdivision layer (see section 5.2 '
   'of docs/region-policy-review.md), after which this row should return to '
   'consent_first.',
   'researched')
ON CONFLICT (country_code) DO UPDATE SET
  policy                   = EXCLUDED.policy,
  sell_premium             = EXCLUDED.sell_premium,
  marketing_default_opt_in = EXCLUDED.marketing_default_opt_in,
  rationale                = EXCLUDED.rationale,
  legal_review_status      = EXCLUDED.legal_review_status
WHERE billing_region_policy.legal_review_status <> 'reviewed';

-- --- IL: express opt-in, currently only implicit via the ZZ fallback -------
-- Communications Law (Bezeq and Broadcasts) 5742-1982 s.30A is an express
-- opt-in regime for advertising by email/SMS/fax, with statutory damages that
-- have supported a substantial class-action practice.
-- https://www.nevo.co.il/law_html/law01/055_001.htm
-- Behaviourally identical to today's ZZ fallthrough. The value of the row is
-- that the reasoning becomes explicit rather than accidental. Confidence: medium.
INSERT INTO billing_region_policy
  (country_code, region_label, policy, sell_premium, marketing_default_opt_in,
   rationale, legal_review_status)
VALUES
  ('IL','Israel','consent_first',true,false,
   'Communications Law (Bezeq and Broadcasts) 5742-1982 s.30A: express prior '
   'consent required for advertising by email/SMS/fax, with statutory damages '
   'and an active class-action practice. Same behaviour as the ZZ fallback, '
   'but recorded deliberately rather than by omission.',
   'researched')
ON CONFLICT (country_code) DO UPDATE SET
  policy                   = EXCLUDED.policy,
  sell_premium             = EXCLUDED.sell_premium,
  marketing_default_opt_in = EXCLUDED.marketing_default_opt_in,
  rationale                = EXCLUDED.rationale,
  legal_review_status      = EXCLUDED.legal_review_status
WHERE billing_region_policy.legal_review_status <> 'reviewed';

-- --- TR: opt-in, plus an unresolved central-registry obligation ------------
-- Law No. 6563 on the Regulation of Electronic Commerce requires prior
-- consent for commercial electronic messages AND requires senders to register
-- consents with IYS, a centralised government message-management system, and
-- to query it before each send. https://www.mevzuat.gov.tr/mevzuatmetin/1.5.6563.pdf
--
-- ⚠️ LOWEST-CONFIDENCE ITEM IN THIS REVIEW. Whether the IYS registration
-- obligation binds a NON-RESIDENT service provider is genuinely unresolved in
-- the sources found. If it does, TR is operationally an 'avoid' -- there is no
-- realistic path for a solo operator to integrate with IYS. Seeded
-- consent_first (status quo behaviour) with the question recorded rather than
-- guessed at. Confidence: LOW. See question 9 in docs/region-policy-review.md.
INSERT INTO billing_region_policy
  (country_code, region_label, policy, sell_premium, marketing_default_opt_in,
   rationale, legal_review_status)
VALUES
  ('TR','Turkiye','consent_first',true,false,
   'Law No. 6563 (Regulation of Electronic Commerce): prior consent required '
   'for commercial electronic messages. UNRESOLVED, LOW CONFIDENCE: the law '
   'also requires consents to be registered with IYS, a central government '
   'message-management system queried before each send. Whether that binds a '
   'non-resident provider is not settled in the sources found. If it does, TR '
   'is operationally an avoid -- IYS integration is not realistic for a solo '
   'operator. Do not treat consent_first here as a conclusion.',
   'researched')
ON CONFLICT (country_code) DO UPDATE SET
  policy                   = EXCLUDED.policy,
  sell_premium             = EXCLUDED.sell_premium,
  marketing_default_opt_in = EXCLUDED.marketing_default_opt_in,
  rationale                = EXCLUDED.rationale,
  legal_review_status      = EXCLUDED.legal_review_status
WHERE billing_region_policy.legal_review_status <> 'reviewed';


-- ===========================================================================
-- 4. Annotations: obligations the tier is correct about but does not cover
-- ===========================================================================

-- --- US: tier confirmed, but two obligations live outside this table -------
--
-- (a) CAN-SPAM. The check-in email carries a three-product recommendation
--     block, so under 16 CFR 316.3(b) its primary purpose is COMMERCIAL, not
--     transactional -- the brief's premise is correct and I verified it.
--     https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316/section-316.3
--     always_on is therefore the right tier (CAN-SPAM is opt-out), BUT
--     15 U.S.C. 7704(a)(5)(A)(iii) additionally requires a valid PHYSICAL
--     POSTAL ADDRESS in every commercial message.
--
--     ⚠️ HIGHEST-CONFIDENCE DEFECT IN THIS REVIEW: renderEmail() in
--     supabase/functions/bella-checkin/index.ts has an unsubscribe link but
--     NO postal address. Home market, default-on path, highest-volume send.
--     Not fixable from this table -- there is no column for it. Fix the
--     template. See section 5.1 of docs/region-policy-review.md.
--
-- (b) California ARL as amended by AB 2863, in force 2025-07-01: express
--     affirmative consent to renewal terms retained 3 years, cost/frequency
--     disclosed before billing confirmation, cancellation by the same medium
--     used to sign up, renewal reminders.
--     https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB2863
--     Sub-national -- structurally unrepresentable here, exactly like UA.
--
--     (The FTC's federal "click-to-cancel" Negative Option Rule was vacated in
--     full by the 8th Circuit on 2025-07-08 and the FTC opened a fresh ANPRM
--     in Jan 2026. Do not assume it stays vacated.)
UPDATE billing_region_policy SET
  policy = 'always_on', sell_premium = true, marketing_default_opt_in = true,
  rationale = 'Home market. CAN-SPAM is opt-out, so always_on is the correct '
              'tier -- but the check-in email is COMMERCIAL, not transactional '
              '(16 CFR 316.3(b): the product-recommendation block makes the '
              'primary purpose commercial), so the full content obligations '
              'attach. ⚠️ 15 U.S.C. 7704(a)(5)(A)(iii) requires a physical '
              'postal address in every commercial message and the current '
              'bella-checkin template has none -- FIX THE TEMPLATE, this table '
              'cannot. ⚠️ Sub-national: the California ARL (AB 2863, in force '
              '2025-07-01) mandates express renewal consent kept 3 years and '
              'same-medium cancellation; not expressible in a CHAR(2) key. '
              'Sales tax on SaaS varies by state -- Stripe Tax calculates, it '
              'does not assume the liability.',
  legal_review_status = 'researched'
WHERE country_code = 'US' AND legal_review_status <> 'reviewed';

-- --- KR: tier confirmed, but consent_first alone is NOT sufficient ---------
-- Network Act Art. 50 layers three obligations on top of prior consent that
-- this schema has no column for, and that the sending code does not implement:
--   * '(광고)' must appear in the subject line;
--   * a SEPARATE additional consent is required to send 21:00-08:00 KST, and
--     bella-checkin runs on a cron with no timezone awareness;
--   * consent must be RECONFIRMED every 2 years or it lapses, and
--     email_consent_events has no expiry concept -- a Korean consent recorded
--     today would remain "valid" in this system forever.
-- https://elaw.klri.re.kr/eng_service/lawView.do?hseq=61859&lang=ENG
-- Confidence: medium (well attested in KISA/KCC guidance; Korean statutory
-- text not read directly). If Korea is not a target market, moving KR to
-- 'avoid' may be cheaper than building reconsent expiry -- that is a PRODUCT
-- decision and is deliberately NOT made here.
UPDATE billing_region_policy SET
  policy = 'consent_first', sell_premium = true, marketing_default_opt_in = false,
  rationale = 'Network Act Art. 50: prior consent required. ⚠️ consent_first '
              'is NECESSARY BUT NOT SUFFICIENT here -- Art. 50 also requires a '
              '"(광고)" subject-line label, a SEPARATE consent for sends '
              'between 21:00 and 08:00 KST (bella-checkin has no timezone '
              'awareness), and RECONFIRMATION of consent every 2 years '
              '(email_consent_events has no expiry concept, so a Korean '
              'consent would never lapse in this system). None are '
              'expressible in this table. If KR is not a target market, '
              'moving it to avoid may be cheaper than building reconsent '
              'expiry -- an unmade product decision.',
  legal_review_status = 'researched'
WHERE country_code = 'KR' AND legal_review_status <> 'reviewed';

-- --- EU/EEA + GB: tier confirmed; two things the tier does not cover -------
--
-- (a) The soft opt-in exists and may be available. ePrivacy Art. 13(2) /
--     PECR reg. 22(3) permit marketing similar products to someone whose
--     address was obtained in the context of a sale, given an easy free
--     opt-out at collection and in every message. CJEU Inteligo Media SA v
--     ANSPDCP (C-654/23, 2025-11-13) confirmed it is a STANDALONE ePrivacy
--     basis needing no separate GDPR consent.
--     https://curia.europa.eu/juris/liste.jsf?num=C-654/23
--     ⚠️ NOT recommending reliance on it: Art. 13(2) is transposed with real
--     national variation, and whether a three-product referral block is still
--     "similar products or services" is exactly a lawyer question. Recorded so
--     the option is visible rather than lost. consent_first stays.
--
-- (b) VAT is due from the FIRST EURO -- there is no registration threshold
--     for a non-EU established seller; non-Union OSS is the mechanism. The UK
--     likewise has a NIL threshold for non-established businesses. And the
--     CRD Art. 16(m) waiver of the 14-day withdrawal right requires three
--     cumulative elements that a default Stripe Checkout does not collect
--     (C-641/19 PE Digital says construe it strictly).
--     A merchant of record (Paddle, Lemon Squeezy, FastSpring) shifts the VAT
--     registration and remittance burden; Stripe does not -- with Stripe you
--     are the seller of record. This is a commercial decision, not a tier
--     correction, so no policy changes here.
UPDATE billing_region_policy SET
  policy = 'consent_first', sell_premium = true, marketing_default_opt_in = false,
  rationale = rationale || ' [2026-08-25 research: tier CONFIRMED. Two riders. '
              '(1) The Art.13(2)/reg.22(3) SOFT OPT-IN may be available for a '
              'paying subscriber -- CJEU C-654/23 (2025-11-13) confirms it is '
              'a standalone ePrivacy basis -- but national transposition '
              'varies and the referral block may defeat "similar products". '
              'Not relied on; consent_first retained. (2) NOT AN EMAIL ISSUE: '
              'VAT/UK VAT is due from the FIRST SALE with no threshold for a '
              'non-established seller, and the CRD Art.16(m) withdrawal-right '
              'waiver needs an express acknowledgement that default Stripe '
              'Checkout does not collect. A merchant of record shifts the VAT '
              'burden; Stripe does not. See sections 6.1-6.2 of '
              'docs/region-policy-review.md.]',
  legal_review_status = 'researched'
WHERE country_code IN (
        'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
        'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
        'IS','LI','NO','GB'
      )
  AND legal_review_status <> 'reviewed'
  -- Re-append guard, as above.
  AND rationale NOT LIKE '%2026-08-25 research%';

-- --- The remaining consent_first rows: tier confirmed, notes recorded ------
-- CH -- opt-in, but the operative statute is the UNFAIR COMPETITION ACT
--       (UCA/UWG Art. 3(1)(o)), not the FADP that the seed names. Has a
--       sale-context exception mirroring the EU soft opt-in. Confidence: high.
-- CA -- CASL s.6 opt-in; implied consent via an Existing Business
--       Relationship (s.10(9)(a), s.10(10)) covers a purchase in the previous
--       2 years, so a subscriber qualifies -- but s.13 puts the BURDEN OF
--       PROVING consent on the sender, so express consent is cleaner.
--       Confidence: high.
-- AU -- Spam Act 2003 Sch. 2; inferred consent from an existing business
--       relationship exists but ACMA reads it narrowly. Confidence: high.
-- NZ -- Unsolicited Electronic Messages Act 2007 ss.9-11. Confidence: medium.
-- SG -- PDPA Consent Obligation (using the address) stacks with the Spam
--       Control Act (sending); the SCA exemption is narrow and the referral
--       block defeats it. Confidence: medium.
-- JP -- Act on Regulation of Transmission of Specified Electronic Mail Art. 3.
--       ⚠️ Art. 3(1)(iii) has an EXPRESS exception for a party in a business-
--       transaction relationship, which a paying subscriber may satisfy -- so
--       consent_first is likely STRICTER THAN REQUIRED. Kept as the safe
--       setting; flagged. Confidence: medium.
-- BR -- ⚠️ LOW CONFIDENCE. LGPD Art. 7 allows consent OR legitimate interest,
--       there is no CAN-SPAM/CASL equivalent, and practice rests on the CDC
--       plus the self-regulatory CAPEM code. NO SOURCE FOUND for a Brazilian
--       statutory opt-in email mandate. consent_first is prudence, not a
--       demonstrated requirement. The seeded rationale ('LGPD.') overstates
--       how settled this is.
-- IN -- DPDP Act 2023 is consent-based for processing. The OPERATIONAL flag
--       already in the seeded rationale is the more important half: the RBI
--       Digital Payments E-mandate Framework, 2026 (issued 2026-04-21) covers
--       cross-border recurring transactions and requires additional-factor
--       authentication plus a 24h pre-debit notification. Confidence: medium.
-- ZA -- POPIA s.69, and STRICTER than most: prior consent for non-customers
--       with only ONE consent request permitted ever; s.69(3) gives a
--       narrower similar-products carve-out for existing customers.
--       Confidence: high.
-- ZZ -- fallback row. Confirmed correct: sell to someone we cannot geolocate,
--       never default their email on. Do not delete.
UPDATE billing_region_policy SET
  policy = 'consent_first', sell_premium = true, marketing_default_opt_in = false,
  legal_review_status = 'researched'
WHERE country_code IN ('CH','CA','AU','NZ','SG','JP','BR','IN','ZA','ZZ')
  AND legal_review_status <> 'reviewed';

-- Per-row notes for the three rows above whose seeded rationale is materially
-- misleading rather than merely terse.
UPDATE billing_region_policy SET
  rationale = 'Opt-in for mass advertising under the Unfair Competition Act '
              '(UCA/UWG Art. 3(1)(o)) -- NOT the FADP, which the original seed '
              'named. Art. 3(1)(o) carries a sale-context exception mirroring '
              'the EU soft opt-in (own similar products, opt-out offered at '
              'collection and in every message).'
WHERE country_code = 'CH' AND legal_review_status <> 'reviewed';

UPDATE billing_region_policy SET
  rationale = 'CASL s.6: express or implied consent required. Implied consent '
              'via an Existing Business Relationship (s.10(9)(a) with the '
              's.10(10) time limits) covers a purchase in the preceding 2 '
              'years, so a paying subscriber qualifies -- but s.13 places the '
              'BURDEN OF PROVING consent on the sender, which is why express '
              'consent plus the email_consent_events log is the better path.'
WHERE country_code = 'CA' AND legal_review_status <> 'reviewed';

UPDATE billing_region_policy SET
  rationale = '⚠️ LOW CONFIDENCE -- consent_first here is PRUDENCE, not a '
              'demonstrated legal requirement. LGPD Art. 7 permits processing '
              'on consent OR legitimate interest, Brazil has no CAN-SPAM/CASL '
              'equivalent, and practice rests on the CDC plus the '
              'self-regulatory CAPEM code. NO SOURCE FOUND for a Brazilian '
              'statutory opt-in mandate for commercial email. The original '
              'seeded rationale ("LGPD.") overstates how settled this is.'
WHERE country_code = 'BR' AND legal_review_status <> 'reviewed';

UPDATE billing_region_policy SET
  rationale = 'Act on Regulation of Transmission of Specified Electronic Mail: '
              'opt-in since the 2008 amendment. ⚠️ Art. 3(1)(iii) contains an '
              'EXPRESS exception for a recipient in a business-transaction '
              'relationship with the sender, which a paying subscriber may '
              'well satisfy -- so consent_first is probably STRICTER THAN '
              'REQUIRED here. Retained as the safe setting; flagged so the '
              'option is not lost.'
WHERE country_code = 'JP' AND legal_review_status <> 'reviewed';

UPDATE billing_region_policy SET
  rationale = 'POPIA s.69 -- STRICTER than most consent_first peers: prior '
              'consent required for direct electronic marketing, and a '
              'non-customer may be asked for consent ONLY ONCE, ever. s.69(3) '
              'gives existing customers a narrower similar-products carve-out '
              'with an opt-out offered at collection.'
WHERE country_code = 'ZA' AND legal_review_status <> 'reviewed';

UPDATE billing_region_policy SET
  rationale = 'DPDP Act 2023 is consent-based for processing personal data; '
              'email marketing specifically is thinner than a bare "DPDP" '
              'citation implies. The OPERATIONAL flag is the more important '
              'half: the RBI Digital Payments E-mandate Framework, 2026 '
              '(issued 2026-04-21) consolidates recurring-payment rules '
              'including CROSS-BORDER transactions, requiring additional-'
              'factor authentication at registration and first debit plus a '
              '24-hour pre-debit notification. That is a real integration, '
              'not a checkbox. Moving IN to avoid remains a business call.'
WHERE country_code = 'IN' AND legal_review_status <> 'reviewed';


-- ===========================================================================
-- 5. Timestamp the pass
-- ===========================================================================
-- reviewed_at is deliberately LEFT NULL for every row. It means "a human
-- signed this off", and nothing in this file is a sign-off. The billing_
-- region_policy_updated_at trigger has stamped updated_at, which is the
-- correct signal that these rows were touched by research rather than review.
--
-- ⚠️ Nothing in this file sets legal_review_status = 'reviewed'. Only counsel
-- does that, one row at a time, after reading docs/region-policy-review.md.
