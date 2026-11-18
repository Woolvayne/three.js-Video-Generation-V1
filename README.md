## Video-Editor

`npm ci && npm run dev` startet den Editor. Unter **♫ Sprecher laden** lässt sich eine lokale WAV- oder MP3-Datei als durchgehende Tonspur verwenden. Sie startet bei Filmzeit 0, folgt Pause und Wiedereinstieg und wird bei der Videoaufnahme mitgeschnitten. Ohne Datei bleibt der Film stumm. Die Datei wird nicht hochgeladen und nach einem Neuladen nicht gespeichert.

### Deutsche Sprecherfassung mit Fish Audio

1. Python 3.9+ und einen Fish-Audio-API-Zugang bereitstellen. `FISH_AUDIO_API_KEY` nur **lokal als Umgebungsvariable** setzen, nicht im Frontend oder in Git. Optional `FISH_AUDIO_REFERENCE_ID` für eine zur Nutzung freigegebene Stimme und `FISH_AUDIO_MODEL` für ein anderes unterstütztes Modell setzen.
2. `python3 scripts/fish_voice.py` im Projektordner starten. Der Aufruf sendet die Untertitel an Fish Audio (eine potenziell kostenpflichtige Synthese pro Szene). Das Skript ergänzt Stille bis zum nächsten Szenenbeginn. Zu lange Clips werden gemeldet statt abgeschnitten.
3. `sprecherspur.wav` über **♫ Sprecher laden** auswählen und die Vorschau starten. Die Ausgabeformate für die Aufnahme hängen vom Browser ab.
