#!/usr/bin/env python3
"""RejBoard local server: serves the app and proxies handwriting recognition.
Run:  python server.py   ->  http://localhost:8000   (PORT=9000 python server.py to change)"""
import json, os, shutil, subprocess, tempfile, threading, urllib.parse, urllib.request, webbrowser
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

OFFICE_EXT = {"docx", "doc", "odt", "rtf", "pptx", "ppt", "odp"}

def find_soffice():
    for c in (os.environ.get("SOFFICE"), shutil.which("soffice"), shutil.which("libreoffice"),
              r"C:\Program Files\LibreOffice\program\soffice.exe",
              r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
              "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
        if c and os.path.exists(c):
            return c
    return None

def doc_to_pdf(name, data):
    """Convert a Word / PowerPoint / OpenDocument file to PDF bytes with LibreOffice (headless)."""
    ext = name.lower().rsplit(".", 1)[-1]
    if ext not in OFFICE_EXT:
        raise ValueError("Unsupported document type")
    so = find_soffice()
    if not so:
        raise RuntimeError("LibreOffice is not installed on the computer running server.py")
    with tempfile.TemporaryDirectory(prefix="rejboard-") as d:
        src = os.path.join(d, "in." + ext)
        with open(src, "wb") as f:
            f.write(data)
        prof = "file://" + urllib.request.pathname2url(os.path.join(d, "lo-profile"))
        subprocess.run([so, "--headless", "--norestore", "--nolockcheck", "-env:UserInstallation=" + prof,
                        "--convert-to", "pdf", "--outdir", d, src], check=True, timeout=180,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        out = os.path.join(d, "in.pdf")
        if not os.path.exists(out):
            raise RuntimeError("LibreOffice did not produce a PDF")
        with open(out, "rb") as f:
            return f.read()

class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/api/doc-to-pdf":
            try:
                name = urllib.parse.parse_qs(url.query).get("name", ["file.docx"])[0]
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                pdf, code, ctype = doc_to_pdf(name, body), 200, "application/pdf"
            except Exception as e:
                pdf, code, ctype = json.dumps({"error": str(e)}).encode(), 501, "application/json"
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(pdf)))
            self.end_headers()
            self.wfile.write(pdf)
            return
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
