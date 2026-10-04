"""One-account browser worker driven by undetected-chromedriver.

The parent sends secrets on stdin. Only bounded, non-secret status events go to
stdout. A persistent Chrome profile is accepted as a session only after a
second browser process verifies an account control on Facebook.
"""

import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from urllib.parse import urlparse

import requests
import undetected_chromedriver as uc
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys


STATE_DIR = Path(os.environ.get('FB_SESSION_STATE_DIR', '/root/.local/state/facebook-session-console'))
SESSION_FILE = STATE_DIR / 'storage-state.json'
PROFILE_DIR = STATE_DIR / 'browser-profile'
CHROME_PATH = os.environ.get('FB_CHROME_PATH', '/root/.cache/ms-playwright/chromium-1187/chrome-linux/chrome')
FACEBOOK = 'https://www.facebook.com'
STAGE = 'reading input'

ARKOSE_HOOK = r"""
(() => {
  const hooked = new Set();
  function hook(name) {
    if (!/^[a-zA-Z_$][\w$]{0,80}$/.test(name) || hooked.has(name)) return;
    hooked.add(name);
    let current = globalThis[name];
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() { return current },
      set(fn) {
        if (typeof fn !== 'function') { current = fn; return }
        current = function(enforcer) {
          const original = enforcer.setConfig;
          enforcer.setConfig = function(config) {
            if (typeof config?.onCompleted === 'function') {
              globalThis.__sessionConsoleArkoseComplete = config.onCompleted;
              globalThis.__sessionConsoleArkoseData = config.data ?? null;
              globalThis.__sessionConsoleArkoseKey = config.publicKey ?? null;
            }
            return original.call(this, config);
          };
          return fn.call(this, enforcer);
        };
      }
    });
    if (typeof current === 'function') globalThis[name] = current;
  }
  hook('setupEnforcement');
  new MutationObserver(() => {
    for (const script of document.querySelectorAll('script[data-callback][src]')) {
      if (script.src.includes('arkoselabs')) hook(script.getAttribute('data-callback') ?? '');
    }
  }).observe(document, { subtree: true, childList: true });
})();
"""


def report(phase, result=''):
    print(json.dumps({'phase': phase, 'result': result}, ensure_ascii=False), flush=True)


def totp(secret, now=None):
    key = base64.b32decode(secret.upper().replace(' ', ''), casefold=True)
    counter = int((time.time() if now is None else now) // 30).to_bytes(8, 'big')
    digest = hmac.new(key, counter, hashlib.sha1).digest()
    offset = digest[-1] & 15
    return f'{(int.from_bytes(digest[offset:offset + 4], "big") & 0x7fffffff) % 1000000:06d}'


def classify(facts):
    for key, label in [('identity', 'identity'), ('captcha', 'captcha')]:
        if facts.get(key):
            return label
    if facts.get('login'):
        return 'login-rejected' if facts.get('rejected') else 'login'
    if facts.get('other_code'):
        return 'other-code'
    if facts.get('code_step'):
        return 'two-factor' if facts.get('code') else 'two-factor-loading'
    if facts.get('checkpoint'):
        return 'checkpoint'
    if facts.get('has_cookies') and facts.get('account_control'):
        return 'authenticated'
    return 'unknown'


def browser():
    global STAGE
    STAGE = 'launching undetected Chrome'
    PROFILE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    PROFILE_DIR.chmod(0o700)
    options = uc.ChromeOptions()
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--window-size=1280,800')
    options.add_argument('--lang=en-US')
    version = subprocess.run([CHROME_PATH, '--version'], capture_output=True, text=True, check=True).stdout
    major = int(re.search(r'(\d+)\.', version).group(1))
    driver = uc.Chrome(options=options, browser_executable_path=CHROME_PATH,
                       version_main=major, user_data_dir=str(PROFILE_DIR),
                       headless=not bool(os.environ.get('DISPLAY')), use_subprocess=False)
    driver.set_page_load_timeout(30)
    driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {'source': ARKOSE_HOOK})
    return driver


def visible(driver, selector):
    try:
        return [el for el in driver.find_elements(By.CSS_SELECTOR, selector) if el.is_displayed()]
    except WebDriverException:
        return []


def frame_walk(driver, visitor, path=()):
    """Visit visible frames; always restore the top-level browsing context."""
    def descend(current):
        visitor(current)
        frames = driver.find_elements(By.CSS_SELECTOR, 'iframe,frame')
        for index, frame in enumerate(frames):
            try:
                if not frame.is_displayed():
                    continue
                driver.switch_to.frame(frame)
                descend(current + (index,))
                driver.switch_to.parent_frame()
            except (WebDriverException, IndexError):
                driver.switch_to.default_content()
                switch_frame(driver, current)
    driver.switch_to.default_content()
    try:
        descend(path)
    finally:
        driver.switch_to.default_content()


