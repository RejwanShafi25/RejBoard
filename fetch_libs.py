#!/usr/bin/env python3
"""Download MathJax, jsPDF and pdf.js into ./vendor so the app works fully offline."""
import os, urllib.request
C = "https://cdnjs.cloudflare.com/ajax/libs/"
LIBS = {"tex-svg.js": C + "mathjax/3.2.2/es5/tex-svg.min.js", "jspdf.umd.min.js": C + "jspdf/2.5.1/jspdf.umd.min.js",
        "pdf.min.js": C + "pdf.js/3.11.174/pdf.min.js", "pdf.worker.min.js": C + "pdf.js/3.11.174/pdf.worker.min.js"}
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"); os.makedirs(d, exist_ok=True)
for n, u in LIBS.items():
    print("downloading", n); urllib.request.urlretrieve(u, os.path.join(d, n))
print("done")
