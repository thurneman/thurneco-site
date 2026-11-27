-- Granskning för Central 2. Ange den avsedda partnerns e-post i
-- thurneco.dialogpartner för sessionen före körning. Detta skript gör inga utskick.
BEGIN;

CREATE TABLE IF NOT EXISTS ats_auto.kandidatdialog_partner (
  email text PRIMARY KEY CHECK (email = lower(email) AND email <> '')
);
CREATE TABLE IF NOT EXISTS ats_auto.kandidatdialog_bevis (
  kontakt_id bigint PRIMARY KEY REFERENCES public.kontakter(id) ON DELETE CASCADE,
  partner text NOT NULL REFERENCES ats_auto.kandidatdialog_partner(email),
  match_id text NOT NULL,
  order_id bigint NOT NULL,
  kontakt_at timestamptz NOT NULL,
  kropp_sha256 bytea NOT NULL,
  riktning text NOT NULL CHECK (riktning IN ('in', 'ut'))
);
REVOKE ALL ON ats_auto.kandidatdialog_partner, ats_auto.kandidatdialog_bevis FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  partner text := lower(nullif(trim(current_setting('thurneco.dialogpartner', true)), ''));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.anvandare u WHERE lower(u.email) = partner AND u.aktiv AND u.roll = 'partner') THEN
    RAISE EXCEPTION 'Ange den aktiva partnerns e-post i thurneco.dialogpartner.';
  END IF;
  INSERT INTO ats_auto.kandidatdialog_partner(email) VALUES (partner) ON CONFLICT DO NOTHING;
END $$;

-- Före länkar per kontakt. Ett kö-id på en rad som partnern får ändra räcker inte.
-- Köns ordernyckel, roll, utskickstid och text ska stämma med den verkliga kontakten.
-- En betrodd loggrad ska binda samma order, kö, beställare och matchning.
WITH lager AS (
  SELECT c.id AS kontakt_id, lower(k.bestallare) AS partner, k.match_id, k.id AS order_id
  FROM public.kontaktbestallningar k
  JOIN public.ko q ON q.id = k.ko_id AND q.bestallningar ? k.nyckel AND k.role_id = ANY(q.role_ids)
  JOIN public.kontakter c ON c.cand_id = k.cand_id AND c.role_id = k.role_id
    AND c.kanal = 'inmail' AND c.riktning = 'ut'
    AND c.at = ats_auto.ts_in(q.utkast -> k.cand_id -> 'skickatAt')
    AND c.extra ->> 'brodtext' = q.utkast -> k.cand_id ->> 'text'
  JOIN public.matches m ON m.id = k.match_id AND m.cand_id = c.cand_id AND m.role_id = c.role_id
  WHERE k.status = 'skickat' AND nullif(btrim(k.kvittens), '') IS NOT NULL
    AND nullif(btrim(c.extra ->> 'brodtext'), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.andringslogg a
      WHERE a.tabell = 'kontaktbestallningar' AND a.rad_id = k.id::text
        AND a.efter ->> 'status' = 'skickat' AND a.efter ->> 'ko_id' = q.id
        AND a.efter ->> 'nyckel' = k.nyckel AND a.efter ->> 'role_id' = k.role_id
        AND a.efter ->> 'cand_id' = k.cand_id AND a.efter ->> 'match_id' = k.match_id
        AND lower(a.efter ->> 'bestallare') = lower(k.bestallare)
        AND (a.av IN ('postgres', 'service_role') OR EXISTS (
          SELECT 1 FROM public.anvandare u WHERE lower(u.email) = lower(a.av) AND u.roll = 'agare'
        ))
    )
), entydiga AS (
  SELECT kontakt_id, min(partner) AS partner, min(match_id) AS match_id, min(order_id) AS order_id
  FROM lager GROUP BY kontakt_id HAVING count(*) = 1
)
INSERT INTO ats_auto.kandidatdialog_bevis (kontakt_id, partner, match_id, order_id, riktning, kontakt_at, kropp_sha256)
SELECT l.kontakt_id, l.partner, l.match_id, l.order_id, 'ut', c.at,
       sha256(convert_to(coalesce(c.extra->>'brodtext',''), 'UTF8'))
FROM entydiga l JOIN ats_auto.kandidatdialog_partner p ON p.email = l.partner
JOIN public.kontakter c ON c.id = l.kontakt_id
ON CONFLICT DO NOTHING;

-- Ett äldre inkommande svar behöver både den egna kvitterade konversationen och
-- ett separat serverbesked som pekar ut just detta kontakt-id och denna mottagare.
WITH svar AS (
  SELECT c.id AS kontakt_id, b.partner, b.match_id, min(b.order_id) AS order_id
  FROM public.kontakter c
  JOIN public.kontakter ut ON ut.cand_id = c.cand_id AND ut.role_id = c.role_id AND ut.at <= c.at
  JOIN ats_auto.kandidatdialog_bevis b ON b.kontakt_id = ut.id AND b.riktning = 'ut'
  JOIN ats_auto.partnerbesked n ON n.kontakt_id = c.id AND n.typ = 'kandidatsvar'
    AND n.role_id = c.role_id AND n.cand_id = c.cand_id AND lower(n.till) = b.partner
  WHERE c.kanal = 'inmail' AND c.riktning = 'in'
    AND NOT EXISTS (SELECT 1 FROM ats_auto.partnerbesked annat
      WHERE annat.kontakt_id = c.id AND annat.typ = 'kandidatsvar' AND lower(annat.till) <> b.partner)
    AND NOT EXISTS (SELECT 1 FROM public.kontaktbestallningar annan
      WHERE annan.role_id = c.role_id AND annan.cand_id = c.cand_id AND annan.status = 'skickat'
        AND (lower(annan.bestallare) IS DISTINCT FROM b.partner OR annan.match_id IS DISTINCT FROM b.match_id))
  GROUP BY c.id, b.partner, b.match_id
  HAVING count(DISTINCT b.order_id) = 1
)
INSERT INTO ats_auto.kandidatdialog_bevis (kontakt_id, partner, match_id, order_id, riktning, kontakt_at, kropp_sha256)
SELECT s.kontakt_id, s.partner, s.match_id, s.order_id, 'in', c.at,
       sha256(convert_to(coalesce(c.extra->>'brodtext',''), 'UTF8'))
