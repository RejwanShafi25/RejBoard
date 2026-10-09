#!/usr/bin/env python3
"""RejBoard local server: serves the app and proxies handwriting recognition.
Run:  python server.py   ->  http://localhost:8000   (PORT=9000 python server.py to change)"""
import json, os, threading, urllib.request, webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", 8000))
LANG = {"zh": "zh_CN", "pt": "pt_BR"}
# Unofficial Google Input Tools endpoint. Swap recognize() for any other engine if it changes.
URL = "https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8"

def recognize(ink, lang, w, h):
    body = {"options": "enable_pre_space", "requests": [{
        "writing_guide": {"writing_area_width": w, "writing_area_height": h},
        "ink": ink, "language": LANG.get(lang, lang)}]}
    req = urllib.request.Request(URL, json.dumps(body).encode(), {"Content-Type": "application/json"})
    res = json.load(urllib.request.urlopen(req, timeout=15))
    return res[1][0][1][0] if res[0] == "SUCCESS" else ""

class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/handwriting":
            return self.send_error(404)
        try:
            d = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            out, code = {"text": recognize(d["ink"], d.get("lang", "en"), d["w"], d["h"])}, 200
        except Exception as e:
            out, code = {"error": str(e)}, 502
        data = json.dumps(out).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"RejBoard running at http://localhost:{PORT}  (Ctrl+C to stop)")
    threading.Timer(0.8, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    srv.serve_forever()
