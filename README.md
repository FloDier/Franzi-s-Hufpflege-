# Franzi's Hufpflege – Kunden & Termine

Web-App für Kundenverwaltung (Stall, Besitzer, Pferde, Anfahrt) und Terminbuchung mit Kunden-Bereich per QR-Code.
Läuft komplett im Browser, ohne Server, ohne Konto. Daten liegen lokal im Browser-Speicher des Geräts.

## Zwei getrennte Seiten
| Seite | Adresse | Für wen |
|---|---|---|
| **Visitenkarte** | `https://flodier.github.io/Franzi-s-Hufpflege-/` | Ziel des gedruckten QR-Codes: Anrufen, WhatsApp, Kontakt speichern, Termin buchen |
| **Termin buchen** | `…/buchen.html` | Kunden: freie Tage/Uhrzeiten wählen und buchen |
| **Verwaltung** | `…/verwaltung.html` | Franzi + zweite Person: Kunden, Termine, QR, Einstellungen |
| Impressum / Datenschutz | `…/impressum.html`, `…/datenschutz.html` | werden aus `kontakt.js` befüllt |

Kontaktdaten für Visitenkarte, „Kontakt speichern“ und Impressum stehen in **`kontakt.js`**.
Den Druck-QR-Code (SVG für die Druckerei, PNG 2000 px) gibt es in der Verwaltung unter „QR / Link“.

Groß-/Kleinschreibung der Adresse beachten. Die Verwaltung aufs Handy legen: Seite öffnen → Teilen → „Zum Home-Bildschirm“
(auf dem iPhone wichtig, damit Safari die Daten nicht nach 7 Tagen Nichtbenutzung löscht).
Wer auf diesem Gerät schon Verwaltungsdaten hat und die Hauptadresse öffnet, wird automatisch zur Verwaltung weitergeleitet.

Dateien: `index.html` (Visitenkarte), `buchen.html`, `verwaltung.html`, `impressum.html`, `datenschutz.html`, `kontakt.js`, `app.js` (gemeinsamer Code), `style.css`, `config.js` (Online-Zugang),
`qrcode.js`, Logo-Bilder, `firestore.rules`, `firebase/` (Firebase-Bibliothek, Apache-2.0).

## Ablauf
1. **Einstellungen**: Name, WhatsApp-Nummer, E-Mail, Arbeitszeiten, Minuten pro Pferd, Puffer für die Anfahrt, Urlaub.
2. **Kunden** anlegen: Besitzer, Stall, beide Anschriften, Telefon, E-Mail, Pferde (Anzahl wird gezählt), Anfahrtsweg.
3. **Neuer Termin** (Verwaltung): Kunde wählen → freie Tage grün → freie Uhrzeiten grün → speichern → per WhatsApp/E-Mail senden.
4. **QR / Link**: QR-Code erzeugen und drucken oder teilen. Kunden scannen ihn, wählen Tag + Uhrzeit und buchen.
   Die Buchung kommt als WhatsApp/E-Mail mit einem Link an. Ein Tipp auf den Link trägt den Termin ein (inkl. Kollisionsprüfung).

## Zwei Geräte + Live-Buchung (Online-Speicher Google Firebase / Firestore)
Ohne Einrichtung läuft die App nur lokal auf einem Gerät. Mit Firestore teilen sich zwei Personen alle Kunden und Termine
(Änderungen erscheinen sofort auf dem anderen Gerät, auch offline wird weitergearbeitet), und Kunden sehen über
„Termin buchen“ immer die aktuellen freien Zeiten. Doppelbuchungen werden verhindert.

Einmalige Einrichtung (ca. 15 Minuten), im selben Google-Konto wie die Essensliste, aber als **eigenes Projekt**:
1. console.firebase.google.com → **Projekt hinzufügen** → Name z. B. `franzis-hufpflege` (Google Analytics nicht nötig).
2. **Firestore** → **Datenbank erstellen** → Standort **`europe-west3` (Frankfurt)** → Produktionsmodus.
   ⚠️ Der Standort lässt sich später nicht mehr ändern.
