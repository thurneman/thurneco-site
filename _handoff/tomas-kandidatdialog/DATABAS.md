# Kandidatdialog i partnervyn

Central 2 installerar `dialog.sql` i samma skarpa ATS-projekt som Tomas använder efter ordinarie godkännande. Ange den avsedda partnerns verkliga e-postadress i sessionsinställningen `thurneco.dialogpartner` före installation. Skriptet kontrollerar att adressen tillhör en aktiv partner. Upprepade körningar ska använda samma adress. Granska resultatet först i en separat provdatabas.

## Vad webben får läsa

`public.v_kontakter_partner` behåller sina åtkomstfilter och får ett extra fält, `partner_meddelande`. Det innehåller `matchId`, `text` och när kopplingen finns `orderId` eller `partnerSvarId`. Id:n är strängar. Datumet hämtas från händelsens `at`. Kvittens utan sparad brödtext ger `text: null`. En post som saknar säker koppling ger ett tomt fält på radnivå (SQL NULL). Brödtexten går genom det befintliga filtret `ats_strip` för interna beteckningar. Webben kan visa befintliga separata kontaktuppgifter genom kandidatens ordinarie partnervy.

Partnern måste vara inloggad, uttryckligen aktiverad här och ha tillgång till den exakta matchningen. Användarens egen beställning, rätt konsult och rätt uppdrag kontrolleras på serversidan. Ägarens roll får ingen utökad läsrätt genom partnervyn. En förhandsvisning utan en verifierad partnerprojektion får återge kvittens och kända datum med de behörigheter som redan finns. Den får aldrig fylla ett saknat fält med råtext från ägarens datakälla.

## Vad Kandidatkontakt sparar

När LinkedIn har bekräftat utskicket sparar utföraren kontaktens verkliga tid, brödtext och den beställning som ledde till utskicket. Lägg till följande i det befintliga underlaget till `ats_auto.kontakt` när en ny kontakt skrivs. Funktionen för redan dessa fält vidare till skyddade `kontakter.extra`.

```json
{
  "brodtext": "Innehållet i det kvitterade meddelandet",
  "partnerDialog": {
    "partner": "partner@example.test",
    "matchId": "provuppdrag__provkonsult",
    "orderId": "123"
  }
}
```

Vid svar ska utföraren först identifiera vilket skickat meddelande LinkedIn-svaret hör till. Använd den verifierade tråd-/meddelandereferensen och kontrollera uppdraget. Spara sedan svarstexten med svarstid, inkommande riktning och samma `partnerDialog`. Om en LinkedIn-konversation omfattar flera uppdrag och svaret inte kan tillskrivas ett av dem, ska ingen sådan länk skrivas. Ett utgående svar beställt via `partnersvar` fortsätter använda sitt befintliga `partnersvarId`. Båda markörerna på en och samma post leder till att innehållet hålls tillbaka. Uppdatera befintlig kontakt när den behöver kompletteras för att undvika dubbla historikposter.

## Befintliga meddelanden

Installationen försöker knyta äldre händelser till partnern med hjälp av den skyddade kön, samma ordinarie ordernyckel, uppdrags-id, verklig meddelandetext och utskickstid samt beställarens identitet i en betrodd revisionspost. Ett äldre kandidatsvar kräver dessutom en serverregistrerad svarsavisering till den partnern för exakt samma kontakt-id. En ändrad historisk brödtext eller tid gör beviset ogiltigt. Om den behöriga utföraren senare kan verifiera en tidigare osäker post i den ursprungliga konversationen kan den kompletteras med `partnerDialog`.

Den skrivskyddade räkningen den 27 november 2026 fann 26 äldre Tomas-beställningar med motsvarande skickad text och tid i kön. För 12 av dem uppfyllde även revisionsposten kontrollerna. Ett äldre inkommande svar kunde bindas med samma kriterier. Detta är en räkning före installation och före inloggningsprov i Tomas vy.

## Isolerat prov

Kör `node dialog.test.cjs` med paketet `@electric-sql/pglite` tillgängligt, eller ange paketets sökväg med `PGLITE_MODULE`. Provet kör den faktiska SQL-filen två gånger i en ny lokal PostgreSQL-miljö med fiktiva data och olika inloggningsroller. Det undersöker också kvittens utan text, två uppdrag för samma person, en kollegas samtal, ett oadresserat svar och nekad direktläsning av råtabeller.