FROM svar s JOIN public.kontakter c ON c.id = s.kontakt_id
ON CONFLICT DO NOTHING;

-- Både de nya länkarna och de äldre bevisen möter aktuella partner- och matchfilter.
-- partnerDialog skrivs endast på skyddade kontakter av utföraren vid verifierat utskick/svar.
CREATE OR REPLACE VIEW ats_auto.kandidatdialog_underlag WITH (security_barrier = true) AS
WITH lankar AS (
  SELECT c.id, b.partner, b.match_id, b.order_id::text AS order_ref, NULL::text AS svar_ref
  FROM ats_auto.kandidatdialog_bevis b JOIN public.kontakter c ON c.id = b.kontakt_id AND c.riktning = b.riktning
    AND c.at = b.kontakt_at AND sha256(convert_to(coalesce(c.extra->>'brodtext',''), 'UTF8')) = b.kropp_sha256
  JOIN public.kontaktbestallningar k ON k.id = b.order_id AND k.cand_id = c.cand_id AND k.role_id = c.role_id
    AND k.match_id = b.match_id AND lower(k.bestallare) = b.partner AND k.status = 'skickat'
    AND nullif(btrim(k.kvittens),'') IS NOT NULL
  WHERE NOT (coalesce(c.extra, '{}'::jsonb) ?| ARRAY['partnerDialog','partnersvarId'])
  UNION ALL
  SELECT c.id, lower(k.bestallare), k.match_id, k.id::text, NULL::text
  FROM public.kontakter c JOIN public.kontaktbestallningar k
    ON k.id::text = c.extra -> 'partnerDialog' ->> 'orderId'
    AND k.role_id = c.role_id AND k.cand_id = c.cand_id
    AND lower(k.bestallare) = lower(c.extra -> 'partnerDialog' ->> 'partner')
    AND k.match_id = c.extra -> 'partnerDialog' ->> 'matchId'
    AND k.status = 'skickat' AND nullif(btrim(k.kvittens),'') IS NOT NULL
  WHERE c.extra ? 'partnerDialog' AND NOT (c.extra ? 'partnersvarId')
  UNION ALL
  SELECT c.id, lower(s.av), s.match_id, NULL::text, s.id
  FROM public.kontakter c JOIN public.partnersvar s ON s.id = c.extra ->> 'partnersvarId'
    AND s.cand_id = c.cand_id AND s.role_id = c.role_id AND s.typ = 'svar' AND s.status = 'skickat'
  WHERE c.riktning = 'ut' AND NOT (c.extra ? 'partnerDialog')
)
SELECT c.id, jsonb_strip_nulls(jsonb_build_object('matchId', l.match_id,
         'orderId', l.order_ref, 'partnerSvarId', l.svar_ref)) || jsonb_build_object('text',
         CASE WHEN jsonb_typeof(c.extra->'brodtext') = 'string' AND btrim(c.extra->>'brodtext') <> ''
           THEN public.ats_strip(c.extra->>'brodtext') END) AS partner_meddelande
FROM lankar l JOIN public.kontakter c ON c.id = l.id AND c.kanal = 'inmail' AND c.riktning IN ('ut','in')
JOIN ats_auto.kandidatdialog_partner p ON p.email = l.partner AND p.email = public.ats_email()
JOIN public.v_matches_partner m ON m.id = l.match_id AND m.cand_id = c.cand_id AND m.role_id = c.role_id
WHERE public.ats_roll() = 'partner' AND c.at IS NOT NULL;
REVOKE ALL ON ats_auto.kandidatdialog_underlag FROM PUBLIC, anon, authenticated;

-- Behåll exakt de filter och befintliga kolumner som Central 2 har i den installerade
-- vyn. Ett senare, konkurrerande tillägg av samma fält kräver uttrycklig samordning.
DO $$
DECLARE
  vy text := rtrim(pg_get_viewdef('public.v_kontakter_partner'::regclass, true), E' ;\t\n\r');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.v_kontakter_partner'::regclass
             AND attname = 'partner_meddelande' AND NOT attisdropped) THEN
    IF position('kandidatdialog_underlag' IN vy) = 0 THEN
      RAISE EXCEPTION 'partner_meddelande finns redan med annan definition. Samordna versionerna före installation.';
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.v_kontakter_partner'::regclass
                 AND reloptions = ARRAY['security_barrier=true']::text[]) THEN
    RAISE EXCEPTION 'Partnervyn har bytt säkerhetsmodell. Granska den aktuella versionen.';
  END IF;
  EXECUTE format('CREATE OR REPLACE VIEW public.v_kontakter_partner WITH (security_barrier=true) AS
    SELECT synlig.*, d.partner_meddelande FROM (%s) synlig
    LEFT JOIN ats_auto.kandidatdialog_underlag d ON d.id = synlig.id', vy);
END $$;
COMMIT;
