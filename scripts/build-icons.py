#!/usr/bin/env python3
"""Generates every icon the app ships from one square source.

    python3 scripts/build-icons.py

Needs Pillow. Reads assets/icon.png and writes into public/, overwriting.
Re-run it after changing the source; nothing here is hand-edited.

The source is a screenshot of four rooms on the canvas, so it already carries
its own grid margin. Sizes below are chosen from what each icon is actually
for, and the two that are not simple resizes are commented where they are
built.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "icon.png"
OUT = ROOT / "public"

# Anything the icon sits on where the shape is not square: the browser tab, an
# installed app's window list, a home screen.
APP_SIZES = [192, 512]

# The tab, the bookmark bar, and the file dialog on Windows.
FAVICON_SIZES = [16, 32, 48]

# iOS home screen. Composited onto opaque black, since iOS puts no background
# behind it and a transparent icon comes out with a white square.
APPLE_SIZE = 180

# What a .mvm looks like in Explorer and Finder. The Windows shell asks for
# these four.
#
# Below this the page and its folded corner are two or three pixels of grey
# and the mark inside them is unreadable, so the smallest one is the bare mark
# instead. A file list at that size is read by colour, not by silhouette.
FILE_SIZES = [16, 32, 48, 256]
FILE_PAGE_MINIMUM = 32

# Android masks a maskable icon to a shape it chooses, keeping only the middle.
# The specification guarantees a circle of 80% of the width; a square mark's
# corners reach 1.41 times its half-width, so the mark is scaled to fit that
# circle rather than to fit the square.
MASKABLE_SIZE = 512
MASKABLE_MARK = 0.62

BACKGROUND = (0, 0, 0, 255)


def load() -> Image.Image:
    if not SOURCE.exists():
        raise SystemExit(f"no source icon at {SOURCE}")
    icon = Image.open(SOURCE).convert("RGBA")
    if icon.width != icon.height:
        raise SystemExit(f"source must be square, got {icon.size}")
    return icon


def resized(icon: Image.Image, size: int) -> Image.Image:
    return icon.resize((size, size), Image.LANCZOS)


def flattened(icon: Image.Image, size: int) -> Image.Image:
    out = Image.new("RGBA", (size, size), BACKGROUND)
    out.alpha_composite(resized(icon, size))
    return out


def maskable(icon: Image.Image) -> Image.Image:
    out = Image.new("RGBA", (MASKABLE_SIZE, MASKABLE_SIZE), BACKGROUND)
    mark = resized(icon, round(MASKABLE_SIZE * MASKABLE_MARK))
    offset = (MASKABLE_SIZE - mark.width) // 2
    out.alpha_composite(mark, (offset, offset))
    return out


def document(icon: Image.Image, size: int) -> Image.Image:
    """The app's mark on a page, which is what a document icon has to be.

    Drawn at 256 and resized down, so the fold and the outline survive the
    small sizes rather than being redrawn per size. The page is light because
    that is the convention every file manager already shows: an icon that
    matched the app exactly would make a project indistinguishable from the
    application that opens it.
    """
    edge = 256
    page = Image.new("RGBA", (edge, edge), (0, 0, 0, 0))
    draw = ImageDraw.Draw(page)

    left, right = 34, 222
    top, bottom = 16, 240
    fold = 52

    body = [
        (left, top),
        (right - fold, top),
        (right, top + fold),
        (right, bottom),
        (left, bottom),
    ]
    draw.polygon(body, fill=(244, 244, 246, 255))
    draw.line([*body, (left, top)], fill=(120, 120, 128, 255), width=4, joint="curve")
    # The folded corner, as the triangle the page turns back on itself.
    draw.polygon(
        [(right - fold, top), (right, top + fold), (right - fold, top + fold)],
        fill=(206, 206, 214, 255),
    )
    draw.line(
        [(right - fold, top), (right - fold, top + fold), (right, top + fold)],
        fill=(120, 120, 128, 255),
        width=4,
    )

    mark = resized(icon, 132)
    page.alpha_composite(mark, ((left + right) // 2 - 66, (top + bottom) // 2 - 60))
    return page.resize((size, size), Image.LANCZOS)


def main() -> None:
    icon = load()
    OUT.mkdir(exist_ok=True)

    for size in APP_SIZES:
        flattened(icon, size).save(OUT / f"icon-{size}.png")
    maskable(icon).save(OUT / f"icon-maskable-{MASKABLE_SIZE}.png")
    for size in FAVICON_SIZES:
        flattened(icon, size).save(OUT / f"favicon-{size}.png")
    flattened(icon, APPLE_SIZE).save(OUT / "apple-touch-icon.png")
    for size in FILE_SIZES:
        page = document(icon, size) if size >= FILE_PAGE_MINIMUM else flattened(icon, size)
        page.save(OUT / f"file-icon-{size}.png")

    for path in sorted(OUT.glob("*.png")):
        print(path.relative_to(ROOT))


if __name__ == "__main__":
    main()
