"""S-011 self-check: load the extension unpacked in Chrome, save a real article page twice.
Usage: python3 tools/extension_check.py http://127.0.0.1:4320 CAPTURE_KEY ARTICLE_URL"""
import sys, hashlib, os, tempfile, json
from playwright.sync_api import sync_playwright

server, key, article = sys.argv[1:4]
import shutil
src = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'extension'))
# Test copy: grants the test page's origin, standing in for the click that grants activeTab.
ext = os.path.join(tempfile.mkdtemp(), 'extension'); shutil.copytree(src, ext)
m = json.load(open(ext + '/manifest.json')); m['host_permissions'].append('http://127.0.0.1:8099/*'); json.dump(m, open(ext + '/manifest.json', 'w'))
ext_id = ''.join(chr(ord('a') + int(c, 16)) for c in hashlib.sha256(ext.encode()).hexdigest()[:32])
profile = tempfile.mkdtemp()
results = {}
def wait_done(pop):
    # Extension pages forbid eval, so poll the status text from Python.
    for _ in range(100):
        if 'Saving' not in pop.inner_text('#status'): return
        pop.wait_for_timeout(200)
    raise SystemExit('popup did not finish')
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(profile, executable_path='/usr/bin/google-chrome', headless=False,
        args=['--headless=new', '--no-sandbox', f'--disable-extensions-except={ext}', f'--load-extension={ext}'])
    opt = ctx.new_page()
    opt.goto(f'chrome-extension://{ext_id}/options.html')
    page = ctx.new_page(); page.goto(article); page.wait_for_load_state('domcontentloaded')
    tab_id = opt.evaluate("async () => (await chrome.tabs.query({})).filter(t => !(t.url || '').startsWith('chrome')).pop().id")
    # Fresh install: the popup shows its own settings, then saves the page once they're filled in.
    pop = ctx.new_page(); pop.goto(f'chrome-extension://{ext_id}/popup.html?tab={tab_id}')
    pop.wait_for_selector('#settings:not([hidden])')
    results['fresh popup'] = [pop.inner_text('#saved')]
    pop.fill('#server', server); pop.fill('#key', ' ' + key + ' '); pop.fill('#clientId', 'not-an-id')
    pop.click('#settings button[type=submit]'); pop.wait_for_timeout(300)
    results['bad client id'] = [pop.inner_text('#saved')]
    pop.fill('#clientId', ''); pop.click('#settings button[type=submit]')
    wait_done(pop)
    results['after settings'] = [pop.inner_text('#status')]
    pop.screenshot(path=os.environ.get('SNAP', '/tmp') + '/extension-settings.png')
    pop.close()
    for attempt in ['first', 'second']:
        pop = ctx.new_page(); pop.goto(f'chrome-extension://{ext_id}/popup.html?tab={tab_id}')
        wait_done(pop)
        results[attempt] = [pop.inner_text('#status'), pop.inner_text('#title')]
        pop.screenshot(path=os.environ.get('SNAP', '/tmp') + f'/extension-{attempt}.png')
        pop.close()
    opt.reload(); opt.fill('#key', 'wrong-key'); opt.click('button[type=submit]'); opt.wait_for_timeout(300)
    pop = ctx.new_page(); pop.goto(f'chrome-extension://{ext_id}/popup.html?tab={tab_id}')
    wait_done(pop)
    results['wrong key'] = [pop.inner_text('#status')]
    ctx.close()
print(json.dumps(results, indent=1, ensure_ascii=False))
