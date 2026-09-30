"""Soundtrack for the film, synthesized with numpy (no sound files).
  python tools/audio.py <frames dir with meta.json> <out.wav> [fps]
  python tools/audio.py --making <out.wav> <duration s> <cue,cue,...>     (the making-of: sea wash and a note per caption)
Layers, driven by the per-frame record the renderer wrote (shot, speed, hour):
  sea      the wash of small waves: pink noise band-passed, slow swells in loudness
  bow      water parted at the stem: a brighter noise band that follows the ship's speed
  hull     low thumps and slaps against the planking, a few per second
  wind     a soft, gusting band in the rigging
  koto     a sparse pentatonic line (in-scale: D E F A B-flat), plucked strings with a long decay, one phrase per shot
  bell     a distant temple bell under the last shot
  gulls    a few calls in the second shot (the islands)
Each shot's sound fades in and out with its picture; the koto carries across the cuts.
"""
import json
import os
import sys
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(5)


def pink(n):
    w = rng.standard_normal(n)
    f = np.fft.rfft(w)
    k = np.arange(len(f)); k[0] = 1
    f /= np.sqrt(k)
    x = np.fft.irfft(f, n)
    return x / np.abs(x).max()


def band(x, lo, hi):
    f = np.fft.rfft(x)
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    m = (fr >= lo) & (fr <= hi)
    edge = np.clip(np.minimum((fr - lo * 0.7) / (lo * 0.3 + 1e-9), (hi * 1.3 - fr) / (hi * 0.3)), 0, 1)
    f *= np.where(m, 1.0, edge)
    return np.fft.irfft(f, len(x))


def env_follow(values, n):
    """per-frame values -> per-sample curve"""
    t = np.linspace(0, len(values) - 1, n)
    return np.interp(t, np.arange(len(values)), values)


def koto_note(freq, dur, amp):
    n = int(SR * dur)
    t = np.arange(n) / SR
    # plucked string: a few inharmonic-ish partials with faster decay up high, a pitch bend at the attack
    bend = 1 + 0.012 * np.exp(-t * 18)
    x = np.zeros(n)
    for h, a in ((1, 1.0), (2, 0.55), (3, 0.3), (4, 0.18), (5, 0.1), (6, 0.06)):
        x += a * np.sin(2 * np.pi * freq * h * 1.0007 ** h * np.cumsum(bend) / SR) * np.exp(-t * (1.6 + 1.1 * h))
    att = np.minimum(t / 0.004, 1)
    return x * att * amp


def bell(dur, amp):
    n = int(SR * dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for f, a, d in ((82, 1.0, 9), (165.5, 0.6, 7), (219, 0.4, 5), (296, 0.25, 3.5), (421, 0.12, 2.2), (575, 0.06, 1.5)):
        x += a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) * (1 + 0.15 * np.sin(2 * np.pi * 1.3 * t))
    return x * np.minimum(t / 0.01, 1) * amp


def gull(amp):
    out = []
    for k in range(int(rng.integers(2, 4))):
        n = int(SR * 0.24)
        t = np.arange(n) / SR
        f = 1500 * np.exp(-t * 2.5) * (1.2 - 0.5 * t / 0.24)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / 0.24) ** 2
        out.append(np.concatenate([x, np.zeros(int(SR * rng.uniform(0.05, 0.12)))]))
    return np.concatenate(out) * amp


