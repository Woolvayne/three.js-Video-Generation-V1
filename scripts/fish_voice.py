"""Generate a scene-aligned PCM narration track using Fish Audio, without dependencies."""
import io
import json
import os
import sys
import wave
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def generate():
    key = os.environ.get('FISH_AUDIO_API_KEY')
    if not key:
        sys.exit('FISH_AUDIO_API_KEY fehlt. Siehe README.md.')
    scenes = json.loads((Path(__file__).resolve().parents[1] / 'src/timeline.json').read_text())
    audio = bytearray()
    fmt = None
    for scene in scenes:
        payload = {'text': ' '.join(scene['subtitle']), 'format': 'wav'}
        if ref := os.environ.get('FISH_AUDIO_REFERENCE_ID'):
            payload['reference_id'] = ref
        req = Request('https://api.fish.audio/v1/tts', data=json.dumps(payload).encode(), headers={
            'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json',
            'model': os.environ.get('FISH_AUDIO_MODEL', 's2-pro')})
        print(scene['label'], flush=True)
        with urlopen(req, timeout=120) as response, wave.open(io.BytesIO(response.read())) as clip:
            layout = (clip.getnchannels(), clip.getsampwidth(), clip.getframerate())
            if fmt not in (None, layout) or layout[1] != 2:
                sys.exit('Unerwartetes Audioformat (16-bit PCM erwartet).')
            fmt = layout
            segment = clip.readframes(clip.getnframes())
            capacity = scene['duration'] * fmt[0] * fmt[1] * fmt[2]
            if len(segment) > capacity:
                sys.exit(f"Sprechertext für {scene['label']} zu lang. Bitte kürzen.")
            audio.extend(segment)
            audio.extend(bytes(capacity - len(segment)))
    with wave.open('sprecherspur.wav', 'wb') as out:
        out.setparams((*fmt, 0, 'NONE', 'not compressed'))
        out.writeframes(audio)
    print('Fertig: sprecherspur.wav')


if __name__ == '__main__':
    try:
        generate()
    except HTTPError as error:
        sys.exit(f'Fish Audio: HTTP {error.code}. Schlüssel, Modell und Guthaben prüfen.')
