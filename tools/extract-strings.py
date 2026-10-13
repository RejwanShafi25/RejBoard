#!/usr/bin/env python3
"""Extract every user-visible English UI string from index.html into locales/en.json.
Keys ARE the English source strings, so the code never needs hardcoded per-language text.
Run: python tools/extract-strings.py"""
import re, json, html, sys
src = open('index.html', encoding='utf-8').read()
out = {}
def unesc(s):
    s = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1),16)), s)
    s = s.encode('utf-16','surrogatepass').decode('utf-16','replace') if re.search('[\ud800-\udfff]', s) else s
    return s.replace("\\n"," ").replace("\\'","'")
def add(s):
    s = html.unescape(unesc(s)).strip()
    if len(s) < 2 or len(s) > 400 or not re.search(r'[A-Za-z]{2}', s): return
    if re.search(r'[{}<>]|\$\{|^https?:|^[#.][\w-]+$|\.(png|svg|js|css|json)$', s): return
    out[s] = s
body = src[src.find('<body'):]
body = re.sub(r'<script\b.*?</script>', '', body, flags=re.S)
body = re.sub(r'<style\b.*?</style>', '', body, flags=re.S)
for m in re.findall(r'>([^<>]+)<', body): add(m)
for m in re.findall(r'(?:title|placeholder|aria-label)="([^"]+)"', src): add(m)
js = src
for pat in [r"toast\(\s*'((?:[^'\\]|\\.)+)'", r"toast\(\s*\"((?:[^\"\\]|\\.)+)\"",
            r"\b[HR]\(\s*'((?:[^'\\]|\\.)+)'", r"\bR\('(?:[^'\\]|\\.)+',[^;]*?,\s*'((?:[^'\\]|\\.)+)'\)",
            r"textContent\s*=\s*'((?:[^'\\]|\\.)+)'", r"\[\s*'[a-z0-9_-]+'\s*,\s*'((?:[^'\\]|\\.)+)'\s*\]",
            r"(?:alert|confirm|prompt)\(\s*'((?:[^'\\]|\\.)+)'", r"label:\s*'((?:[^'\\]|\\.)+)'",
            r"title\s*=\s*'((?:[^'\\]|\\.)+)'", r"placeholder\s*=\s*'((?:[^'\\]|\\.)+)'"]:
    for m in re.findall(pat, js): add(m.replace("\\'", "'"))
for v in (m for m in re.findall(r"T\.en|en:\{([^}]*)\}", src) if m):
    for s in re.findall(r":'((?:[^'\\]|\\.)+)'", v): add(s.replace("\\'", "'"))
keys = sorted(out, key=str.lower)
json.dump({k: k for k in keys}, open('locales/en.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(keys), 'strings -> locales/en.json')
