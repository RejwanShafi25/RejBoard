#!/usr/bin/env python3
"""Fill missing strings in locales/<code>.json using a machine-translation backend, then commit the packs.
Needs network + a backend. Default backend: LibreTranslate (self-hosted or hosted).
  LT_URL=https://libretranslate.example/translate LT_KEY=... python tools/translate-packs.py [code ...]
Flow: python tools/extract-strings.py  ->  python tools/translate-packs.py  ->  review  ->  git commit locales/"""
import json, os, sys, urllib.request
URL, KEY = os.environ.get('LT_URL'), os.environ.get('LT_KEY', '')
if not URL: sys.exit('Set LT_URL (and LT_KEY if needed)')
en = json.load(open('locales/en.json', encoding='utf-8'))
codes = sys.argv[1:] or [l['code'] for l in json.load(open('locales/index.json', encoding='utf-8'))['languages'] if l['code'] != 'en']
def tr(text, code):
    body = json.dumps({'q': text, 'source': 'en', 'target': {'zh': 'zh'}.get(code, code), 'format': 'text', 'api_key': KEY}).encode()
    r = urllib.request.Request(URL, body, {'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(r, timeout=30))['translatedText']
for c in codes:
    path = f'locales/{c}.json'; pk = json.load(open(path, encoding='utf-8')); s = pk['s']
    todo = [k for k in en if k not in s]
    for i, k in enumerate(todo):
        try: s[k] = tr(k, c)
        except Exception as e: print(c, 'skip', k[:40], e)
        if i % 50 == 0: print(c, i, '/', len(todo), flush=True)
    pk['_']['complete'] = all(k in s for k in en)
    json.dump(pk, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
