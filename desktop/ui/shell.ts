export function mountShell(root: HTMLElement): void {
  root.innerHTML = `
    <div class="app-shell" data-mobile-view="workspace">
      <header class="topbar">
        <div class="topbar__brand">
          <span class="brand-mark" aria-hidden="true">W</span>
          <span class="brand-name">Workshop</span>
          <span class="local-label">LOKALER ARBEITSBEREICH</span>
        </div>
        <div class="topbar__actions">
          <span class="connection-pill" id="connection-pill" role="status">
            <span class="connection-dot" aria-hidden="true"></span>
            <span id="connection-label">Verbindung wird geprüft</span>
          </span>
            <button class="button button--quiet" id="command-open" type="button" aria-keyshortcuts="Control+K Meta+K">
            Befehle <kbd>⌘ K</kbd>
          </button>
          <button class="button button--quiet" id="settings-open" type="button">Einstellungen</button>
        </div>
        <nav class="mobile-tabs" aria-label="Bereich auswählen">
          <button class="mobile-tab is-active" type="button" data-view="workspace" aria-current="page">Arbeitsbereich</button>
          <button class="mobile-tab" type="button" data-view="chat">KI-Chat</button>
        </nav>
      </header>

      <main class="workspace" id="workspace-panel" aria-labelledby="workspace-title">
        <div class="workspace__inner">
          <div class="workspace__heading">
            <p class="eyebrow">DEIN ARBEITSBEREICH</p>
            <h1 id="workspace-title">Was möchtest du<br /><span>zum Leben erwecken?</span></h1>
            <p class="workspace__intro">Beginne mit einer Idee. Dein Arbeitsbereich wächst Schritt für Schritt mit dir.</p>
          </div>
          <section class="empty-state" id="workspace-empty-state" aria-label="Arbeitsbereich ist leer">
            <div class="empty-state__glyph" aria-hidden="true">
              <span class="glyph-orbit glyph-orbit--one"></span>
              <span class="glyph-orbit glyph-orbit--two"></span>
              <span class="glyph-core"></span>
            </div>
            <h2>Hier ist noch Platz.</h2>
            <p>Stell deinem lokalen Modell eine Frage oder beschreibe, was du bauen möchtest.</p>
            <button class="button button--primary" id="workspace-start" type="button">Mit dem KI-Chat beginnen</button>
          </section>
          <section class="notes-panel" id="demo-notes-panel" aria-labelledby="notes-title" hidden>
            <div class="notes-panel__heading">
              <div>
                <p class="eyebrow">ERWEITERUNG</p>
                <h2 id="notes-title">Notizen</h2>
                <p>Deine Notizen werden lokal auf diesem Gerät gespeichert.</p>
              </div>
            </div>
            <form class="note-form" id="note-form">
              <label class="field" for="note-input">
                <span id="note-form-label">Neue Notiz</span>
                <textarea id="note-input" name="text" rows="3" maxlength="2000" placeholder="Was möchtest du festhalten?" required></textarea>
              </label>
              <div class="note-form__actions">
                <p class="phase-note" id="note-feedback" role="status"></p>
                <div>
                  <button class="button button--quiet" id="note-cancel" type="button" hidden>Abbrechen</button>
                  <button class="button button--primary" id="note-submit" type="submit">Notiz speichern</button>
                </div>
              </div>
            </form>
            <ol class="note-list" id="note-list" aria-label="Gespeicherte Notizen"></ol>
          </section>
          <section class="notes-panel staged-runtime-panel" id="staged-runtime-panel" aria-labelledby="staged-runtime-title" hidden>
            <div class="notes-panel__heading">
              <div>
                <p class="eyebrow">SANDBOX-ERWEITERUNG</p>
                <h2 id="staged-runtime-title">Staging-Plugin</h2>
                <p id="staged-runtime-status" role="status"></p>
              </div>
            </div>
            <div class="plugin-preview" id="staged-runtime-mount" aria-label="Aktive Staging-Erweiterung"></div>
          </section>
          <div class="workspace__footnote">
            <span class="footnote-dot" aria-hidden="true"></span>
            <span>Deine Unterhaltung bleibt auf diesem Gerät.</span>
          </div>
        </div>
      </main>

      <button class="rail-resizer" id="rail-resizer" type="button" role="separator" aria-orientation="vertical" aria-label="Chatbreite ändern" aria-valuemin="300" aria-valuemax="520" tabindex="0"></button>

      <aside class="chat-panel" id="chat-panel" aria-label="KI-Chat">
        <header class="chat-header">
          <div class="chat-header__title">
            <span class="eyebrow">DEIN LOKALES MODELL</span>
            <h2>Unterhaltung</h2>
          </div>
          <div class="chat-header__actions">
            <button class="button button--quiet button--small" id="chat-clear" type="button" aria-label="Unterhaltung leeren">Neue Unterhaltung</button>
            <button class="button button--quiet button--small rail-toggle" id="rail-toggle" type="button" aria-label="Chatbereich einklappen" aria-expanded="true">Einklappen</button>
          </div>
        </header>

        <div class="provider-notice" id="provider-notice" hidden>
          <div>
            <strong id="provider-notice-title">LM Studio ist nicht erreichbar</strong>
            <p id="provider-notice-copy">Starte den lokalen Server oder prüfe die Verbindungseinstellungen.</p>
          </div>
          <div class="notice-actions">
            <button class="button button--quiet button--small" id="provider-retry" type="button">Erneut versuchen</button>
            <button class="button button--quiet button--small" id="notice-settings" type="button">Einstellungen</button>
          </div>
        </div>

        <section class="messages" id="messages" role="log" aria-label="Nachrichtenverlauf" aria-live="off" aria-relevant="additions text">
          <div class="chat-welcome" id="chat-welcome">
            <span class="chat-welcome__orb" aria-hidden="true"></span>
            <h3>Womit fangen wir an?</h3>
            <p>Schreib eine Nachricht an dein lokales Modell. Die Unterhaltung wird auf diesem Gerät gespeichert.</p>
            <button class="suggestion" type="button" data-prompt="Ich möchte eine einfache Notizen-App. Welche Schritte empfiehlst du?">„Ich brauche eine Notizen-App“</button>
            <button class="suggestion" type="button" data-prompt="Hilf mir, meine Idee in kleine, umsetzbare Schritte zu teilen.">„Hilf mir, meine Idee zu sortieren“</button>
          </div>
          <div class="message-list" id="message-list"></div>
        </section>

        <form class="composer" id="chat-form">
          <label class="sr-only" for="chat-input">Nachricht an das lokale Modell</label>
          <textarea id="chat-input" name="message" rows="3" maxlength="12000" placeholder="Schreib eine Nachricht …" autocomplete="off" required></textarea>
          <div class="composer__footer">
            <span class="composer__hint" id="composer-hint">Enter zum Senden · Shift + Enter für eine neue Zeile</span>
            <button class="button button--quiet button--small" id="chat-stop" type="button" hidden>Antwort anhalten</button>
            <button class="send-button" id="chat-send" type="submit" aria-label="Nachricht senden">Senden</button>
          </div>
        </form>
        <p class="privacy-note">Lokal auf deinem Gerät gespeichert</p>
      </aside>

      <dialog class="settings-dialog" id="settings-dialog" aria-labelledby="settings-title">
        <form class="dialog-form" id="settings-form">
          <div class="dialog-heading">
            <div>
              <p class="dialog-eyebrow">WORKSHOP</p>
              <h2 class="dialog-title" id="settings-title">Einstellungen</h2>
            </div>
            <button class="button button--quiet close-dialog" type="button" aria-label="Einstellungen schließen">Schließen</button>
          </div>
          <div class="settings-body">
          <section class="settings-section" aria-labelledby="provider-title">
            <div class="section-heading">
              <h3 id="provider-title">KI-Anbieter</h3>
              <p>OpenAI-kompatibler Endpunkt. Standardmäßig läuft alles über LM Studio auf diesem Gerät.</p>
            </div>
            <label class="field" for="setting-url">
              <span>Serveradresse</span>
              <input id="setting-url" name="apiBaseUrl" type="url" autocomplete="url" required maxlength="2048" />
              <span class="field-hint">Zum Beispiel http://127.0.0.1:1234/v1</span>
            </label>
            <label class="field" for="setting-model">
              <span>Modell</span>
              <input id="setting-model" name="model" list="available-models" maxlength="240" autocomplete="off" placeholder="Modell-ID eingeben oder auswählen" />
              <datalist id="available-models"></datalist>
              <span class="field-hint" id="model-hint">Wähle das Modell, das im lokalen Server geladen ist.</span>
            </label>
            <label class="field" for="setting-api-key">
              <span>API-Schlüssel <span class="field-optional">optional</span></span>
              <input id="setting-api-key" name="apiKey" type="password" autocomplete="off" maxlength="4096" placeholder="Wird nur während dieser Sitzung gehalten" />
              <span class="field-hint">Der Schlüssel wird nicht in Chat, Verlauf oder Anwendungsspeicher geschrieben.</span>
            </label>
            <div class="field-grid">
              <label class="field" for="setting-temperature">
                <span>Temperatur <output id="temperature-value" for="setting-temperature">0,7</output></span>
                <input id="setting-temperature" name="temperature" type="range" min="0" max="2" step="0.1" />
                <span class="field-hint">Niedriger bedeutet gleichmäßigere Antworten.</span>
              </label>
              <label class="field" for="setting-timeout">
                <span>Zeitlimit</span>
                <select id="setting-timeout" name="timeoutMs">
                  <option value="30000">30 Sekunden</option>
                  <option value="60000">1 Minute</option>
                  <option value="120000">2 Minuten</option>
                  <option value="180000">3 Minuten</option>
                </select>
                <span class="field-hint">Zeit für eine Antwort des Modells.</span>
              </label>
            </div>
            <div class="inline-check-row">
              <p id="settings-connection-status" role="status">Verbindung noch nicht geprüft.</p>
              <button class="button button--quiet" id="settings-retry" type="button">Verbindung testen</button>
            </div>
          </section>
          <section class="settings-section" aria-labelledby="development-title">
            <div class="section-heading">
              <h3 id="development-title">Entwicklungsmodus</h3>
              <p>Legt fest, wie Workshop spätere Änderungen vorbereiten soll.</p>
            </div>
            <label class="field" for="setting-mode">
              <span>Modus</span>
              <select id="setting-mode" name="developmentMode">
                <option value="safe">Sicher · Änderungen erst nach Bestätigung</option>
                <option value="normal">Normal · prüfen und anschließend fragen</option>
                <option value="autonomous">Autonom · innerhalb der Sicherheitsgrenzen</option>
              </select>
              <span class="field-hint">Autonomer Modus überspringt niemals Validierung oder Sicherheitsgrenzen.</span>
            </label>
            <label class="field" for="setting-repair-budget">
              <span>Automatische Reparaturversuche pro Plugin und App-Sitzung</span>
              <select id="setting-repair-budget" name="stagedRepairAttemptLimit">
                <option value="0">Keine automatischen Reparaturversuche</option>
                <option value="1">1 Versuch</option>
                <option value="2">2 Versuche</option>
                <option value="3">3 Versuche</option>
              </select>
              <span class="field-hint">Jeder Austausch, Testlauf und Canary braucht weiterhin eine eigene Bestätigung.</span>
            </label>
            <p class="phase-note">Die Unterhaltung ist aktiv. Änderungen an der Anwendung werden erst mit dem validierten Plugin-Workflow angewendet.</p>
          </section>
          <section class="settings-section" id="workspace-access-section" aria-labelledby="workspace-access-title" hidden>
            <div class="section-heading">
              <h3 id="workspace-access-title">Projektzugriff</h3>
              <p>Der Assistent kann im ausgewählten Ordner Quelltext suchen und begrenzt lesen. Projektinhalte werden nur an einen lokalen Modellserver gesendet.</p>
            </div>
            <p class="phase-note" id="workspace-root-status" role="status">Kein Projektordner ausgewählt.</p>
            <div class="inline-check-row">
              <button class="button button--quiet" id="workspace-select" type="button">Projektordner auswählen</button>
              <button class="button button--quiet" id="workspace-clear" type="button" hidden>Ordner entfernen</button>
            </div>
          </section>
          <section class="settings-section" aria-labelledby="plugins-title">
            <div class="section-heading">
              <h3 id="plugins-title">Erweiterungen</h3>
              <p>Aktiviere lokale Erweiterungen hier. Ihre Daten bleiben in einem eigenen Speicherbereich.</p>
            </div>
            <p class="phase-note" id="plugin-feedback" role="status"></p>
            <ol class="plugin-list" id="plugin-list" aria-label="Installierte Erweiterungen"></ol>
          </section>
          <section class="settings-section" id="staging-plugin-section" aria-labelledby="staging-plugin-title" hidden>
            <div class="section-heading">
              <h3 id="staging-plugin-title">Plugin-Vorschau</h3>
              <p>Prüfe Plugins isoliert, installiere akzeptierte Versionen lokal oder aktiviere sie für diese Sitzung. Installierte Plugins starten nach einem Neustart nie automatisch.</p>
            </div>
            <label class="field" for="staging-plugin-select">
              <span>Staging-Kopie</span>
              <select id="staging-plugin-select" aria-describedby="staging-plugin-hint"></select>
              <span class="field-hint" id="staging-plugin-hint">Erwartet werden workshop-plugin.json und ein gebündelter plugin.js-Einstieg.</span>
            </label>
            <div class="inline-check-row">
              <p class="phase-note" id="staging-plugin-feedback" role="status" aria-live="polite"></p>
              <button class="button button--quiet" id="staging-plugin-open" type="button" disabled>Vorschau öffnen</button>
            </div>
            <div class="plugin-list__actions">
              <button class="button button--quiet" id="staging-plugin-validate" type="button" disabled>Akzeptanzprüfung</button>
              <button class="button button--primary" id="staging-plugin-activate" type="button" disabled>Regulär aktivieren</button>
              <button class="button button--quiet" id="staging-plugin-install" type="button" disabled>Dauerhaft installieren</button>
              <button class="button button--quiet" id="staging-plugin-reload" type="button" disabled>Hot Reload</button>
              <button class="button button--quiet" id="staging-plugin-deactivate" type="button" disabled>Deaktivieren</button>
            </div>
            <div class="settings-section__subsection" aria-labelledby="staging-installed-title">
              <div class="section-heading">
                <h4 id="staging-installed-title">Installierte Staging-Plugins</h4>
                <p>Installierte Dateien bleiben lokal erhalten. Nach einem Neustart wird kein Plugin automatisch ausgeführt; jede Aktivierung braucht eine neue Bestätigung.</p>
              </div>
              <label class="field" for="staging-installed-select">
                <span>Installiertes Plugin</span>
                <select id="staging-installed-select" aria-label="Installiertes Staging-Plugin"></select>
              </label>
              <div class="plugin-list__actions">
                <button class="button button--quiet" id="staging-installed-activate" type="button" disabled>Installiertes Plugin aktivieren</button>
                <button class="button button--quiet" id="staging-installed-remove" type="button" disabled>Installation entfernen</button>
              </div>
            </div>
            <ol class="plugin-list" id="staging-plugin-checks" aria-label="Plugin-Akzeptanzprüfungen"></ol>
            <div class="plugin-preview" id="staging-plugin-preview" aria-label="Isolierte Plugin-Vorschau" hidden></div>
          </section>
          <section class="settings-section" aria-labelledby="incident-title">
            <div class="section-heading">
              <h3 id="incident-title">Zuverlässigkeit</h3>
              <p>Vorfälle werden lokal gespeichert. Technische Einzelheiten oder Chat-Inhalte werden nicht protokolliert.</p>
            </div>
            <p class="phase-note" id="safe-mode-status" role="status" hidden>Der sichere Modus ist aktiv. Erweiterungen bleiben deaktiviert.</p>
            <button class="button button--quiet" id="safe-mode-clear" type="button" hidden>Sicheren Modus verlassen</button>
            <ol class="incident-list" id="incident-list" aria-label="Letzte Vorfälle"></ol>
          </section>
          </div>
          <footer class="dialog-footer">
            <span class="save-feedback" id="save-feedback" role="status"></span>
            <button class="button button--quiet close-dialog" type="button">Abbrechen</button>
            <button class="button button--primary" type="submit">Einstellungen speichern</button>
          </footer>
        </form>
      </dialog>

      <dialog class="palette-dialog" id="command-dialog" aria-labelledby="command-title">
        <div class="command-box">
          <h2 class="sr-only" id="command-title">Workshop-Befehle</h2>
          <label class="sr-only" for="command-input">Befehle filtern</label>
          <input id="command-input" type="search" placeholder="Was möchtest du tun?" autocomplete="off" />
          <div class="command-list" id="command-list" role="listbox" aria-label="Verfügbare Befehle">
            <button class="command-item" type="button" role="option" data-command="chat">
              <span>Zum KI-Chat wechseln</span><kbd>↵</kbd>
            </button>
            <button class="command-item" type="button" role="option" data-command="settings">
              <span>Einstellungen öffnen</span><kbd>S</kbd>
            </button>
            <button class="command-item" type="button" role="option" data-command="retry">
              <span>Verbindung erneut prüfen</span><kbd>R</kbd>
            </button>
            <button class="command-item" type="button" role="option" data-command="clear">
              <span>Neue Unterhaltung beginnen</span><kbd>N</kbd>
            </button>
          </div>
          <div class="command-footer"><span>Mit ↑ ↓ navigieren</span><span><kbd>Esc</kbd> Schließen</span></div>
        </div>
      </dialog>
      <div class="visually-hidden" id="announcer" role="status" aria-live="polite"></div>
    </div>
  `
}
