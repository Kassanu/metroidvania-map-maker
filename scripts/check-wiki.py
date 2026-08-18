#!/usr/bin/env python3
"""Checks the wiki clone: link resolution both ways, page shape, and terminology.

    python3 scripts/check-wiki.py [path-to-wiki-clone]

Defaults to the sibling clone beside this repo. Exits 1 if anything fails.

Lives here rather than in the wiki repo because that repo has no .gitignore and
publishes everything in it, and because the terminology check has to read this
repo's message catalogue anyway.

A page's filename is its title and its URL, so a rename after publication breaks
every inbound link. That makes link resolution in both directions and the
H1-to-sidebar match the checks that matter; the rest are cheap and catch drift.
"""

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
EN_TS = ROOT / "src" / "i18n" / "messages" / "en.ts"
DEFAULT_WIKI = ROOT.parent / "metroidvania-map-maker-wiki"

PAGE_COUNT = 39

# The one non-markdown entry the clone may hold, and the only suffixes allowed
# inside it. The generator (npm run wiki:images) owns the directory and deletes
# anything its manifest does not name, which is the half of the loop this script
# cannot see.
IMAGES_DIR = "images"
IMAGE_SUFFIXES = (".png", ".gif")

# Images generated ahead of the page that will reference them. Self-clearing in
# the same direction as PENDING: an image named here that IS now referenced
# fails, which is the signal to delete the entry rather than leave a permanent
# hole in the orphan check.
UNREFERENCED = ["regions-numbered.png", "room-mode-draw-a-room.gif"]

# Material with a name in the tree but no page until it ships.
FUTURE_SLOTS = ["Exports", "Global find", "Global-find", "Managing lock types", "Managing-lock-types"]

# Pages carrying real prose. Every other page is still the three-line stub the
# tree was built as, and the shape check below applies only to those. The list
# is self-clearing in the same direction as PENDING: a page named here that is
# still a stub fails, which is the signal to correct the list.
WRITTEN = ["Home", "Glossary"]

# Product terms the pages use. Each must appear inside a string in en.ts: a term
# no message renders is a term no user has seen on screen.
#
# Window regions are absent on purpose. The app has no word for the menu bar, the
# tab bar or the seven parts collectively, and names the activity bar only inside
# one tooltip's prose. Those are wiki titles rather than claims about the screen,
# which is the rule `Regions` already established.
TERMS = [
    "Metroidvania Map Maker", "Welcome screen", "Cheat sheet", "Appearance", "Zoom",
    "Brush", "Cut", "Copy", "Paste", "Duplicate", "Grid", "Rulers", "Zen mode",
    "Hierarchy", "Inspector", "Icon Library", "Save As", "Save", "Recent", "Open",
    "Door", "Elevator", "Teleport",
    # Added by the Glossary.
    "Map canvas", "Coords Overlay", "Toolbar", "Lock", "World", "Vertex", "Area",
    "Direction", "One-way", "Label", "Notes", "Plate", "Glyph",
]

# Terms decided but not yet shipped, pending the mode rename. This list is
# self-clearing: a term that has landed in en.ts fails here, which is the signal
# to delete it from this list rather than leave a permanent exemption.
PENDING = ["Room Mode", "Object Mode", "Door Mode", "Markup Mode"]

# The British form is usually inside a longer word ("recolouring"), which a
# suffix match never sees.
BRITISH = ["colour", "organis", "recognis", "customis", "initialis", "centre", "behaviour",
           "licence", "defence", "analyse", "grey", "cancelled", "travelling"]

failures = []


def check(condition, failure):
    if not condition:
        failures.append(failure)


def _targets(text):
    """Every local `](target)` in a markdown body, links and images alike.

    External URLs and in-page anchors are not this repo's to resolve.
    """
    for chunk in text.split("](")[1:]:
        target = chunk.split(")", 1)[0]
        if "://" in target or target.startswith(("#", "mailto:")):
            continue
        yield target


def relative_links(text):
    """Every wiki-internal page link in a markdown body.

    A GitHub wiki link carries no extension, so [Rooms](Rooms) means Rooms.md in
    the same clone. Image targets are excluded: an image is written
    ![alt](images/x.png) and a self-linked one [![alt](…)](images/x.png), so both
    halves reach here as `images/x.png`, which is a file rather than a page.
    """
    for target in _targets(text):
        if not target.endswith(IMAGE_SUFFIXES):
            yield target


def image_refs(text):
    """Every image file a markdown body points at, by name within images/."""
    for target in _targets(text):
        if target.endswith(IMAGE_SUFFIXES):
            yield target


