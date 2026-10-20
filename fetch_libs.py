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
if True:  # English data for the bundled Tesseract.js (used by every platform build)
    t = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ocr-engine", "tessdata"); os.makedirs(t, exist_ok=True)
    print("downloading eng.traineddata")
    urllib.request.urlretrieve("https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata", os.path.join(t, "eng.traineddata"))
    assert os.path.getsize(os.path.join(t, "eng.traineddata")) > 1_000_000, "eng.traineddata looks wrong"
    print("done (ocr)")
