"""Probe: open the page, drive it through a script, and record state and screenshots.
  python tools/probe.py <script.json> <output dir>
The script is a list like [{"t": sec, "js": "expr"}, {"t": sec, "shot": "name"}]. t is seconds since load finished.
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
    h = functools.partial(Quiet, directory=ROOT)
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1]


def main():
    plan = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    query = sys.argv[3] if len(sys.argv) > 3 else ""
    os.makedirs(out, exist_ok=True)
    port = serve()
    log = []
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=False,
                              args=["--window-position=-2400,0", "--ignore-gpu-blocklist"])
        pg = b.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
        pg.on("console", lambda m: log.append(f"[{m.type}] {m.text}"))
        pg.on("pageerror", lambda e: log.append(f"[pageerror] {e}"))
        t0 = time.time()
        pg.goto(f"http://127.0.0.1:{port}/index.html{query}")
        pg.wait_for_function("window.__ready === true", timeout=60000)
        print("ready", round(time.time() - t0, 1), "s")
        t0 = time.time()
        for step in sorted(plan, key=lambda s: s["t"]):
            while time.time() - t0 < step["t"]:
                time.sleep(0.02)
            if "js" in step:
                r = pg.evaluate(step["js"])
                if r is not None:
                    print(f"{step['t']:6.2f}", json.dumps(r, ensure_ascii=False))
            if "shot" in step:
                pg.screenshot(path=os.path.join(out, step["shot"] + ".png"))
        b.close()
    for line in log:
        print(line)


main()
