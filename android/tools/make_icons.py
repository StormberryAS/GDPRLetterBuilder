#!/usr/bin/env python3
"""Writes GDPRLetterBuilder's launcher icon vectors from tools/launcher-icon.svg's geometry
(ICON-1, draft C, "Data about you": a closed envelope with a small person on it, chosen by
Marcos on 16 October 2026).

Run from android/:  python3 tools/make_icons.py app/src/main/res

tools/launcher-icon.svg is a byte copy of LabsIdeas/GDPRLetterBuilder icon drafts
2026-10-12/C-envelope-with-person.svg (tests/android-app.test.ts checks it when the drafts
folder is beside the repository). The web app's favicon.svg is the same drawing (draft C since
29 October 2026), with its own comment; it is not read here.

It prints the mark's bounding box and the transforms used, and writes four files:
  drawable/ic_launcher_foreground.xml    the adaptive icon's foreground (Android 8 and later)
  drawable/ic_launcher_monochrome.xml    the themed-icon layer (Android 13 and later)
  mipmap-anydpi/ic_launcher.xml          Android 7.0 and 7.1: the mark on a dark rounded tile
  mipmap-anydpi/ic_launcher_round.xml    the same on a dark round tile
mipmap-anydpi-v26/ic_launcher*.xml (the adaptive icons) only name these files and the background
colour, and are not written here.

The rules are CheckLink's (android/tools/make_icons.py there): the mark is scaled and centred on
its own bounding box inside the 108 unit viewport, so that every point of it stays inside the 66
unit safe zone that launchers never crop (its farthest point 31 units from the centre); the
legacy tiles carry the same mark 1.2 / 0.78 times larger.

The drawing is the SVG's, shape for shape and in its order: the envelope (a rounded rectangle,
filled, with a gradient outline), its flap (a gradient line), the light disc, the person's head
and shoulders. Vector drawables take the same path commands, and their gradients use the path's
own coordinates, like the SVG's userSpaceOnUse gradient, so the numbers carry over unchanged. The
rectangle and the circles are written as paths, because vector drawables have no rect or circle.
"""
import math
import os
import sys

res = sys.argv[1]

# launcher-icon.svg, element for element (64 x 64 viewBox).
RECT_X, RECT_Y, RECT_W, RECT_H, RECT_R, RECT_STROKE = 6, 14, 52, 38, 5, 3
FLAP = "M8,17 L32,35 L56,17"
FLAP_WIDTH = 3
DISC_C, DISC_R = (47, 44), 12
HEAD_C, HEAD_R = (47, 40.5), 3.6
SHOULDERS = "M40.5,51.5 A6.5,6 0 0,1 53.5,51.5 Z"
GRAD = (6, 14, 58, 52, "#FF5EEAD4", "#FF14B8A6")


def rounded_rect(x, y, w, h, r):
    return (f"M{x + r:g},{y:g} H{x + w - r:g} A{r:g},{r:g} 0 0,1 {x + w:g},{y + r:g} V{y + h - r:g} "
            f"A{r:g},{r:g} 0 0,1 {x + w - r:g},{y + h:g} H{x + r:g} A{r:g},{r:g} 0 0,1 {x:g},{y + h - r:g} "
            f"V{y + r:g} A{r:g},{r:g} 0 0,1 {x + r:g},{y:g} Z")


def circle(c, r):
    return f"M{c[0] - r:g},{c[1]:g} A{r:g},{r:g} 0 1,0 {c[0] + r:g},{c[1]:g} A{r:g},{r:g} 0 1,0 {c[0] - r:g},{c[1]:g} Z"


RECT = rounded_rect(RECT_X, RECT_Y, RECT_W, RECT_H, RECT_R)
DISC = circle(DISC_C, DISC_R)
HEAD = circle(HEAD_C, HEAD_R)

# The outline of what is drawn: the envelope's outer edge (its rounded corners grown by half the
# stroke) and the disc. The flap, the head and the shoulders lie inside them.
pts = []
half = RECT_STROKE / 2
corners = [(RECT_X + RECT_R, RECT_Y + RECT_R), (RECT_X + RECT_W - RECT_R, RECT_Y + RECT_R),
           (RECT_X + RECT_W - RECT_R, RECT_Y + RECT_H - RECT_R), (RECT_X + RECT_R, RECT_Y + RECT_H - RECT_R)]
for k in range(720):
    t = math.radians(k / 2)
    for (cx, cy) in corners:
        pts.append((cx + (RECT_R + half) * math.cos(t), cy + (RECT_R + half) * math.sin(t)))
    pts.append((DISC_C[0] + DISC_R * math.cos(t), DISC_C[1] + DISC_R * math.sin(t)))
xs = [p[0] for p in pts]
ys = [p[1] for p in pts]
minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
far = max(math.hypot(p[0] - cx, p[1] - cy) for p in pts)
print(f"bbox x {minx:.2f}..{maxx:.2f} y {miny:.2f}..{maxy:.2f}; centre {cx:.2f},{cy:.2f}; farthest point {far:.2f}")


def grad(attr):
    x1, y1, x2, y2, c1, c2 = GRAD
    return (f'<aapt:attr name="android:{attr}">\n'
            f'                <gradient android:type="linear" android:startX="{x1:g}" android:startY="{y1:g}" android:endX="{x2:g}" android:endY="{y2:g}">\n'
            f'                    <item android:offset="0" android:color="{c1}" />\n'
            f'                    <item android:offset="1" android:color="{c2}" />\n'
            f'                </gradient>\n'
            f'            </aapt:attr>')


