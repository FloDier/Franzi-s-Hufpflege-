# Franzi's Hufpflege – Kunden & Termine

Web-App für Kundenverwaltung (Stall, Besitzer, Pferde, Anfahrt) und Terminbuchung mit Kunden-Bereich per QR-Code.
Läuft komplett im Browser, ohne Server, ohne Konto. Daten liegen lokal im Browser-Speicher des Geräts.

## Starten
- Über GitHub Pages: `https://flodier.github.io/Franzi-s-Hufpflege-/` (Groß-/Kleinschreibung beachten! GitHub Pages im Repo unter Settings → Pages aktivieren, Branch `main`)
- Auf dem iPhone/Android: Seite öffnen → „Zum Home-Bildschirm“. Das ist auf dem iPhone wichtig, weil Safari den Speicher
  von Webseiten löschen kann, die länger als 7 Tage nicht besucht wurden.

## Ablauf
1. **Einstellungen**: Name, WhatsApp-Nummer, E-Mail, Arbeitszeiten, Minuten pro Pferd, Puffer für die Anfahrt, Urlaub.
2. **Kunden** anlegen: Besitzer, Stall, beide Anschriften, Telefon, E-Mail, Pferde (Anzahl wird gezählt), Anfahrtsweg.
3. **Neuer Termin**: Kunde wählen → freie Tage grün → freie Uhrzeiten grün → speichern → per WhatsApp/E-Mail senden.
4. **QR / Link**: QR-Code erzeugen und drucken oder teilen. Kunden scannen ihn, wählen Tag + Uhrzeit und buchen.
   Die Buchung kommt als WhatsApp/E-Mail mit einem Link an. Ein Tipp auf den Link trägt den Termin ein (inkl. Kollisionsprüfung).

## Grenzen dieser Version (ohne Server)
- Der QR-Code enthält die freien Zeiten **zum Zeitpunkt der Erzeugung**. Nach neuen Terminen neu erzeugen.
  Ein dauerhaft aufgehängter QR-Code mit Live-Verfügbarkeit braucht einen Online-Speicher (z. B. Supabase/Firebase).
- Bucht ein zweiter Kunde dieselbe Lücke, bevor der erste übernommen wurde, meldet die App beim Übernehmen die Überschneidung.
  Über „Ablehnen & neuen Link senden“ bekommt der Kunde sofort aktuelle Zeiten.
- Datensicherung: Einstellungen → „Sicherung herunterladen“ (JSON), regelmäßig in die Cloud legen.

## Datenschutz
Kundendaten verlassen das Gerät nur in Nachrichten, die Sie selbst senden. Die Kundendaten im Buchungslink stehen hinter `#`
und werden dadurch nicht an den Webserver übertragen.

QR-Code-Bibliothek: `qrcode.js` von Kazuhiko Arase (MIT-Lizenz).
