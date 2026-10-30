#!/usr/bin/env python3
"""Render the 512 x 512 store icon and the 1024 x 500 feature graphic.

WHY THIS EXISTS. The APK ships no raster icon: the launcher icon is an adaptive-icon XML built
from vectors, because density PNGs are a source of build nondeterminism. Android renders that
happily, but a store front-end looks for a bitmap and shows an empty tile without one (Zapstore
did, before the icon came from Fastlane metadata). So the store images are supplied as Fastlane
metadata instead, and the APK is untouched. Adapted on 29 October 2026 from CheckLink's
android/tools/build-store-icon.py.

The store icon mirrors the adaptive icon exactly: the icon background colour of
res/values/colors.xml, and the mark of tools/launcher-icon.svg (ICON-1, draft C, "Data about
you", chosen by Marcos on 16 October 2026) scaled and placed inside a 108 unit square by the
very numbers of res/drawable/ic_launcher_foreground.xml, which tools/make_icons.py writes. They
are read from that file, so the store tile and the launcher icon cannot drift apart. The web
app's favicon.svg is the same drawing (draft C since 29 October 2026) but is not used here.

The feature graphic is plain, as CheckLink's for Google Play (25 October 2026): the same mark
and the app's name in Inter Bold with the mark's teal gradient, on the same background. No new
words.

Rendering uses headless Chromium, the engine that draws the web app; ImageMagick ignores the
SVG's gradients and would write an empty picture. Each image is checked for the mark before it
is written.

    python3 android/tools/build-store-icon.py

Needs: chromium (or google-chrome) on PATH, and Pillow.
Writes: fastlane/metadata/android/en-US/images/icon.png
        fastlane/metadata/android/en-US/images/featureGraphic.png
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ANDROID = os.path.dirname(HERE)
REPO = os.path.dirname(ANDROID)
SVG = os.path.join(HERE, "launcher-icon.svg")
FOREGROUND = os.path.join(ANDROID, "app", "src", "main", "res", "drawable", "ic_launcher_foreground.xml")
COLOURS = os.path.join(ANDROID, "app", "src", "main", "res", "values", "colors.xml")
FONT = os.path.join(REPO, "fonts", "inter", "Inter-Bold.woff2")
IMAGES = os.path.join(REPO, "fastlane", "metadata", "android", "en-US", "images")
ICON = os.path.join(IMAGES, "icon.png")
FEATURE = os.path.join(IMAGES, "featureGraphic.png")
NAME = "GDPRLetterBuilder"


def background():
    m = re.search(r'<color name="icon_background">#([0-9A-Fa-f]{6})</color>', open(COLOURS, encoding="utf-8").read())
    if not m:
        raise SystemExit("could not read icon_background from colors.xml")
    return "#" + m.group(1).upper()


def placement():
    xml = open(FOREGROUND, encoding="utf-8").read()
    nums = {k: re.search(r'android:%s="([0-9.]+)"' % k, xml) for k in ("scaleX", "scaleY", "translateX", "translateY")}
    if not all(nums.values()):
        raise SystemExit("could not read the group transform from ic_launcher_foreground.xml")
    v = {k: m.group(1) for k, m in nums.items()}
    if v["scaleX"] != v["scaleY"]:
        raise SystemExit("the foreground is not scaled evenly")
    return v["scaleX"], v["translateX"], v["translateY"]


def mark():
    src = open(SVG, encoding="utf-8").read()
    inner = re.search(r"<svg[^>]*>(.*)</svg>", src, re.S)
    if not inner:
        raise SystemExit("could not read launcher-icon.svg")
    # The root element's fill="none" is inherited by the flap, which has no fill of its own; the
    # wrapper keeps it, or the flap's triangle would be filled black.
    root = re.search(r'<svg[^>]*\bfill="([^"]+)"', src)
    body = re.sub(r"<!--.*?-->", "", inner.group(1), flags=re.S)
    return '<g fill="%s">%s</g>' % (root.group(1) if root else "black", body)


def shoot(html, width, height, out, bg):
    browser = shutil.which("chromium") or shutil.which("google-chrome") or shutil.which("chromium-browser")
    if not browser:
        raise SystemExit("needs chromium or google-chrome on PATH")
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, "page.html")
        shot = os.path.join(tmp, "shot.png")
        with open(page, "w", encoding="utf-8") as f:
            f.write(html)
        subprocess.run(
            [browser, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
             "--allow-file-access-from-files", "--force-device-scale-factor=1",
             "--window-size=%d,%d" % (width, height),
             "--user-data-dir=" + os.path.join(tmp, "profile"),
             "--screenshot=" + shot, "file://" + page],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        img = Image.open(shot).convert("RGB")
    if img.size != (width, height):
        img = img.crop((0, 0, width, height))
    rgb = tuple(int(bg[i:i + 2], 16) for i in (1, 3, 5))
    samples = [img.getpixel((x, y)) for y in range(0, height, 2) for x in range(0, width, 2)]
    marked = sum(1 for p in samples if sum(abs(a - b) for a, b in zip(p, rgb)) > 30)
    if marked < len(samples) // 20:
        raise SystemExit("%s: the mark did not render; refusing to write a blank image" % os.path.basename(out))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, "PNG", optimize=True)
    print("wrote %s: %dx%d, %d of %d sampled pixels carry the mark, %d bytes"
          % (os.path.relpath(out, REPO), width, height, marked, len(samples), os.path.getsize(out)))


def icon(bg):
    scale, tx, ty = placement()
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="512" height="512">'
           '<rect width="108" height="108" fill="%s"/><g transform="translate(%s %s) scale(%s)">%s</g></svg>'
           % (bg, tx, ty, scale, mark()))
    html = ("<!doctype html><html><head><style>html,body{margin:0;padding:0;background:%s;overflow:hidden}"
            "svg{display:block}</style></head><body>%s</body></html>" % (bg, svg))
    print("icon: scale %s, translate %s,%s (ic_launcher_foreground.xml)" % (scale, tx, ty))
    shoot(html, 512, 512, ICON, bg)


def feature(bg):
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="220" height="220">%s</svg>' % mark()
    html = """<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><style>
@font-face{font-family:"Inter";font-weight:700;src:url("file://%s") format("woff2")}
html,body{margin:0;width:1024px;height:500px;overflow:hidden;background:%s}
body{position:relative;font-family:"Inter",sans-serif}
.mark{position:absolute;left:64px;top:140px;width:220px;height:220px}
.mark svg{display:block}
.name{position:absolute;left:300px;top:211px;font-weight:700;font-size:74px;letter-spacing:-1.5px;line-height:1;
 white-space:nowrap;background:linear-gradient(135deg,#ecfdfa,#5eead4 45%%,#14b8a6);-webkit-background-clip:text;
 background-clip:text;color:transparent}
</style></head><body><div class="mark">%s</div><div class="name">%s</div></body></html>""" % (FONT, bg, svg, NAME)
    shoot(html, 1024, 500, FEATURE, bg)


def main():
    bg = background()
    icon(bg)
    feature(bg)


if __name__ == "__main__":
    sys.exit(main())
