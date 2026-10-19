# Kontakt och ansökan – överlämning till Claude

## Det som kopplas ihop

**Ta kontakt**, **Skriv till mig** och annonsens ansökningsknapp öppnar samma formulär på webbplatsen. En ansökan knyts till den öppna annonsen. Design och formulärlogik finns i frontend; Claude ansvarar för serverfunktionen och publiceringen. Mejlskickandet är inte aktivt innan den kopplingen är på plats.

Utkastet blockerar nätverksinskick och talar om att inget har skickats. Det får inte visa ett lyckat skickat meddelande som demonstration.

## Anrop

Implementera `POST /api/contact` på samma domän som webbplatsen. Frontend skickar `multipart/form-data` via `FormData`; webbläsaren sätter själv `Content-Type` och multipart-gränsen.

| Fält | Innehåll |
| --- | --- |
| `name` | Obligatoriskt namn, högst 120 tecken. |
| `email` | Obligatorisk giltig e-postadress, högst 254 tecken. |
| `message` | Obligatoriskt meddelande, högst 5 000 tecken. |
| `type` | `contact` eller `application`. |
| `jobId` | Obligatoriskt vid ansökan: stabilt offentligt annons-ID. |
| `jobTitle` | Annonsens titel vid ansökan. |
| `jobType` | `recruitment` eller `consulting` vid ansökan. |
| `linkedin` | Valfri profillänk. Endast HTTPS, värdnamnet `linkedin.com` eller `www.linkedin.com` och profilsökväg `/in/…`. |
| `documents` | Valfria bilagor, ett upprepat fältnamn per fil. Högst 3 filer, sammanlagt högst 10 MiB (10 485 760 byte). PDF, DOC eller DOCX. |
| `website` | Dolt honeypot-fält som ska vara tomt. |

## Krav på servern

- Validera fälten på servern även om frontend redan har gjort det. Trimma obligatoriska textfält och avvisa tomma värden. Kontrollera längdgränser och tillåtna fältvärden.
- Slå upp `jobId` i aktuell publicerad annonsdata vid en ansökan. Avvisa okända, avslutade eller utgångna annonser. Hämta betrodd titel och typ därifrån; klientens `jobTitle` och `jobType` får inte styra intern koppling eller mejlhuvuden.
- Mottagaren är fast på servern: **filip@thurneco.se**. Använd en verifierad avsändaradress och besökarens validerade adress som `Reply-To`. Tillåt inte att klienten väljer mottagare. Förhindra radbrytningar i mejlhuvuden och rendera meddelandet som text eller korrekt HTML-escapat innehåll.
- Kontrollera antal filer, total filstorlek, filändelse och faktiskt filinnehåll. Lita inte enbart på klientens MIME-typ. Begränsa även storleken på hela HTTP-anropet, med utrymme för text och multipart-data utöver bilagegränsen. Hantera bilagor privat och kontrollera dem före eventuell lagring eller vidarebefordran.
- Avvisa ifyllt `website`. Lägg till begränsning av anropsfrekvens på servern och kontrollera anropets ursprung för den publicerade domänen. Honeypot-fältet är bara ett komplement till dessa kontroller.
- Förvara mejltjänstens nycklar och övriga hemligheter enbart på servern. Kandidatuppgifter, meddelanden och bilagor får aldrig skrivas till publika `jobs.json` eller publiceringsfilerna.

## Svar och fel

Returnera `Content-Type: application/json`.

- **Framgång:** HTTP 2xx med `{ "ok": true }` först efter att mejltjänsten har accepterat meddelandet. Detta betyder accepterat för leverans, inte bekräftat mottaget i inkorgen.
- **Fel:** lämplig HTTP 4xx eller 5xx med `{ "ok": false }`. Exempel: 400 för ogiltigt underlag, 413 för för stort anrop, 429 för för många försök och 502/503 för problem med mejltjänsten. Exponera inte leverantörsfel, hemligheter eller intern driftinformation i svaret.

Frontend ska bara visa skickat-bekräftelsen när både HTTP-status och JSON-svaret bekräftar framgång. Nätverksfel, timeout, saknad endpoint, HTML-svar och `{ "ok": false }` ska ge ett begripligt fel och behålla användarens text. Visa aldrig framgång enbart för att knappen har klickats.

## Innan publicering

Koppla endpointen, konfigurera verifierad avsändare och testa kontakt samt en rollanknuten ansökan med och utan bilaga. Kontrollera att rätt mottagare får innehållet och att svar går till besökaren. Prova också felaktiga fält, för stora bilagor, en avpublicerad annons och ett leveransfel. Lägg in integritetsinformation som beskriver den faktiska hanteringen och eventuell lagring av kontakt- och kandidatdata. Backend och den publika sidan måste vara anslutna innan formuläret presenteras som fungerande.
