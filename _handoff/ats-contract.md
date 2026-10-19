# Karriärsida och framtida ATS

## Publicering

I ATS:et har varje uppdrag en knapp eller omkopplare **Visa på karriärsida**, avstängd från början. Aktivering ska visa en förhandsgranskning av en separat offentlig annons. Bara ett autentiserat och behörigt adminanrop får ändra publiceringen.

Publicering kräver `showOnCareerPage === true` och `status === "open"`. Avslutade, avmarkerade och utgångna annonser tas bort i nästa export. Frontend gömmer även utgångna annonser vid laddning. Cache ska återvalideras så att avpublicering slår igenom; den framtida serverkopplingen behöver också hindra åtkomst till avpublicerade detaljannonser.

Rådata för kunder, kundkontakter, marginaler, kandidater, söklistor och interna anteckningar får aldrig skickas till webbläsaren. Filtreringen måste ske på serversidan före överföring, inte bara genom att dölja kort i frontend. En publik annons lagras separat från projektbeskrivningen och granskas innan publicering. Slutkundens namn och URL inkluderas bara om de ska vara offentliga.

## Fält

`public.id`: stabilt offentligt annons-ID, frikopplat från privata projekt-ID:n.

`public.type`: `consulting` eller `recruitment`. Visningsnamnen kan ändras senare utan att ändra datamodellen.

Obligatoriska publika textfält: `title`, `description`.

Valfria publika textfält: `company`, `location`, `workplace`, `deadline`.

`public.category`: kategori för konsultuppdrag. Tillåtna värden är `IT & data`, `Teknik & industri`, `Projektledning & verksamhet`, `HR & administration` och `Vård`.

`public.companyLogo`: lokal sökväg under `/assets/` till en godkänd PNG-, WebP-, AVIF- eller SVG-logga. Exporteras och visas endast för rekryteringsannonser.

Valfria länkar: `companyWebsite`, `applicationUrl`. Bara https och mailto accepteras. Beskrivningen renderas som text, inte HTML.

`expiresAt`: ISO 8601-tidpunkt med tidszon för annonsens slut. För ogiltigt datum publiceras inget. `deadline` är endast visningstext; ATS:et behöver också sätta `expiresAt` för automatisk avpublicering.

## Implementerat nu

- Två karriärflikar med tangentbordsstöd och antal annonser. Rekrytering är förstavalet.
- Företagsloggor i rekryteringslistan och kategorifilter under konsultuppdrag.
- Annonsvy per stabilt ID på `/jobb/?id=<id>`, med egen rubrik, beskrivning och ansökningslänk. ID:t ändras inte när annonstexten redigeras.
- Länkikon öppnar annonsvyn. Kopieringsknappen kopierar absolut URL på den publicerade webbplatsens domän. I HTML-utkastet kopieras endast annonsvägen och en förklaring visas. Utkastet är inte en offentlig karriärsida.
- Kontakt via mejl om ingen ansökningslänk finns.
- Tomt läge, felläge och läge för avslutad/ej tillgänglig annons.
- Separat exportfunktion med vitlista för fält samt test av dolda/avslutade/utgångna uppdrag och hemliga fält.

## Återstår

- Själva ATS:et, inloggning och behörigheter.
- Publiceringsknappen och annonsförhandsgranskningen i ATS:et.
- Autentiserad överföring eller en publik endpoint som bara innehåller godkända annonser.
- Publicering/avpublicering direkt från ATS utan manuell koddistribution.
- Ansökningsformulär, CV-hantering och tillhörande integritetsinformation om de ska ligga i eget system.
