# Facebook session console (one account)

This standalone loopback app is opened through the authenticated Codex Remote
preview for port 5217. It does not add any Facebook actions beyond login and a
read-only saved-session check. The one-account login may use **one** 2Captcha
FunCaptcha task; it never retries a paid task automatically. An Arkose response
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

Regression checks (the UC browser fixture is local and makes no Facebook or
2Captcha request):

```sh
codex-heavy --label facebook-uc-tests --timeout 180 -- /usr/bin/env /root/.local/share/facebook-undetected-chromedriver/venv/bin/python -m unittest discover -s scripts/facebook-session-console -p test_worker_uc.py -v
codex-heavy --label facebook-uc-browser --timeout 180 -- /usr/bin/xvfb-run -a /usr/bin/env /root/.local/share/facebook-undetected-chromedriver/venv/bin/python scripts/facebook-session-console/test_worker_uc_browser.py
codex-heavy --label facebook-console-api --timeout 180 -- node --test scripts/facebook-session-console/console.test.mjs
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
root-only `browser-profile` directory. `storage-state.json` is a secret-free
marker written only after a second browser process verifies that the session
is authenticated. The old Playwright worker remains in source for rollback;
the server starts `worker_uc.py`.

If Facebook requests a new challenge, identity review, or an unsupported
verification form, the job stops with a status. The owner may start another
login manually. There are no bulk-account, like, view, or stream actions.
