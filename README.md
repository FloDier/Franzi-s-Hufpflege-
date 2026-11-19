# Franzi's Hufpflege – Kunden & Termine

Web-App für Kundenverwaltung (Stall, Besitzer, Pferde, Anfahrt) und Terminbuchung mit Kunden-Bereich per QR-Code.
Läuft komplett im Browser, ohne Server, ohne Konto. Daten liegen lokal im Browser-Speicher des Geräts.

## Zwei getrennte Seiten
| Seite | Adresse | Für wen |
|---|---|---|
| **Kundenseite** | `https://flodier.github.io/Franzi-s-Hufpflege-/` | Kunden: Termin buchen (Ziel des QR-Codes) |
| **Verwaltung** | `https://flodier.github.io/Franzi-s-Hufpflege-/verwaltung.html` | Franzi + zweite Person: Kunden, Termine, QR, Einstellungen |

Groß-/Kleinschreibung der Adresse beachten. Die Verwaltung aufs Handy legen: Seite öffnen → Teilen → „Zum Home-Bildschirm“
(auf dem iPhone wichtig, damit Safari die Daten nicht nach 7 Tagen Nichtbenutzung löscht).
Wer auf diesem Gerät schon Verwaltungsdaten hat und die Hauptadresse öffnet, wird automatisch zur Verwaltung weitergeleitet.

Dateien: `index.html` (Kundenseite), `verwaltung.html`, `app.js` (gemeinsamer Code), `style.css`, `config.js` (Online-Zugang),
`qrcode.js`, Logo-Bilder, `supabase/setup.sql`.

## Ablauf
1. **Einstellungen**: Name, WhatsApp-Nummer, E-Mail, Arbeitszeiten, Minuten pro Pferd, Puffer für die Anfahrt, Urlaub.
2. **Kunden** anlegen: Besitzer, Stall, beide Anschriften, Telefon, E-Mail, Pferde (Anzahl wird gezählt), Anfahrtsweg.
3. **Neuer Termin** (Verwaltung): Kunde wählen → freie Tage grün → freie Uhrzeiten grün → speichern → per WhatsApp/E-Mail senden.
4. **QR / Link**: QR-Code erzeugen und drucken oder teilen. Kunden scannen ihn, wählen Tag + Uhrzeit und buchen.
   Die Buchung kommt als WhatsApp/E-Mail mit einem Link an. Ein Tipp auf den Link trägt den Termin ein (inkl. Kollisionsprüfung).

## Zwei Geräte + Live-QR-Code (Online-Speicher Supabase)
Ohne Einrichtung läuft die App nur lokal auf einem Gerät. Mit Supabase teilen sich zwei Personen alle Kunden und Termine,
und der QR-Code am Stall zeigt immer die aktuellen freien Zeiten. Doppelbuchungen verhindert der Server.

Einmalige Einrichtung (ca. 15 Minuten):
1. Auf supabase.com ein kostenloses Konto anlegen → **New project**, Region **Frankfurt (eu-central-1)**.
2. Links **SQL Editor** → neue Abfrage → kompletten Inhalt von `supabase/setup.sql` einfügen → **Run**.
3. **Authentication → Sign In / Providers**: „Allow new users to sign up“ **ausschalten**.
   ⚠️ Wichtig! Sonst könnte sich jeder selbst ein Konto anlegen und Kundendaten lesen.
4. **Authentication → Users → Add user**: je ein Benutzer für Franzi und die zweite Person (E-Mail + Passwort, „Auto confirm“).
5. **Project Settings → API**: „Project URL“ und den „anon“ bzw. „publishable“ Key in `config.js` eintragen.
   (Dieser Schlüssel darf öffentlich sein. Passwörter und den „service_role“/„secret“ Key niemals eintragen oder weitergeben!)
6. Datenschutz: Mit Supabase den Auftragsverarbeitungsvertrag (DPA/AVV) abschließen und im Datenschutzhinweis erwähnen.

Danach auf beiden Geräten die App öffnen und anmelden. Daten, die schon lokal auf einem Gerät liegen, werden bei der
ersten Anmeldung automatisch hochgeladen. Ohne Netz wird weitergearbeitet. Änderungen werden gesendet, sobald wieder Verbindung besteht.

Kostenlose Supabase-Projekte werden nach längerer Inaktivität pausiert. Bei regelmäßiger Nutzung passiert das nicht.

## Ohne Online-Speicher (nur lokal)
- Der QR-Code enthält die freien Zeiten zum Zeitpunkt der Erzeugung. Nach neuen Terminen neu erzeugen.
- Buchungen kommen als WhatsApp/E-Mail mit Link. Ein Tipp darauf trägt den Termin ein (mit Überschneidungs-Warnung).
- Datensicherung: Einstellungen → „Sicherung herunterladen“ (JSON), regelmäßig in die Cloud legen.

## Datenschutz
Ohne Online-Speicher verlassen Kundendaten das Gerät nur in Nachrichten, die Sie selbst senden. Mit Supabase liegen sie in der EU (Frankfurt), Zugriff nur für angemeldete Benutzer. Die Kundendaten im Buchungslink stehen hinter `#`
und werden dadurch nicht an den Webserver übertragen.

QR-Code-Bibliothek: `qrcode.js` von Kazuhiko Arase (MIT-Lizenz).
