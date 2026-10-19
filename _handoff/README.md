# Thurne Consulting – webbmallar

Fyra sidor: startsida, om företaget, lediga jobb och individuell annons. Webbplatsens design finns i `dist/`, och annonsinnehållet finns separat i `dist/data/jobs.json`.

## Design

- Bakgrund: `#242e33`. Text: `#f6f5f3`. Dämpad text: `#bcc0bf`.
- Accent: `#b99987`. Knappfärg: `#5e4745`.
- Montserrat, vikterna 300, 400, 500 och 600, laddas genom Google Fonts i samtliga HTML-mallar. Ingen font hämtas från den tidigare webbhotellsleverantören.
- `.thurne-site` bär färger, typografi och bakgrund även när sidan visas i en inbäddad förhandsvisning. Behåll omslutningen vid integration med ATS eller ett annat ramverk.
- `styles.css` är gemensam för alla sidor. `shared.js` skapar sidhuvud och sidfot. `careers.js` skapar annonsernas gemensamma layout från data.
- Förhandsvisningen skapas med `node scripts/make-preview.mjs` från samma dokument, CSS och skript som publiceringspaketet. Ändra inte designen separat i den genererade HTML-filen.

## Annonsdata och ATS

Kontakt- och ansökningsknappar öppnar samma formulär, med annonskoppling för ansökningar. Claude kopplar mejlskickandet enligt `integration/contact-contract.md` (finns som `_handoff/contact-contract.md` i ZIP). Utkastet skickar inga meddelanden. Den publicerbara mallen anropar `POST /api/contact`; utan den tjänsten visas ingen skickat-bekräftelse. Formuläret finns i `dist/contact.js`, med gemensamma stilar i `dist/styles.css`.

`dist/data/jobs.json` innehåller 32 annonser: 7 rekryteringar och 25 konsultuppdrag. Designrättningen ändrar inte annonsdata. Lägg inte CSS eller HTML i annonsfälten.

Stabila annonsadresser använder `/jobb/?id=<id>`. Data hämtas från `/data/jobs.json` utan webbläsarcache. Framtida import från mejl, databas och automatisk publicering ska leverera samma publika dataformat; se `integration/ats-contract.md`. Dessa integrationer ingår inte i detta paket.

## Paketet

Innehållet i `dist/` placeras i webbplatsens rot. Sökvägarna `/assets/`, `/data/`, `/om/`, `/lediga-jobb/` och `/jobb/` ska behållas. Vanlig statisk webbserver räcker för visningen. Google Fonts kräver internetåtkomst; Segoe UI/sans-serif används som reserv.

## Verifiering 19 oktober 2026

Kontaktformuläret är kontrollerat i webbläsaren från Ta kontakt, Skriv till mig och Ansök nu. Ansökan visar annonsens titel och extra fält för LinkedIn och dokument. Vid 390 pixels mobilbredd ryms formuläret utan horisontell scroll. Utkastets formulär gör inga POST-anrop. Ett misslyckat sändningsförsök i publiceringsmallen visar ett felmeddelande och behåller den skrivna texten; inget mejl skickades vid kontrollen. Verklig mejlleverans återstår att koppla och verifiera i backend.

Kontroller av 32 annonssidor, länkar, kategorier, loggor, inbäddade bilder, dataexport och hantering av avslutade annonser passerar. Förhandsvisningens CSS och sidinnehåll kommer från samma mallar som paketet.

HTML-utkastet har renderats i webbläsaren och jämförts med de tidigare bildexemplens färger och med publiceringsmallarna. Mörkblå bakgrund, ljusa rubriker och Montserrat från Google Fonts är bekräftade. Startsida, om-sida och båda karriärflikarna är visuellt kontrollerade. Utkast och publiceringsmall har identiska uppmätta elementmått på startsida och karriärsida vid 1280 pixels webbläsarbredd. Vid 390 pixels rambredd har samtliga rekryteringsrader identiska mått, utan horisontell overflow; en expanderad annons har också kontrollerats.