def group(scale, tx, ty, body):
    return f'''    <group
        android:scaleX="{scale:.4f}"
        android:scaleY="{scale:.4f}"
        android:translateX="{tx:.2f}"
        android:translateY="{ty:.2f}">
{body}
    </group>'''


COLOUR = f'''        <!-- launcher-icon.svg, shape for shape, in its order: the envelope, its flap, the light
             disc, the person's head and shoulders. -->
        <path
            android:fillColor="#FF103033"
            android:strokeWidth="{RECT_STROKE}"
            android:pathData="{RECT}">
            {grad("strokeColor")}
        </path>
        <path
            android:strokeWidth="{FLAP_WIDTH}"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:pathData="{FLAP}">
            {grad("strokeColor")}
        </path>
        <path
            android:fillColor="#FFECFDFA"
            android:pathData="{DISC}" />
        <path
            android:fillColor="#FF0F766E"
            android:pathData="{HEAD}" />
        <path
            android:fillColor="#FF0F766E"
            android:pathData="{SHOULDERS}" />'''

MONO = f'''        <!-- One colour, read by its alpha only: the envelope's outline and flap, and the disc
             with the person cut out of it (even-odd fill), so the person stays visible. -->
        <path
            android:strokeColor="#FFFFFFFF"
            android:strokeWidth="{RECT_STROKE}"
            android:pathData="{RECT}" />
        <path
            android:strokeColor="#FFFFFFFF"
            android:strokeWidth="{FLAP_WIDTH}"
            android:strokeLineCap="round"
            android:strokeLineJoin="round"
            android:pathData="{FLAP}" />
        <path
            android:fillColor="#FFFFFFFF"
            android:fillType="evenOdd"
            android:pathData="{DISC} {HEAD} {SHOULDERS}" />'''

HEAD_XML = '''<?xml version="1.0" encoding="utf-8"?>
<!--
{comment}
-->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
{aapt}    android:width="{size}dp"
    android:height="{size}dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
'''
AAPT = '    xmlns:aapt="http://schemas.android.com/aapt"\n'

# Adaptive foreground: the farthest point of the mark 31 units from the centre, inside the 66
# unit safe zone (radius 33).
fs = 31 / far
ftx, fty = 54 - cx * fs, 54 - cy * fs
# Android 7.0 and 7.1: the same ratio as CheckLink's tiles.
ls = fs * 1.2 / 0.78
ltx, lty = 54 - cx * ls, 54 - cy * ls
print(f"foreground scale {fs:.4f} translate {ftx:.2f},{fty:.2f}; legacy scale {ls:.4f} translate {ltx:.2f},{lty:.2f}")

fg_comment = ("  Adaptive-icon foreground for GDPRLetterBuilder (ICON-1, draft C, \"Data about you\"),\n"
              "  drawn from android/tools/launcher-icon.svg (64 x 64) by android/tools/make_icons.py. The\n"
              "  mark is scaled and centred on its own bounding box so that every point of it stays\n"
              "  inside the 66 unit safe zone that launchers never crop. Edit the script, not this file.")
with open(os.path.join(res, "drawable/ic_launcher_foreground.xml"), "w", encoding="utf-8") as f:
    f.write(HEAD_XML.format(comment=fg_comment, aapt=AAPT, size=108) + group(fs, ftx, fty, COLOUR) + "\n</vector>\n")

TILE = '    <path android:fillColor="#FF0A1113" android:pathData="M12,0 H96 A12,12 0 0 1 108,12 V96 A12,12 0 0 1 96,108 H12 A12,12 0 0 1 0,96 V12 A12,12 0 0 1 12,0 Z" />\n'
ROUND = '    <path android:fillColor="#FF0A1113" android:pathData="M0,54 A54,54 0 1,0 108,54 A54,54 0 1,0 0,54 Z" />\n'
legacy_comment = "  Android 7.0 and 7.1 have no adaptive icons; this is the same mark on the same dark tile."
with open(os.path.join(res, "mipmap-anydpi/ic_launcher.xml"), "w", encoding="utf-8") as f:
    f.write(HEAD_XML.format(comment=legacy_comment, aapt=AAPT, size=48) + TILE + group(ls, ltx, lty, COLOUR) + "\n</vector>\n")
with open(os.path.join(res, "mipmap-anydpi/ic_launcher_round.xml"), "w", encoding="utf-8") as f:
    f.write(HEAD_XML.format(comment=legacy_comment.replace("tile", "round tile"), aapt=AAPT, size=48) + ROUND
            + group(ls, ltx, lty, COLOUR) + "\n</vector>\n")

mono_comment = ("  Themed-icon layer (Android 13 and later). The launcher tints it with one colour and only\n"
                "  reads its alpha, so it is the outline of the envelope and its flap, and the disc with the\n"
                "  person cut out, without the dark fill that would otherwise turn the envelope solid.")
with open(os.path.join(res, "drawable/ic_launcher_monochrome.xml"), "w", encoding="utf-8") as f:
    f.write(HEAD_XML.format(comment=mono_comment, aapt="", size=108) + group(fs, ftx, fty, MONO) + "\n</vector>\n")
print("written")
