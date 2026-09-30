"""Soundtrack for the film, synthesized with numpy (no sound files).
  python tools/audio.py <frames dir with meta.json> <out.wav> [fps]
Driven by the per-frame record the renderer wrote (shot, battle, fire nearby, and the sound events of that frame:
guns going off, balls landing and striking, each with its distance and pan from the camera):
  sea      the wash of small waves: pink noise band-passed, slow swells in loudness
  guns     a crack, a body and a long low roll for each great gun; each arrives distance / 343 m/s after the flash
           and is duller the further away it is; muskets are short dry cracks
  shot     balls landing (a heavy splash), striking timber (a splintering crunch)
  drum     the war drum (jin-daiko) once the battle is joined: a steady beat for the oars
  conch    the horagai at the start of the battle
  fire     crackle and roar while a burning ship is near the camera
  oars     the creak and swish of the sculling oars in the close shot beside the atake
  koto     two low notes under the title
Each shot's sound fades in and out with its picture.
"""
import json
import os
import sys
import wave

import numpy as np

SR = 48000
C = 343.0
rng = np.random.default_rng(7)


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


def lowpass(x, cut):
    f = np.fft.rfft(x)
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    f *= 1 / (1 + (fr / max(cut, 1)) ** 2)
    return np.fft.irfft(f, len(x))


def env_follow(values, n):
    t = np.linspace(0, len(values) - 1, n)
    return np.interp(t, np.arange(len(values)), values)


def burst(dur, lo, hi, decay, attack=0.003):
    n = int(SR * dur)
    t = np.arange(n) / SR
    x = band(rng.standard_normal(n), lo, hi)
    return x * np.minimum(t / attack, 1) * np.exp(-t / decay)


def big_gun(d):
    """crack + body + roll, dulled and quieted with distance"""
    crack = burst(0.25, 1200, 7000, 0.04, 0.001) * 0.8
    body = burst(1.4, 40, 400, 0.35, 0.002) * 1.8
    roll = burst(5.0, 25, 160, 1.6, 0.08) * 0.9
    n = len(roll)
    x = np.zeros(n)
    x[:len(crack)] += crack; x[:len(body)] += body; x += roll
    x = lowpass(x, 300 + 11000 * np.exp(-d / 500))
    return x / (1 + d / 80)


def musket(d):
    x = np.zeros(int(SR * 0.4))
    c = burst(0.1, 1500, 9000, 0.015, 0.0005)
    b = burst(0.4, 100, 900, 0.07, 0.001) * 0.5
    x[:len(c)] += c; x[:len(b)] += b
    return lowpass(x, 400 + 9000 * np.exp(-d / 300)) / (1 + d / 60) * 0.5


def splash(d, big):
    x = burst(1.6 if big else 0.6, 250, 3500, 0.35 if big else 0.12, 0.02) * (0.5 if big else 0.12)
    return lowpass(x, 400 + 8000 * np.exp(-d / 400)) / (1 + d / 60)


def strike(d):
    x = np.zeros(int(SR * 0.7))
    a = burst(0.18, 800, 5000, 0.03, 0.0005) * 0.7
    b = burst(0.6, 120, 1200, 0.12, 0.002) * 0.6
    x[:len(a)] += a; x[:len(b)] += b
    return lowpass(x, 500 + 9000 * np.exp(-d / 400)) / (1 + d / 60)


def drum(amp):
    n = int(SR * 1.0)
    t = np.arange(n) / SR
    f = 52 + 43 * np.exp(-t * 9)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.28)
    x += band(rng.standard_normal(n), 100, 900) * np.exp(-t / 0.03) * 0.4
    return x * np.minimum(t / 0.004, 1) * amp


def conch(dur, amp):
    n = int(SR * dur)
    t = np.arange(n) / SR
    f0 = 233 * (0.94 + 0.06 * np.minimum(t / 0.4, 1)) * (1 + 0.004 * np.sin(2 * np.pi * 5.2 * t))
    ph = 2 * np.pi * np.cumsum(f0) / SR
    x = sum(np.sin(ph * h) / h ** 1.2 for h in range(1, 9))
    x = band(x, 250, 1600) + band(rng.standard_normal(n), 900, 2500) * 0.05
    e = np.minimum(t / 0.5, 1) * np.minimum((dur - t) / 0.6, 1)
    return x * e * amp


def koto_note(freq, dur, amp):
    n = int(SR * dur)
    t = np.arange(n) / SR
    bend = 1 + 0.012 * np.exp(-t * 18)
    x = np.zeros(n)
    for h, a in ((1, 1.0), (2, 0.55), (3, 0.3), (4, 0.18), (5, 0.1), (6, 0.06)):
        x += a * np.sin(2 * np.pi * freq * h * 1.0007 ** h * np.cumsum(bend) / SR) * np.exp(-t * (1.6 + 1.1 * h))
    return x * np.minimum(t / 0.004, 1) * amp


def add(L, R, x, t, pan, g=1.0):
    i0 = int(t * SR)
    if i0 >= len(L) or i0 < 0:
        return
    x = x[:len(L) - i0] * g
    L[i0:i0 + len(x)] += x * (1 - pan) * 0.5 * 2 ** 0.5
    R[i0:i0 + len(x)] += x * (1 + pan) * 0.5 * 2 ** 0.5