def main():
    fr_dir, out = sys.argv[1], sys.argv[2]
    fps = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    meta = json.load(open(os.path.join(fr_dir, 'meta.json')))
    nf = len(meta)
    n = int(nf / fps * SR)
    shot = np.array([m.get('shot', 0) for m in meta])
    speed = np.array([max(m.get('speed', 0), 0) for m in meta])
    # per-shot picture fade (the film dips to black at each cut: 0.35 s in, 0.3 s out)
    fade = np.ones(nf)
    starts = [0] + [i for i in range(1, nf) if shot[i] != shot[i - 1]] + [nf]
    for a, b in zip(starts, starts[1:]):
        for i in range(a, b):
            u, rem = (i - a) / fps, (b - i) / fps
            fade[i] = min(1, u / 0.5) * (min(1, rem / 0.45) if b < nf else 1)
    F = env_follow(fade, n)
    S = env_follow(speed, n)
    sh = env_follow(shot.astype(float), n)
    L = np.zeros(n); R = np.zeros(n)
    # sea wash: stereo pair of pink noise, gently swelling
    t = np.arange(n) / SR
    for ch, ph in ((L, 0.0), (R, 1.7)):
        x = band(pink(n), 180, 3200)
        swell = 0.65 + 0.35 * np.sin(2 * np.pi * t / 5.3 + ph) * np.sin(2 * np.pi * t / 3.1 + ph * 2)
        ch += x * swell * 0.22
    # bow rush: louder with speed; the close shot on the water (shot 2) is loudest
    close = np.clip(1 - np.abs(sh - 2), 0, 1)
    bw = band(pink(n), 700, 6000)
    k = np.clip(S / 4.5, 0, 1) ** 1.3 * (0.35 + 0.9 * close)
    L += bw * k * 0.16; R += np.roll(bw, 900) * k * 0.16
    # hull slaps
    for i in range(int(n / SR * 1.6)):
        at = int(rng.uniform(0, n - SR))
        d = int(SR * rng.uniform(0.2, 0.45))
        x = band(rng.standard_normal(d), 60, 500) * np.exp(-np.arange(d) / (SR * 0.08))
        g = (0.25 + 0.8 * close[at]) * rng.uniform(0.3, 1.0) * 0.5
        p = rng.uniform(-0.6, 0.6)
        L[at:at + d] += x * g * (1 - p) * 0.5; R[at:at + d] += x * g * (1 + p) * 0.5
    # wind in the rigging, calmer in the last shot
    wd = band(pink(n), 250, 900)
    gust = 0.5 + 0.5 * np.sin(2 * np.pi * t / 7.1) ** 2
    calm = np.clip(1 - np.clip(sh - 3.2, 0, 1), 0.25, 1)
    L += wd * gust * calm * 0.12; R += np.roll(wd, 4000) * gust * calm * 0.12
    # gulls in the islands shot
    a = starts[1] / fps
    for off, pan in ((0.8, -0.5), (2.6, 0.4), (4.1, -0.1)):
        g = gull(0.06)
        i0 = int((a + off) * SR)
        L[i0:i0 + len(g)] += g * (1 - pan) * 0.5; R[i0:i0 + len(g)] += g * (1 + pan) * 0.5
    # everything above follows the picture fades
    L *= F; R *= F
    # koto: D in-scale (D, E, F, A, B-flat), one phrase per shot, carried across the cuts
    base = 293.66
    scale = [1, 9 / 8, 6 / 5, 3 / 2, 8 / 5, 2, 9 / 4, 12 / 5]
    phrases = [[(0.3, 5, 0.8), (1.5, 3, 0.6), (2.3, 4, 0.55), (3.6, 0, 0.7)],
               [(0.2, 6, 0.6), (1.1, 5, 0.5), (1.7, 3, 0.5), (3.0, 4, 0.55), (4.4, 2, 0.45)],
               [(0.4, 3, 0.5), (1.4, 5, 0.45), (2.6, 7, 0.4)],
               [(0.2, 4, 0.6), (1.3, 3, 0.55), (2.1, 2, 0.5), (3.4, 0, 0.65), (4.6, 1, 0.4)],
               [(0.5, 3, 0.5), (1.9, 0, 0.6), (3.0, 5, 0.35)]]
    for si, (a, b) in enumerate(zip(starts, starts[1:])):
        if si >= len(phrases):
            break
        for off, deg, amp in phrases[si]:
            f0 = base * scale[deg] / (2 if si == 4 else 1)
            x = koto_note(f0, 4.5, amp * 0.07)
            i0 = int((a / fps + off) * SR)
            x = x[:max(0, n - i0)]
            pan = 0.25 * np.sin(deg * 1.3)
            L[i0:i0 + len(x)] += x * (1 - pan); R[i0:i0 + len(x)] += x * (1 + pan)
    # the bell under the last shot
    b = bell(9.0, 0.11)
    i0 = int((starts[4] / fps + 0.9) * SR)
    b = b[:max(0, n - i0)]
    L[i0:i0 + len(b)] += b; R[i0:i0 + len(b)] += b * 0.92
    # a little room: short stereo delay, then fade the very end
    for ch, dl in ((L, 1900), (R, 2300)):
        ch += np.concatenate([np.zeros(dl), ch[:-dl]]) * 0.18
    tail = np.minimum(1, (n - np.arange(n)) / (SR * 1.2))
    L *= tail; R *= tail
    peak = max(np.abs(L).max(), np.abs(R).max())
    st = (np.stack([L, R], 1) / peak * 0.89 * 32767).astype('<i2')
    with wave.open(out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(st.tobytes())
    print('AUDIO', out, round(n / SR, 2), 's')


def making(out, dur, cues):
    """Soundtrack for the making-of: a quiet sea wash and wind, one koto note at each caption (cues in seconds)"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    L = band(pink(n), 180, 3000) * 0.16 * (0.7 + 0.3 * np.sin(2 * np.pi * t / 5.1))
    R = band(pink(n), 180, 3000) * 0.16 * (0.7 + 0.3 * np.sin(2 * np.pi * t / 4.3 + 1.1))
    base = 293.66
    scale = [1, 9 / 8, 6 / 5, 3 / 2, 8 / 5, 2, 9 / 4]
    degs = [5, 3, 4, 6, 2, 0, 3]
    for k, c in enumerate(cues):
        x = koto_note(base * scale[degs[k % len(degs)]], 4.0, 0.075)
        i0 = int(c * SR); x = x[:max(0, n - i0)]
        L[i0:i0 + len(x)] += x; R[i0:i0 + len(x)] += x * 0.9
        if k == len(cues) - 1:       # the last caption: a low note under it
            y = koto_note(base / 2, 5.0, 0.06)[:max(0, n - i0)]
            L[i0:i0 + len(y)] += y; R[i0:i0 + len(y)] += y
    # the build part (before the first sea cue) has the sea wash lower: it is a studio, not the sea
    ramp = np.clip((t - (cues[1] - 0.6)) / 0.8, 0.25, 1)
    L *= ramp; R *= ramp
    tail = np.minimum(1, (n - np.arange(n)) / (SR * 1.0)) * np.minimum(1, t / 0.3)
    L *= tail; R *= tail
    peak = max(np.abs(L).max(), np.abs(R).max())
    st = (np.stack([L, R], 1) / peak * 0.89 * 32767).astype('<i2')
    with wave.open(out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(st.tobytes())
    print('AUDIO', out, round(dur, 2), 's')


if __name__ == '__main__':
    if sys.argv[1] == '--making':
        # python tools/audio.py --making <out.wav> <duration> <cue,cue,...>
        making(sys.argv[2], float(sys.argv[3]), [float(c) for c in sys.argv[4].split(',')])
    else:
        main()
