"""Bama-style snapshots: every M1 page at phone and desktop width, light and dark.
Usage: python3 tools/snap.py http://127.0.0.1:4320 OUTDIR"""
import sys, json, os, time
from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
problems = []

def check(page, name):
    # No horizontal overflow at any width.
    w = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    if w[0] > w[1] + 1: problems.append(f"{name}: horizontal overflow {w}")

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    for scheme in ["light", "dark"]:
        for label, size in [("phone", {"width": 390, "height": 844}), ("desktop", {"width": 1280, "height": 900})]:
            ctx = browser.new_context(viewport=size, color_scheme=scheme, device_scale_factor=2 if label == "phone" else 1)
            page = ctx.new_page()
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            tag = f"{label}-{scheme}"
            page.goto(base + "/"); page.wait_for_selector(".queue, .empty")
            page.wait_for_timeout(600); check(page, "queue " + tag)
            page.screenshot(path=f"{out}/queue-{tag}.png", full_page=(label == "phone"))
            page.fill("#search", "chaos"); page.wait_for_timeout(700)
            page.screenshot(path=f"{out}/search-{tag}.png")
            page.fill("#search", "zebra crossing"); page.wait_for_timeout(700)
            page.screenshot(path=f"{out}/search-none-{tag}.png")
            page.fill("#search", ""); page.wait_for_timeout(600)
            page.click("text=The Hidden Heroines of Chaos"); page.wait_for_selector(".prose")
            page.wait_for_timeout(500); check(page, "reader " + tag)
            page.screenshot(path=f"{out}/reader-{tag}.png")
            page.click("text=Living Gently with Chronic Pain") if False else None
            page.click("#finish-open"); page.wait_for_selector("dialog[open]")
            page.click("label[for=star4]"); page.wait_for_timeout(200)
            page.screenshot(path=f"{out}/finish-{tag}.png")
            page.click("button[value=cancel]")
            page.goto(base + "/"); page.wait_for_selector(".queue")
            page.click("text=Living Gently with Chronic Pain"); page.wait_for_selector("#open-original")
            page.screenshot(path=f"{out}/reader-link-{tag}.png")
            if errors: problems.append(f"{tag} console: {errors}")
            ctx.close()
    browser.close()
print(json.dumps(problems, indent=1) if problems else "no layout overflow or console errors")