def main():
    fr_dir, out = sys.argv[1], sys.argv[2]
    fps = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    meta = json.load(open(os.path.join(fr_dir, 'meta.json')))
    nf = len(meta)
    n = int(nf / fps * SR)
    shot = np.array([m.get('shot', 0) for m in meta])
    fire = np.array([m.get('fire', 0) for m in meta], float)
    battle = np.array([1.0 if m.get('battle') else 0.0 for m in meta])
    # picture fades at the cuts
    fade = np.ones(nf)
    starts = [0] + [i for i in range(1, nf) if shot[i] != shot[i - 1]] + [nf]
    for a, b in zip(starts, starts[1:]):
        for i in range(a, b):
            u, rem = (i - a) / fps, (b - i) / fps
            fade[i] = min(1, u / 0.35) * (min(1, rem / 0.3) if b < nf else 1)
    F = env_follow(fade, n)
    L = np.zeros(n); R = np.zeros(n)
    t = np.arange(n) / SR
    # sea wash
    for ch, ph in ((L, 0.0), (R, 1.7)):
        x = band(pink(n), 180, 3200)
        ch += x * (0.65 + 0.35 * np.sin(2 * np.pi * t / 5.3 + ph)) * 0.13
    # fire bed: roar and crackle following how much fire is near
    FI = env_follow(fire, n)
    roar = band(pink(n), 60, 700) * 0.25 + band(rng.standard_normal(n), 2000, 8000) * 0.05
    L += roar * FI; R += np.roll(roar, 3000) * FI
    for i in range(int(n / SR * 25)):
        at = rng.uniform(0, n / SR)
        k = FI[min(int(at * SR), n - 1)]
        if k > 0.05 and rng.random() < k:
            add(L, R, burst(0.05, 2000, 9000, 0.008, 0.0005) * 0.35 * k, at, rng.uniform(-0.6, 0.6))
    # oars in the close shot (shot 1): a creak and a swish every stroke (~2.4 s), from many oars a little apart
    a1, b1 = starts[1] / fps, starts[2] / fps
    tt = a1 + 0.2
    while tt < b1:
        for k in range(6):
            off = rng.uniform(0, 0.35)
            add(L, R, burst(0.35, 300, 1800, 0.12, 0.05) * 0.08, tt + off, rng.uniform(-0.3, 0.5))
            add(L, R, band(np.sin(2 * np.pi * np.cumsum(np.full(int(SR * 0.3), rng.uniform(180, 320))) / SR) * np.hanning(int(SR * 0.3)), 400, 2500) * 0.03, tt + 0.9 + off, rng.uniform(-0.3, 0.5))
        tt += 2.4
    # the battle's own sounds: guns, muskets, balls landing and striking
    for m in meta:
        for (te, kind, typ, d, pan) in m.get('ev', []):
            delay = d / C
            if kind == 'fire':
                x = big_gun(d) if typ == 'oozutsu' else musket(d) if typ == 'teppo' else big_gun(d) * 0.5
                add(L, R, x, te + delay, pan)
            elif kind == 'splash':
                add(L, R, splash(d, typ == 'oozutsu'), te + delay, pan)
            elif kind == 'hit':
                add(L, R, strike(d), te + delay, pan)
    L *= F; R *= F
    # war drum once the battle is joined: don ... don-don, a bar every 1.8 s
    B = env_follow(battle, n)
    bar = 1.8
    tt = 0.0
    while tt < n / SR - 0.5:
        k = B[int(tt * SR)] * F[int(tt * SR)]
        if k > 0.1:
            for off, amp in ((0.0, 0.5), (0.9, 0.35), (1.2, 0.42)):
                add(L, R, drum(amp * 0.5 * k), tt + off, -0.15)
        tt += bar
    # conch at the start of the battle shots
    add(L, R, conch(2.4, 0.09), a1 + 0.3, 0.2)
    add(L, R, conch(3.0, 0.08), a1 + 2.9, 0.2)
    # koto under the title
    base = 146.83
    for off, mul, amp in ((0.2, 1.0, 0.09), (1.4, 1.5, 0.07), (2.6, 1.2, 0.06)):
        add(L, R, koto_note(base * mul, 4.0, amp), starts[-2] / fps + 3.0 + off, 0.1)
    # a little room, and the end fade
    for ch, dl in ((L, 1900), (R, 2300)):
        ch += np.concatenate([np.zeros(dl), ch[:-dl]]) * 0.16
    tail = np.minimum(1, (n - np.arange(n)) / (SR * 1.0))
    L *= tail; R *= tail
    peak = max(np.abs(L).max(), np.abs(R).max())
    st = (np.stack([L, R], 1) / peak * 0.89 * 32767).astype('<i2')
    with wave.open(out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(st.tobytes())
    print('AUDIO', out, round(n / SR, 2), 's', 'events', sum(len(m.get('ev', [])) for m in meta))


if __name__ == '__main__':
    main()