3. **Authentication** → Jetzt starten → Anmeldemethode **E-Mail/Passwort** aktivieren →
   Reiter **Nutzer** → zwei Nutzer anlegen (Franzi + zweite Person).
4. **Firestore → Regeln**: Inhalt von `firestore.rules` einfügen, die zwei Platzhalter `TEAM_EMAIL_1/2` durch die
   E-Mail-Adressen aus Schritt 3 ersetzen (klein geschrieben) → **Veröffentlichen**.
   Nur diese zwei Konten sehen Kunden und Termine. Kunden ohne Anmeldung sehen nur „belegt“ (ohne Namen) und dürfen buchen.
5. **Projekteinstellungen → Allgemein → Meine Apps → Web-App (`</>`)** hinzufügen → den Block `firebaseConfig`
   (apiKey, authDomain, projectId …) in `config.js` eintragen. Diese Werte dürfen öffentlich sein.
6. Datenschutz: In den Projekteinstellungen die Bedingungen zur Datenverarbeitung (Data Processing Terms) akzeptieren.

Danach auf beiden Geräten `…/verwaltung.html` öffnen und anmelden. Daten, die schon lokal auf einem Gerät liegen,
werden bei der ersten Anmeldung automatisch hochgeladen.

## Für Kunden: Termin verwalten, Kalender, Erinnerungen
- Jede Bestätigung enthält einen persönlichen Link „Termin verwalten“ (`buchen.html#t=…`, nicht erratbar).
  Darüber kann der Kunde den Termin in seinen Kalender eintragen (mit Erinnerung 1 Tag und 2 Stunden vorher),
  **stornieren** oder **umbuchen** – bis 3 Stunden vor dem Termin. Die Frist prüft die Datenbank selbst.
- Stornos und Umbuchungen erscheinen sofort in der Verwaltung („Vom Kunden storniert“ bzw. „Vom Kunden umgebucht“).
- Unter „Termine“ zeigt „Erinnerungen fällig“ die Termine von morgen und heute; ein Tipp öffnet WhatsApp mit fertigem Text.

## Rechnungen
- Beim Kunden auf **🧾 Rechnung**: Anschrift, Pferde und Preise (Standardpreis oder Preis je Pferd) werden übernommen,
  optional Anfahrtspauschale, Zahlung per Überweisung oder bar. Ergebnis: PDF zum Teilen (WhatsApp, Mail) oder Speichern.
- Rechnungsdaten unter ⚙️ Einstellungen → Rechnungen (Name, Anschrift, Steuernummer, Kleinunternehmerin/USt, Bankdaten).
  Solange Pflichtangaben fehlen, entstehen nur **Entwürfe ohne Nummer**.
- Fortlaufende Rechnungsnummern (z. B. 2026-001), auch bei zwei Geräten eindeutig. Rechnungen sind danach nicht mehr
  änderbar (nur Status offen/bezahlt) und nicht löschbar; Korrektur über **Storno** (Stornorechnung mit eigener Nummer).
- PDF-Bibliothek: `vendor/jspdf.umd.min.js` (jsPDF, MIT-Lizenz).

## Ohne Online-Speicher (nur lokal)
- Der QR-Code enthält die freien Zeiten zum Zeitpunkt der Erzeugung. Nach neuen Terminen neu erzeugen.
- Buchungen kommen als WhatsApp/E-Mail mit Link. Ein Tipp darauf trägt den Termin ein (mit Überschneidungs-Warnung).
- Datensicherung: Einstellungen → „Sicherung herunterladen“ (JSON), regelmäßig in die Cloud legen.

## Datenschutz
Ohne Online-Speicher verlassen Kundendaten das Gerät nur in Nachrichten, die Sie selbst senden. Mit Firestore liegen sie in der EU (Frankfurt), Zugriff nur für die zwei freigeschalteten Konten. Die Kundendaten im Buchungslink stehen hinter `#`
und werden dadurch nicht an den Webserver übertragen.

QR-Code-Bibliothek: `qrcode.js` von Kazuhiko Arase (MIT-Lizenz).
