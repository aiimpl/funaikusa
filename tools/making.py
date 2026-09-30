"""Assemble the making-of film: the Blender assembly stills, then the browser frames, with English captions.
  python tools/making.py <steps dir> <frames dir> <out frames dir>
Writes 1920x1080 PNG frames (30 fps). The caption for each scene fades in, holds and fades out in the lower left.
The browser part is recorded with QUERY="&making" tools/render.py (film.js MAKING); its scene lengths are read here.
"""
import glob
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

FPS = 30
W, H = 1920, 1080
# browser scenes in film.js MAKING order, with their captions
SCENES = [
    (3.2, '16 Gerstner waves. The same equations float the ship'),
    (2.8, '+ 40 ripples, broken into groups by the wind'),
    (2.8, '+ reflections and sun glints'),
    (3.8, 'Haze thins with height, and the earth curves away'),
    (3.2, 'Shiomachi. Play it in your browser'),
]
BUILD_CAPTION = 'Every plank is code. Python builds the ship in Blender'
STEP_HOLD, LAST_HOLD, XFADE = 0.42, 1.3, 0.12


def font(size):
    for f in ('/System/Library/Fonts/Supplemental/Baskerville.ttc', '/System/Library/Fonts/Supplemental/Georgia.ttf',
              '/Library/Fonts/Georgia.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


FONT = font(46)
SMALL = font(26)


def caption(img, text, alpha, sub=None):
    if alpha <= 0:
        return img
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = 80, H - 150
    # soft dark band behind the text so it reads on bright water
    band = Image.new('RGBA', img.size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    for i in range(60):
        a = int(110 * (i / 60) ** 1.6 * alpha)
        bd.rectangle((0, H - 230 + i * 4, W, H - 226 + i * 4), fill=(0, 0, 0, a))
    img = Image.alpha_composite(img.convert('RGBA'), band)
    d.text((x + 2, y + 2), text, font=FONT, fill=(0, 0, 0, int(120 * alpha)))
    d.text((x, y), text, font=FONT, fill=(244, 239, 230, int(255 * alpha)))
    if sub:
        d.text((x, y + 62), sub, font=SMALL, fill=(244, 239, 230, int(190 * alpha)))
    return Image.alpha_composite(img, layer)


def cap_alpha(t, dur):
    return min(1.0, t / 0.4, (dur - t) / 0.35) if dur > 0.8 else 1.0


def main():
    steps_dir, frames_dir, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(out, '*.png')):
        os.remove(f)
    n = 0

    def put(img):
        nonlocal n
        img.convert('RGB').save(os.path.join(out, f'{n:05d}.png'))
        n += 1

    # part 1: the assembly, each step held briefly with a short cross-fade, the last held longer
    steps = sorted(glob.glob(os.path.join(steps_dir, 'step_*.png')), key=lambda p: int(re.search(r'step_(\d+)', p).group(1)))
    ims = [Image.open(p).convert('RGBA').resize((W, H), Image.LANCZOS) for p in steps]
    total = STEP_HOLD * (len(ims) - 1) + LAST_HOLD
    t = 0.0
    for i, im in enumerate(ims):
        hold = LAST_HOLD if i == len(ims) - 1 else STEP_HOLD
        for k in range(int(round(hold * FPS))):
            u = k / FPS
            frame = im
            if i > 0 and u < XFADE:
                frame = Image.blend(ims[i - 1], im, u / XFADE)
            # fade in from black at the very start
            if t < 0.3:
                frame = Image.blend(Image.new('RGBA', (W, H), (0, 0, 0, 255)), frame, t / 0.3)
            put(caption(frame, BUILD_CAPTION, cap_alpha(t, total)))
            t += 1 / FPS
    # part 2: the browser frames, captions per scene
    frames = sorted(glob.glob(os.path.join(frames_dir, '*.png')))
    bounds, acc = [], 0.0
    for dur, text in SCENES:
        bounds.append((acc, acc + dur, text)); acc += dur
    for i, p in enumerate(frames):
        ts = i / FPS
        im = Image.open(p).convert('RGBA').resize((W, H), Image.LANCZOS)
        for a, b, text in bounds:
            if a <= ts < b:
                sub = 'aiimpl.github.io/shiomachi' if b == bounds[-1][1] else None
                im = caption(im, text, cap_alpha(ts - a, b - a) if b != bounds[-1][1] else min(1.0, (ts - a) / 0.4), sub)
                break
        put(im)
    print('MAKING frames', n, round(n / FPS, 2), 's')


if __name__ == '__main__':
    main()
