const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

async function test() {
  const db = new PGlite();
  try {
    const migration = fs.readFileSync(path.join(__dirname, 'dialog.sql'), 'utf8');
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA ats_auto;
      CREATE TABLE anvandare(email text primary key,roll text,aktiv boolean);
      CREATE TABLE matches(id text primary key,role_id text,cand_id text,visible boolean);
      CREATE TABLE kontakter(id bigint primary key,role_id text,cand_id text,at timestamptz,
        kanal text,riktning text,text text,av text,extra jsonb);
      CREATE TABLE kontaktbestallningar(id bigint primary key,role_id text,cand_id text,match_id text,
        bestallare text,status text,kvittens text,nyckel text,ko_id text);
      CREATE TABLE partnersvar(id text primary key,role_id text,cand_id text,match_id text,av text,typ text,status text);
      CREATE TABLE ko(id text primary key,bestallningar jsonb,role_ids text[],utkast jsonb);
      CREATE TABLE andringslogg(tabell text,rad_id text,efter jsonb,av text);
      CREATE TABLE ats_auto.partnerbesked(kontakt_id bigint,typ text,role_id text,cand_id text,till text);
      CREATE FUNCTION ats_email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.viewer') $$;
      CREATE FUNCTION ats_roll() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role') $$;
      CREATE FUNCTION ats_strip(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT $1$$;
      CREATE FUNCTION ats_auto.ts_in(jsonb) RETURNS timestamptz LANGUAGE sql STABLE AS $$
        SELECT CASE WHEN jsonb_typeof($1)='string' THEN ($1 #>> '{}')::timestamptz END $$;
      CREATE VIEW v_matches_partner WITH (security_barrier=true) AS
        SELECT * FROM matches WHERE visible AND ats_roll()='partner';
      CREATE VIEW v_kontakter_partner WITH (security_barrier=true) AS
        SELECT id,cand_id,role_id,at,kanal,riktning,ats_strip(text) AS text,av FROM kontakter
        WHERE role_id <> 'hidden' AND ats_roll()='partner';
      GRANT SELECT ON v_kontakter_partner TO authenticated;
      INSERT INTO anvandare VALUES ('t@example.test','partner',true), ('other@example.test','partner',true);
      INSERT INTO matches VALUES ('a-p','a','p',true),('b-p','b','p',true),('secret-p','secret','p',false),
        ('hidden-p','hidden','p',true),('forge-p','forge','p',true);
      INSERT INTO kontaktbestallningar VALUES
        (1,'a','p','a-p','t@example.test','skickat','kvitto','ka','qa'),
        (2,'b','p','b-p','other@example.test','skickat','kvitto','kb','qb'),
        (3,'secret','p','secret-p','t@example.test','skickat','kvitto','ks','qs'),
        (4,'hidden','p','hidden-p','t@example.test','skickat','kvitto','kh','qh'),
        (5,'forge','p','forge-p','t@example.test','skickat','felaktig kvittens','kf','qf');
      INSERT INTO ko VALUES
        ('qa','["ka"]','{a}','{"p":{"text":"Första riktiga texten","skickatAt":"2026-11-01T10:00:00Z"}}'),
        ('qf','["kf"]','{forge}','{"p":{"text":"Någon annans meddelande","skickatAt":"2026-11-01T10:00:00Z"}}');
      INSERT INTO andringslogg SELECT 'kontaktbestallningar',id::text,to_jsonb(k),
        CASE WHEN id=5 THEN bestallare ELSE 'postgres' END FROM kontaktbestallningar k;
      INSERT INTO partnersvar VALUES ('ps','a','p','a-p','t@example.test','svar','skickat'),
        ('queued','a','p','a-p','t@example.test','svar','bestalld');
      INSERT INTO kontakter(id,role_id,cand_id,at,kanal,riktning,text,extra) VALUES
        (1,'a','p','2026-11-01 10:00Z','inmail','ut','Endast kvittens','{"brodtext":"Första riktiga texten"}'),
        (2,'a','p','2026-11-02 10:00Z','inmail','in','Registrerat','{"brodtext":"Mitt gamla svar"}'),
        (3,'a','p','2026-11-02 11:00Z','inmail','in','Besked','{"brodtext":"Ett oadresserat svar"}'),
        (4,'a','p','2026-11-03 10:00Z','inmail','ut','Kvittens','{"brodtext":"Mitt svar","partnersvarId":"ps"}'),
        (5,'b','p','2026-11-02 10:00Z','inmail','in','Besked','{"brodtext":"Andras uppdrag","partnerDialog":{"orderId":"2","matchId":"b-p","partner":"other@example.test"}}'),
        (6,'a','p','2026-11-03 12:00Z','inmail','in','Besked','{"brodtext":"Nytt verifierat svar","partnerDialog":{"orderId":"1","matchId":"a-p","partner":"t@example.test"}}'),
        (7,'b','p','2026-11-02 10:00Z','inmail','in','Besked','{"brodtext":"Fel uppdrag","partnerDialog":{"orderId":"1","matchId":"a-p","partner":"t@example.test"}}'),
        (8,'a','p','2026-11-03 12:01Z','inmail','ut','Kvittens','{"partnerDialog":{"orderId":"1","matchId":"a-p","partner":"t@example.test"}}'),
        (9,'secret','p','2026-11-03 12:00Z','inmail','ut','Kvittens','{"brodtext":"Privat","partnerDialog":{"orderId":"3","matchId":"secret-p","partner":"t@example.test"}}'),
        (10,'hidden','p','2026-11-03 12:00Z','inmail','ut','Kvittens','{"brodtext":"Dold roll","partnerDialog":{"orderId":"4","matchId":"hidden-p","partner":"t@example.test"}}'),
        (11,'forge','p','2026-11-01 10:00Z','inmail','ut','Kvittens','{"brodtext":"Någon annans meddelande"}'),
        (12,'a','p','2026-11-03 12:00Z','inmail','ut','Kvittens','{"brodtext":"Köad","partnersvarId":"queued"}'),
        (13,'a','p','2026-11-02 09:00Z','inmail','in','Besked','{"brodtext":"Två mottagare"}'),
        (14,'a','p','2026-11-03 13:00Z','mail','in','Besked','{"brodtext":"Fel kanal","partnerDialog":{"orderId":"1","matchId":"a-p","partner":"t@example.test"}}');
      INSERT INTO ats_auto.partnerbesked VALUES (2,'kandidatsvar','a','p','t@example.test'),
        (13,'kandidatsvar','a','p','t@example.test'),(13,'kandidatsvar','a','p','other@example.test');
      SET thurneco.dialogpartner='t@example.test';
      SET test.viewer='t@example.test'; SET test.role='partner';
    `);
    await db.exec(migration);
    await db.exec(migration);
    await db.exec('SET ROLE authenticated');
    const rows = (await db.query('SELECT id, partner_meddelande AS p FROM v_kontakter_partner ORDER BY id')).rows;
    const messages = new Map(rows.map(r => [Number(r.id),r.p]));
    assert.deepEqual(messages.get(1), {matchId:'a-p',orderId:'1',text:'Första riktiga texten'});
    assert.equal(messages.get(2).text,'Mitt gamla svar');
    assert.equal(messages.get(4).partnerSvarId,'ps');
    assert.equal(messages.get(6).text,'Nytt verifierat svar');
    assert.equal(messages.get(8).text,null);
    for (const id of [3,5,7,9,11,12,13,14]) assert.equal(messages.get(id),null, 'Oviss eller obehörig post '+id);
    assert.equal(messages.has(10),false);
    await assert.rejects(db.query('SELECT * FROM ats_auto.kandidatdialog_bevis'), /permission denied/);
    await assert.rejects(db.query('SELECT * FROM kontakter'), /permission denied/);
    await db.exec("RESET ROLE; UPDATE kontakter SET extra=jsonb_set(extra,'{brodtext}',to_jsonb('Ändrat meddelande'::text)) WHERE id=1; SET ROLE authenticated");
    assert.equal((await db.query('SELECT partner_meddelande FROM v_kontakter_partner WHERE id=1')).rows[0].partner_meddelande, null);
    await db.exec("SET test.viewer='other@example.test'");
    assert.equal((await db.query('SELECT count(*) AS n FROM v_kontakter_partner WHERE partner_meddelande IS NOT NULL')).rows[0].n,0);
    await db.exec("SET test.viewer='t@example.test'; SET test.role='agare'");
    assert.equal((await db.query('SELECT count(*) AS n FROM v_kontakter_partner')).rows[0].n,0);
    console.log('Godkänt: båda installationerna, äldre och nya utskick/svar, order- och matchsamband, saknad brödtext, separata uppdrag, skyddade kandidater, felaktig historik, dubbel mottagare, annan partner, ägarvy samt råtabellsrättigheter.');
  } finally { await db.close(); }
}
test().catch(error => { console.error(error.message); process.exitCode = 1; });
