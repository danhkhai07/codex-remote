# Facebook session console (one account)

This standalone loopback app is opened through the authenticated Codex Remote
preview for port 5217. It does not add any Facebook actions beyond login and a
read-only saved-session check. Manual browser control is selected by default:
after the initial login submission, the owner can click, drag, or type on a
live browser image through CAPTCHA, 2FA and any later verification step while
the Chrome process stays open. A current authenticator code is shown only at
the 2FA code stage; the owner enters it, and the worker never auto-submits it
in manual mode. The alternative 2Captcha mode may use **one**
paid FunCaptcha task; it never retries a paid task automatically. An Arkose response
is not considered a login: the worker saves the browser state only after a
fresh browser can open Facebook without a login form or checkpoint.

Stage detection checks visible page content and frames before choosing an action.
An Arkose challenge at `/two_step_verification/authentication/` is CAPTCHA;
it does not trigger the TOTP input handler. The code form must actually appear.
Identity review and email/SMS verification are reported separately. Unknown or
loading pages have bounded waits and never count as an authenticated session.
Cookies alone are insufficient: a visible account/profile control is also
required, including in the fresh-browser check. Detection remains subject to
Facebook changing its interface; an unrecognized page stops rather than guessing.

Regression checks (browser fixtures are local and make no Facebook or 2Captcha
request):

```sh
codex-heavy --label facebook-uc-tests --timeout 180 -- /usr/bin/env /root/.local/share/facebook-undetected-chromedriver/venv/bin/python -m unittest discover -s scripts/facebook-session-console -p test_worker_uc.py -v
codex-heavy --label facebook-uc-browser --timeout 180 -- /usr/bin/xvfb-run -a /usr/bin/env /root/.local/share/facebook-undetected-chromedriver/venv/bin/python scripts/facebook-session-console/test_worker_uc_browser.py
codex-heavy --label facebook-manual-browser --timeout 180 -- /usr/bin/xvfb-run -a /usr/bin/env /root/.local/share/facebook-undetected-chromedriver/venv/bin/python scripts/facebook-session-console/test_worker_uc_manual.py
codex-heavy --label facebook-console-api --timeout 180 -- node --test scripts/facebook-session-console/console.test.mjs
codex-heavy --label facebook-manual-ui --timeout 180 -- node scripts/facebook-session-console/manual-browser-smoke.mjs
```

The owner enters the VPS access code, account ID/email, password, authenticator
secret, and 2Captcha API key in the web form. The access code lives in
`/root/.local/state/facebook-session-console/access-code`; account secrets and
session state remain in the same root-only directory. The API never returns
secrets. To retrieve the access code over SSH:

```sh
sudo cat /root/.local/state/facebook-session-console/access-code
```

The process must bind only to `127.0.0.1:5217`. The public preview gateway
handles the owner ticket, and this app independently requires its access code
for every API request. Do not register the port as a public share link. Browser
automation uses undetected-chromedriver 3.5.5, Selenium 4.50.0 and
setuptools 80.10.2 in an isolated Python 3.12 virtual environment. The service
uses Xvfb and the local Chromium 140 binary. Chrome keeps the session in the
root-only `browser-profile` directory. Manual screenshots travel only from the
worker to the parent process and are served by an access-code-protected,
non-cacheable endpoint. The parent accepts only bounded pointer/text/key
commands while manual browser control is active. The TOTP endpoint is only
available with the access code during the 2FA stage; it is non-cacheable and
does not log or persist the code. Manual login stops after at most 30 minutes;
the Stop browser button can end it earlier. `storage-state.json` is a secret-free
marker written only after a second browser process verifies that the session
is authenticated. The old Playwright worker remains in source for rollback;
the server starts `worker_uc.py`.

Manual operation: open the service from Codex Remote Services, unlock the
console with its VPS access code, leave "Let me control the browser after login"
checked, then select Start login. When a challenge appears, the live browser
image is shown under the buttons. Click/drag on it or use the text/Enter/Tab/scroll
controls until Facebook reaches an authenticated page. At the 2FA code form,
the current code appears above the image; click the field and enter it yourself.
The image stays available for email/SMS or other verification. This feature
cannot make a blank or blocked challenge render. It has been tested with a
local full login fixture; actual Facebook acceptance remains unverified.

In manual mode, identity review and unsupported verification screens remain
visible for the owner to handle until the bounded timeout or Stop. Automatic
mode still stops with a status. There are no bulk-account, like, view, or
stream actions.