def switch_frame(driver, path):
    driver.switch_to.default_content()
    for index in path:
        driver.switch_to.frame(driver.find_elements(By.CSS_SELECTOR, 'iframe,frame')[index])


def select_code_inputs(fields):
    candidates = []
    for index, field in enumerate(fields):
        kind = (field.get('type') or 'text').lower()
        hint = ' '.join(str(field.get(name) or '') for name in ('name', 'id', 'placeholder', 'aria-label', 'autocomplete')).lower()
        if field.get('disabled') or field.get('readonly') or kind not in ('text', 'tel', 'number', 'password'):
            continue
        if re.search(r'email|username|search|password', hint):
            continue
        max_length = int(field.get('maxlength') or -1)
        score = (5 if re.search(r'one-time-code|otp|2fa|verification|security.?code|approvals.?code', hint) else 0)
        score += 2 if 'code' in hint else 0
        score += 2 if field.get('inputmode') == 'numeric' else 0
        score += 2 if 4 <= max_length <= 8 else 0
        if kind == 'password' and score == 0:
            continue
        candidates.append((index, score, max_length))
    if len(candidates) == 1:
        return ('single', [candidates[0][0]])
    if len(candidates) == 6 and all(item[2] == 1 for item in candidates):
        return ('segmented', [item[0] for item in candidates])
    ranked = sorted(candidates, key=lambda item: item[1], reverse=True)
    if ranked and ranked[0][1] >= 2 and (len(ranked) == 1 or ranked[0][1] > ranked[1][1]):
        return ('single', [ranked[0][0]])
    return None


def detect(driver):
    first_url = driver.current_url
    driver.switch_to.default_content()
    try:
        text = driver.find_element(By.TAG_NAME, 'body').text
    except WebDriverException:
        text = ''
    found = {'captcha': bool(re.search(r'complete a challenge to verify|solve a puzzle to continue', text, re.I)), 'selected': None}

    def inspect(path):
        try:
            location = urlparse(driver.execute_script('return location.href'))
            if location.hostname and (location.hostname.endswith('.arkoselabs.com') or location.hostname == 'www.fbsbx.com' and location.path.startswith('/captcha/arkose/')):
                found['captcha'] = True
            fields = driver.execute_script('return [...document.querySelectorAll("input")].filter(e => e.getClientRects().length).map(e => ({type:e.type,name:e.name,id:e.id,placeholder:e.placeholder,"aria-label":e.getAttribute("aria-label"),autocomplete:e.autocomplete,inputmode:e.inputMode,maxlength:e.maxLength,disabled:e.disabled,readonly:e.readOnly}))')
            selected = select_code_inputs(fields)
            if selected and found['selected'] is None:
                found['selected'] = (path, selected)
        except WebDriverException:
            pass

    frame_walk(driver, inspect)
    driver.switch_to.default_content()
    cookies = {cookie.get('name') for cookie in driver.get_cookies()}
    pathname = urlparse(first_url).path
    facts = {
        'identity': bool(re.search(r'video selfie|identity confirmation in progress|upload.{0,80}\b(?:ID|identity document)\b', text, re.I)),
        'captcha': found['captcha'],
        'login': bool(visible(driver, 'input[name="email"],input[name="pass"]')),
        'rejected': bool(re.search(r'incorrect password|wrong password|incorrect email|incorrect username', text, re.I)),
        'other_code': bool(re.search(r'(?:sent|send|check).{0,50}(?:email|text message|SMS)|code.{0,30}(?:email|text message|SMS)', text, re.I)) and not bool(re.search(r'authentication app|authenticator app', text, re.I)),
        'code_step': bool(re.search(r'/two_step_verification/two_factor/?$', pathname) or re.search(r'authentication app|authenticator app', text, re.I)),
        'code': bool(found['selected']),
        'checkpoint': bool(re.search(r'two_step_verification|checkpoint|login|recover', pathname)),
        'has_cookies': first_url.startswith(FACEBOOK + '/') and {'c_user', 'xs'} <= cookies,
        'account_control': bool(visible(driver, '[aria-label="Account"],[aria-label="Your profile"],[aria-label="Tài khoản"]')),
    }
    return ('unknown' if driver.current_url != first_url else classify(facts)), found['selected']


