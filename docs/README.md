# Codex Specification Package — Self-Evolving AI Desktop Platform

Dieses Archiv ist eine selbstständige Spezifikation für Codex. Kopieren/Sie extrahieren Sie es in die Wurzel eines neuen Projekts und bitten Sie Codex, zuerst `AGENTS.md` und `CODEX_PROMPT.md` zu lesen, dann alle referenzierten Spezifikationsdateien.

Die Anwendung beginnt als leere, plattformübergreifende Arbeitsumgebung mit einem rechtsseitigen Chat, der mit LM Studio verbunden ist. Benutzeranforderungen werden als TypeScript/JavaScript-Plugins implementiert. Die zentrale Zuverlässigkeitsanforderung besteht darin, dass generierte Fehler isoliert sind und automatisch an einen begrenzten AI-Reparatur-Agent übergeben werden, während der stabile Core und die Wiederherstellung/Chat-Schnittstelle weiterhin verfügbar bleiben.

## Projektstruktur

Das Projekt folgt einer klaren Architektur mit den folgenden Verzeichnissen:

- `core/`: Enthält den stabilen Kern der Anwendung
- `plugins/`: Speichert alle Plugins und deren Manifeste
- `sdk/`: Bietet APIs für Plugin-Entwicklung
- `ui/`: Enthält die Benutzeroberfläche
- `utils/`: Hilfsfunktionen wie Logger und Datenbank

## Empfohlener erster Codex-Befehl nach dem Extrahieren:

> Lesen Sie AGENTS.md, CODEX_PROMPT.md und alle Spezifikations-Markdown-Dateien vollständig. Beginnen Sie mit Phase 0. Erstellen Sie docs/ARCHITECTURE.md und docs/ROADMAP.md, bevor Sie Anwendungscode schreiben, dann implementieren Sie schrittweise, während das Projekt baubar bleibt.