def main(wiki):
    if not (wiki / "_Sidebar.md").is_file():
        print(f"no _Sidebar.md in {wiki}")
        return 1

    sidebar = (wiki / "_Sidebar.md").read_text()
    targets, seen = [], set()
    for line in sidebar.splitlines():
        if "](" not in line:
            continue
        target = line.split("](", 1)[1].split(")", 1)[0]
        text = line.split("[", 1)[1].split("](", 1)[0]
        check(target not in seen, f"page linked twice in the sidebar: {target}")
        seen.add(target)
        targets.append((target, text))

    on_disk = sorted(p.stem for p in wiki.glob("*.md") if p.name != "_Sidebar.md")
    linked = [t for t, _ in targets]

    check(len(targets) == PAGE_COUNT, f"sidebar names {len(targets)} pages, expected {PAGE_COUNT}")
    check(len(on_disk) == PAGE_COUNT, f"{len(on_disk)} page files on disk, expected {PAGE_COUNT}")

    for target, _ in targets:
        check((wiki / f"{target}.md").is_file(), f"dead sidebar link: {target}")
    for stem in on_disk:
        check(stem in linked, f"orphan page, in no sidebar entry: {stem}")

    check(not [p for p in wiki.iterdir()
               if p.name not in (".git", IMAGES_DIR) and p.suffix != ".md"],
          "a non-markdown file is in the clone, which publishes everything in it")

    images = wiki / IMAGES_DIR
    for path in sorted(images.iterdir()) if images.is_dir() else []:
        check(path.is_file() and path.suffix in IMAGE_SUFFIXES,
              f"{IMAGES_DIR}/ holds something that is not an image: {path.name}")

    for slot in FUTURE_SLOTS:
        check(slot not in sidebar, f"future slot appears in the sidebar: {slot}")
        check(not (wiki / f"{slot}.md").is_file(), f"future slot exists as a file: {slot}")

    for path in sorted(wiki.glob("*.md")):
        if path.name == "_Sidebar.md":
            continue
        body = path.read_text().splitlines()
        check(bool(body) and body[0].startswith("# "), f"{path.name} does not open with an H1")
        check(len([l for l in body if l.startswith("# ")]) == 1, f"{path.name} carries more than one H1")
        stub = len(body) == 3 and body[1] == ""
        if path.stem in WRITTEN:
            check(not stub, f"{path.name} is listed as written but is still a stub")
            continue
        check(stub, f"{path.name} is not an H1, a blank line and one line")
        check(body[-1].endswith("."), f"{path.name}'s summary line does not end in a period")

    # Links in a page body, which the sidebar pass above does not see. Home is
    # the reason: its contents list carries a link to every other page.
    for path in sorted(wiki.glob("*.md")):
        if path.name == "_Sidebar.md":
            continue
        for target in relative_links(path.read_text()):
            check((wiki / f"{target}.md").is_file(), f"{path.name}: dead link to {target}")

    # Both directions, so images/ is a closed loop rather than a hole: no page
    # publishes a broken image, and no image publishes that nothing shows.
    referenced = set()
    for path in sorted(wiki.glob("*.md")):
        # Deduplicated: the house style self-links every image, so
        # [![alt](images/x.png)](images/x.png) names the same target twice.
        for target in sorted(set(image_refs(path.read_text()))):
            check((wiki / target).is_file(), f"{path.name}: missing image {target}")
            referenced.add(pathlib.PurePosixPath(target).name)

    for path in sorted(images.iterdir()) if images.is_dir() else []:
        if path.name in referenced:
            check(path.name not in UNREFERENCED,
                  f"image is referenced now, remove it from UNREFERENCED: {path.name}")
        else:
            check(path.name in UNREFERENCED,
                  f"orphan image, referenced by no page: {path.name}")

    home_links = set(relative_links((wiki / "Home.md").read_text()))
    for target, _ in targets:
        if target == "Home":
            continue
        check(target in home_links, f"Home's contents list does not link {target}")

    # The sidebar's link text is the page's H1, so the two cannot drift apart.
    # Home is the exception: GitHub labels that page Home whatever the file says,
    # and the landing page's own title is the product.
    for target, text in targets:
        page = wiki / f"{target}.md"
        if not page.is_file():
            continue
        h1 = page.read_text().splitlines()[0][2:]
        if target == "Home":
            check(h1 == "Metroidvania Map Maker", f"Home's H1 is {h1!r}")
            check(text == "Home", f"Home's sidebar text is {text!r}")
            continue
        check(h1 == text, f"{target}: H1 {h1!r} differs from sidebar text {text!r}")

    catalogue = EN_TS.read_text()
    for term in TERMS:
        check(term in catalogue, f"term is in no en.ts string: {term}")
    for term in PENDING:
        check(term not in catalogue,
              f"pending term has landed in en.ts, remove it from PENDING: {term}")

    prose = " ".join(p.read_text() for p in wiki.glob("*.md")).lower()
    for form in BRITISH:
        check(form not in prose, f"British spelling: {form}")

    for failure in failures:
        print("FAIL", failure)
    on_disk_images = sorted(p.name for p in images.iterdir()) if images.is_dir() else []
    print(f"\n{len(targets)} sidebar entries, {len(on_disk)} page files, "
          f"{len(on_disk_images)} images, {len(failures)} failures")
    if PENDING:
        print(f"pending the mode rename, absent from en.ts by design: {', '.join(PENDING)}")
    if UNREFERENCED:
        print(f"generated ahead of the page that will use them: {', '.join(UNREFERENCED)}")
    return 1 if failures else 0


sys.exit(main(pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_WIKI))
