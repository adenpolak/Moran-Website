#!/usr/bin/env python3
"""Build a single HTML file that can be emailed or opened from disk: index.html with a <base> pointing at the pinned
commit on jsDelivr's GitHub CDN, so photos, catalog.json and lib/pricing.js load from there. No payments (static only).
    python3 scripts/standalone.py            -> dist/my-sweetart-preview.html
"""
import re, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sha = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
base = f"https://cdn.jsdelivr.net/gh/adenpolak/Moran-Website@{sha}/"
html = (ROOT / "index.html").read_text(encoding="utf-8")
html = html.replace("<head>\n", f'<head>\n<base href="{base}">\n', 1)
out = ROOT / "dist" / "my-sweetart-preview.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"{out} ({out.stat().st_size // 1024} KB) -> assets from {base}")
