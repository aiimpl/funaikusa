"""Record the film: open the page with ?render, step it frame by frame with __renderAt(frame, fps) and save each frame.
The page draws at 2x (3200 x 1800); frames are saved at that size and scaled down when encoding.
  python tools/render.py <output dir> [first last fps]      e.g. python tools/render.py build/frames 0 780 30
QUERY adds to the page query (QUERY="&making" records the making-of).
Existing frames are skipped, so an interrupted run resumes (the page replays the film up to that point).
Chrome runs in an off-screen window (headless WebGL is slow or stalls).
"""
import functools
import http.server
import json
import os
import sys
import threading
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1]


def main():
    out = sys.argv[1]
    f0 = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    f1 = int(sys.argv[3]) if len(sys.argv) > 3 else -1
    fps = int(sys.argv[4]) if len(sys.argv) > 4 else 30
    os.makedirs(out, exist_ok=True)
    port = serve()
    log, meta = [], []
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=False, args=["--window-position=-3400,0", "--ignore-gpu-blocklist"])
        pg = b.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=2)
        pg.on("pageerror", lambda e: log.append(f"[pageerror] {e}"))
        pg.set_default_timeout(300000)
        pg.goto(f"http://127.0.0.1:{port}/index.html?render{os.environ.get('QUERY', '')}")
        pg.wait_for_function("window.__ready === true", timeout=180000)
        pg.evaluate("document.fonts.ready")
        if f1 < 0:
            f1 = int(round(pg.evaluate("window.__filmLen") * fps))
        frames = [f for f in range(f0, f1) if not os.path.exists(os.path.join(out, f"{f:05d}.png"))]
        t0 = time.time()
        for n, f in enumerate(frames):
            r = pg.evaluate(f"window.__renderAt({f}, {fps})")
            pg.screenshot(path=os.path.join(out, f"{f:05d}.png"))
            meta.append({"f": f, **r})
            if n % 30 == 0:
                print(f"frame {f}/{f1}  shot {r.get('shot')}  {(time.time() - t0) / (n + 1):.2f}s/frame", flush=True)
        b.close()
    mp = os.path.join(out, "meta.json")
    old = {m["f"]: m for m in json.load(open(mp))} if os.path.exists(mp) else {}
    old.update({m["f"]: m for m in meta})
    json.dump([old[k] for k in sorted(old)], open(mp, "w"))
    for line in log[:20]:
        print(line)


main()