def challenge(driver):
    found = {'callback': None, 'keys': set(), 'subdomains': set(), 'data': None}

    def inspect(path):
        try:
            state = driver.execute_script('return {ready:typeof window.__sessionConsoleArkoseComplete==="function",key:window.__sessionConsoleArkoseKey||null,data:window.__sessionConsoleArkoseData||null,scripts:[...document.querySelectorAll("script[src]")].map(e=>e.src).filter(s=>s.includes("arkoselabs"))}')
            if state['ready']:
                found['callback'], found['data'] = path, state['data']
            if state.get('key') and re.fullmatch(r'[a-f0-9-]{36}', state['key'], re.I):
                found['keys'].add(state['key'])
            for source in state['scripts']:
                parsed = urlparse(source)
                match = re.search(r'/v2/([a-f0-9-]{36})/api\.js', parsed.path, re.I)
                if match:
                    found['keys'].add(match.group(1))
                if parsed.hostname:
                    found['subdomains'].add(parsed.hostname)
        except WebDriverException:
            pass

    frame_walk(driver, inspect)
    if found['callback'] is None or len(found['keys']) != 1:
        return None
    return {'path': found['callback'], 'public_key': next(iter(found['keys'])),
            'subdomain': next(iter(found['subdomains']), None), 'data': found['data'],
            'url': driver.current_url, 'user_agent': driver.execute_script('return navigator.userAgent')}


def solve_captcha(api_key, value):
    task = {'type': 'FunCaptchaTaskProxyless', 'websiteURL': value['url'],
            'websitePublicKey': value['public_key'], 'userAgent': value['user_agent']}
    if value['subdomain']:
        task['funcaptchaApiJSSubdomain'] = value['subdomain']
    if value['data'] is not None:
        task['data'] = json.dumps(value['data'])
    response = requests.post('https://api.2captcha.com/createTask', json={'clientKey': api_key, 'task': task}, timeout=30).json()
    if response.get('errorId') or not response.get('taskId'):
        raise RuntimeError('CAPTCHA task rejected')
    task_id = response['taskId']
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        time.sleep(5)
        response = requests.post('https://api.2captcha.com/getTaskResult', json={'clientKey': api_key, 'taskId': task_id}, timeout=30).json()
        if response.get('errorId'):
            raise RuntimeError('CAPTCHA task failed')
        if response.get('status') == 'ready':
            token = response.get('solution', {}).get('token')
            if isinstance(token, str):
                return token
            raise RuntimeError('CAPTCHA task returned no token')
    raise RuntimeError('CAPTCHA task timed out')


def save_verified_session(driver):
    global STAGE
    STAGE = 'checking saved session in a new browser'
    driver.quit()
    second = browser()
    try:
        second.get(FACEBOOK + '/watch/')
        time.sleep(3)
        if detect(second)[0] != 'authenticated':
            return False
        # The Chrome profile owns the cookies; the marker contains no credentials.
        state = {'engine': 'undetected-chromedriver', 'verifiedAt': int(time.time())}
        temporary = SESSION_FILE.with_name(SESSION_FILE.name + '.' + secrets.token_hex(8) + '.tmp')
        with temporary.open('x') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(state, stream)
        temporary.replace(SESSION_FILE)
        return True
    finally:
        second.quit()


