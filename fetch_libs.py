#!/usr/bin/env python3
"""Download MathJax, jsPDF and pdf.js into ./vendor, and the English OCR data into ./ocr-engine/tessdata, so the app works fully offline."""
import os, sys, urllib.request
C = "https://cdnjs.cloudflare.com/ajax/libs/"
LIBS = {"tex-svg.js": C + "mathjax/3.2.2/es5/tex-svg.min.js", "jspdf.umd.min.js": C + "jspdf/2.5.1/jspdf.umd.min.js",
        "pdf.min.js": C + "pdf.js/3.11.174/pdf.min.js", "pdf.worker.min.js": C + "pdf.js/3.11.174/pdf.worker.min.js",
        "math.min.js": C + "mathjs/15.2.0/math.min.js", "nerdamer.all.min.js": "https://cdn.jsdelivr.net/npm/nerdamer@1.1.13/all.min.js"}
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"); os.makedirs(d, exist_ok=True)
for n, u in LIBS.items():
    print("downloading", n); urllib.request.urlretrieve(u, os.path.join(d, n))
print("done")
# ONNX Runtime loader for handwriting -> LaTeX (the 14 MB engine itself is downloaded by the app on first use, like the model).
# Pinned by SHA-256: a changed file on the CDN fails the build instead of shipping.
import hashlib
O = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/"
ORT = {"ort.wasm.min.js": "faece07e84faa9001f5104bbe4e5c70861d06cb2376a0dea1fa0ad33a67adc81",
       "ort-wasm-simd-threaded.mjs": "e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b"}
os.makedirs(os.path.join(d, "ort"), exist_ok=True)
for n, h in ORT.items():
    print("downloading ort/" + n); p = os.path.join(d, "ort", n); urllib.request.urlretrieve(O + n, p)
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != h: os.remove(p); sys.exit("checksum mismatch for ort/" + n)
print("done (ort)")
if True:  # English data for the bundled Tesseract.js (used by every platform build)
    t = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ocr-engine", "tessdata"); os.makedirs(t, exist_ok=True)
    print("downloading eng.traineddata")
    urllib.request.urlretrieve("https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata", os.path.join(t, "eng.traineddata"))
    assert os.path.getsize(os.path.join(t, "eng.traineddata")) > 1_000_000, "eng.traineddata looks wrong"
    print("done (ocr)")
