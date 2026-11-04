"""Browser flow checks for M1: position restore (S-008), Lucky Dip (S-006),
Finish with rating then Delete (S-010), order remembered (S-004), text size.
Usage: python3 tools/flow_check.py http://127.0.0.1:4320"""
import sys, json
from playwright.sync_api import sync_playwright
base = sys.argv[1]; out = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 390, 'height': 844})
    pg.goto(base + '/'); pg.wait_for_selector('.queue')
    pg.click('text=Mozilla - Wikipedia'); pg.wait_for_selector('.prose')
    pg.evaluate("window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.5)")
    pg.wait_for_timeout(2200)  # position is sent 1.5 s after scrolling stops
    pg.click('a.back'); pg.wait_for_selector('.queue')
    out['continue reading'] = pg.inner_text('.continue')
    pg.click('a.continue'); pg.wait_for_selector('.prose'); pg.wait_for_timeout(400)
    out['restored position'] = round(pg.evaluate("scrollY / (document.documentElement.scrollHeight - innerHeight)"), 2)
    pg.click('.sizes button[data-size=large]')
    out['text size after reload'] = (pg.reload(), pg.wait_for_selector('.prose'), pg.evaluate("document.documentElement.dataset.size"))[2]
    pg.goto(base + '/'); pg.wait_for_selector('.queue')
    pg.select_option('#order', 'shortest'); pg.wait_for_timeout(500)
    pg.reload(); pg.wait_for_selector('.queue')
    out['order after reload'] = pg.input_value('#order')
    before = pg.inner_text('.count')
    pg.click('#lucky'); pg.wait_for_selector('article'); out['lucky dip opened'] = pg.inner_text('h1')
    pg.click('#finish-open, #finish-end >> nth=0'); pg.wait_for_selector('dialog[open]')
    pg.click('label[for=star5]'); pg.click('button[value=delete]')
    pg.wait_for_selector('.queue'); pg.wait_for_timeout(300)
    out['toast'] = pg.inner_text('.toast'); out['count'] = [before, pg.inner_text('.count')]
    pg.select_option('#order', 'oldest'); pg.wait_for_timeout(300)
    b.close()
print(json.dumps(out, indent=1, ensure_ascii=False))
