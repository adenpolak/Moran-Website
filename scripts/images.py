#!/usr/bin/env python3
"""Image pipeline for the storefront. Needs Pillow (pip install pillow).

  python3 scripts/images.py import PHOTO.heic images/number-50-marble.jpg
      EXIF-rotate, convert to JPEG, longest side 1600 px, quality 82, progressive.
  python3 scripts/images.py variants
      For every images/*.jpg master: -480 / -960 / -1600 JPEG + WebP next to it (originals untouched).
  python3 scripts/images.py og
      images/og.jpg: images/number-50-marble.jpg cropped to 1200×630 for Open Graph / Twitter cards.
  python3 scripts/images.py tile
      images/marble-tile.jpg: the box's front panel cut from images/marble-box-detail.jpg, greyscale, levels pushed
      (≥190 → white, ≤70 → black), quality 85. The texture behind the ticker, the order ticket and the footer edge.
  python3 scripts/images.py all      = variants + og + tile
"""
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover
    sys.exit("Pillow is missing: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "images"
SIZES = (480, 960, 1600)
SKIP_SUFFIXES = tuple(f"-{s}" for s in SIZES)


def load(path: Path) -> Image.Image:
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    return im


def fit(im: Image.Image, longest: int) -> Image.Image:
    w, h = im.size
    if max(w, h) <= longest:
        return im.copy()
    scale = longest / max(w, h)
    return im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


def save_jpeg(im: Image.Image, dest: Path, quality: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(dest, "JPEG", quality=quality, optimize=True, progressive=True)


def cmd_import(src: str, dest: str) -> None:
    im = fit(load(Path(src)), 1600)
    save_jpeg(im, Path(dest), 82)
    print(f"{dest}: {im.size[0]}×{im.size[1]}")


def masters():
    for p in sorted(IMAGES.glob("*.jpg")):
        if p.stem.endswith(SKIP_SUFFIXES) or p.stem in ("og", "marble-tile"):
            continue
        yield p


def cmd_variants() -> None:
    n = 0
    for p in masters():
        im = load(p)
        for s in SIZES:
            v = fit(im, s)
            save_jpeg(v, p.with_name(f"{p.stem}-{s}.jpg"), 80 if s < 1600 else 82)
            v.convert("RGB").save(p.with_name(f"{p.stem}-{s}.webp"), "WEBP", quality=78, method=6)
            n += 2
    print(f"wrote {n} variants")


def cmd_og() -> None:
    src = IMAGES / "number-50-marble.jpg"
    if not src.exists():
        sys.exit(f"missing {src}")
    im = load(src)
    out = ImageOps.fit(im, (1200, 630), Image.LANCZOS, centering=(0.5, 0.45))
    save_jpeg(out, IMAGES / "og.jpg", 84)
    print("images/og.jpg: 1200×630")


def cmd_tile() -> None:
    src = IMAGES / "marble-box-detail.jpg"
    if not src.exists():
        sys.exit(f"missing {src}")
    im = load(src)
    # Work on the 1200×1600 version so the crop box below means the same thing regardless of the master's size.
    base = im.resize((1200, 1600), Image.LANCZOS)
    panel = base.crop((590, 790, 1120, 1090)).convert("L")
    lo, hi = 70, 190

    def levels(v: int) -> int:
        if v <= lo:
            return 0
        if v >= hi:
            return 255
        return round((v - lo) * 255 / (hi - lo))

    panel = panel.point([levels(i) for i in range(256)])
    save_jpeg(panel, IMAGES / "marble-tile.jpg", 85)
    print(f"images/marble-tile.jpg: {panel.size[0]}×{panel.size[1]}")


def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd = argv[1]
    if cmd == "import" and len(argv) == 4:
        cmd_import(argv[2], argv[3])
    elif cmd == "variants":
        cmd_variants()
    elif cmd == "og":
        cmd_og()
    elif cmd == "tile":
        cmd_tile()
    elif cmd == "all":
        cmd_variants(); cmd_og(); cmd_tile()
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
