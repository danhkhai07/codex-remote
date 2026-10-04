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

Regression checks (all Facebook/Arkose browser requests are local fixtures):

```sh
codex-heavy --label facebook-stage-check --timeout 180 -- node --test scripts/facebook-session-console/console.test.mjs scripts/facebook-session-console/browser-smoke.mjs scripts/facebook-session-console/stage-replay.test.mjs scripts/facebook-session-console/worker-flow.test.mjs
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
automation requires Playwright Core and the local Chromium binary; the service
uses Xvfb to keep the browser visible to websites without a desktop session.

If Facebook requests a new challenge, identity review, or an unsupported
verification form, the job stops with a status. The owner may start another
login manually. There are no bulk-account, like, view, or stream actions.