def run_login(driver, config):
    global STAGE
    STAGE = 'opening login page'
    report('Opening Facebook')
    driver.get(os.environ.get('FB_SESSION_TEST_URL', FACEBOOK + '/'))
    started_at = time.monotonic()
    submitted_at = None
    deadline = started_at + 540
    solved = entered_totp = False
    two_factor_at = captcha_at = None
    last_kind = None
    detected_since = started_at
    while time.monotonic() < deadline:
        STAGE = 'checking Facebook response'
        time.sleep(2.5)
        kind, selected = detect(driver)
        now = time.monotonic()
        if kind != last_kind:
            last_kind, detected_since = kind, now
            labels = {'login': 'Login form', 'login-rejected': 'Login rejected', 'captcha': 'CAPTCHA detected',
                      'two-factor': '2FA code form detected', 'two-factor-loading': 'Waiting for 2FA page',
                      'other-code': 'Email or SMS verification required', 'identity': 'Identity verification required',
                      'checkpoint': 'Other verification required', 'authenticated': 'Authenticated page detected',
                      'unknown': 'Waiting for page to load'}
            report(labels[kind])
        if os.environ.get('FB_SESSION_DRY_RUN') == '1':
            report('Login form ready' if kind == 'login' else 'Current stage: ' + kind,
                   'Read-only preflight passed; no account was submitted')
            return False
        if kind == 'authenticated':
            report('Checking saved session')
            confirmed = save_verified_session(driver)
            report('Session ready' if confirmed else 'Verification failed',
                   'Saved and verified in a fresh browser' if confirmed else 'Facebook rejected the saved session')
            return True  # first driver has already closed
        if kind == 'login' and submitted_at is None:
            email = visible(driver, 'input[name="email"]')
            password = visible(driver, 'input[name="pass"]')
            if not email or not password:
                continue
            STAGE = 'submitting login'
            email[0].send_keys(config['account'])
            password[0].send_keys(config['password'])
            buttons = [button for button in visible(driver, 'button') if re.fullmatch(r'log in', button.text.strip(), re.I)]
            if buttons:
                buttons[0].click()
            else:
                password[0].send_keys(Keys.ENTER)
            report('Login button clicked')
            submitted_at = time.monotonic()
            continue
        if kind == 'login-rejected' or (kind == 'login' and submitted_at is not None and now - submitted_at > 60):
            report('Login did not advance', 'Facebook rejected the account details or remained on the login form')
            return False
        if kind == 'identity':
            report('Identity review required', 'Facebook requires a person to complete identity review')
            return False
        if kind == 'other-code':
            report('Email or SMS verification required', 'A different verification method is required')
            return False
        if kind == 'two-factor' and not entered_totp:
            STAGE = 'entering verification code'
            if time.time() % 30 > 27:
                time.sleep(31 - time.time() % 30)
            current_kind, selected = detect(driver)
            if current_kind != 'two-factor' or selected is None:
                continue
            path, (mode, indexes) = selected
            code = totp(config['totpSecret'])
            report('Entering verification code')
            switch_frame(driver, path)
            inputs = visible(driver, 'input')
            for index, character in zip(indexes, code if mode == 'segmented' else [code]):
                inputs[index].send_keys(character)
            buttons = [button for button in visible(driver, 'button') if re.search(r'continue|next|tiếp tục', button.text, re.I)]
            if buttons:
                buttons[0].click()
            else:
                inputs[indexes[-1]].send_keys(Keys.ENTER)
            driver.switch_to.default_content()
            entered_totp, two_factor_at = True, time.monotonic()
            continue
        if entered_totp and kind in ('two-factor', 'two-factor-loading') and now - two_factor_at > 45:
            report('2FA did not advance', 'No automatic retry')
            return False
        if kind == 'captcha' and not solved:
            value = challenge(driver)
            if value:
                STAGE = 'requesting CAPTCHA solution'
                solved = True
                report('Solving one CAPTCHA task')
                try:
                    token = solve_captcha(config['captchaKey'], value)
                except (RuntimeError, requests.RequestException):
                    report('CAPTCHA failed', 'One task failed or timed out; no automatic retry')
                    return False
                switch_frame(driver, value['path'])
                accepted = driver.execute_script('const fn=window.__sessionConsoleArkoseComplete;if(typeof fn!=="function")return false;fn({token:arguments[0]});return true', token)
                driver.switch_to.default_content()
                report('CAPTCHA response submitted' if accepted else 'CAPTCHA handoff failed',
                       '' if accepted else 'Facebook challenge changed before submission')
                if not accepted:
                    return False
                captcha_at = time.monotonic()
        if kind == 'captcha' and now - (captcha_at or detected_since) > 45:
            report('CAPTCHA needs attention', 'Challenge remains visible; no automatic retry')
            return False
        if kind in ('unknown', 'checkpoint', 'two-factor-loading') and now - detected_since > 30:
            report('2FA page not ready' if kind == 'two-factor-loading' else 'Unrecognized verification page',
                   'No code was submitted')
            return False
    report('Timed out', 'Facebook did not produce a verified session')
    return False


def run_check(driver):
    global STAGE
    STAGE = 'loading Facebook with saved session'
    driver.get(FACEBOOK + '/watch/')
    time.sleep(3)
    kind, _ = detect(driver)
    labels = {'authenticated': 'Session ready', 'login': 'Login required', 'login-rejected': 'Login rejected',
              'captcha': 'CAPTCHA required', 'two-factor': '2FA required', 'two-factor-loading': '2FA page not ready',
              'other-code': 'Email or SMS verification required', 'identity': 'Identity review required',
              'checkpoint': 'Other verification required', 'unknown': 'Session could not be verified'}
    report(labels[kind], 'Saved session passed a fresh-browser check' if kind == 'authenticated'
           else 'Read-only check; no login or verification was submitted')


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else None
    config = json.load(sys.stdin)
    driver = browser()
    closed = False
    try:
        if action == 'login':
            closed = run_login(driver, config)
        elif action == 'check':
            run_check(driver)
        else:
            raise ValueError('Unknown action')
    finally:
        if not closed:
            driver.quit()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        report('Error', f'Browser task failed at {STAGE} ({type(error).__name__}); no automatic retry')
        sys.exit(1)
