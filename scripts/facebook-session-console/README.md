# Facebook session console (one account)

This standalone loopback app is opened through the authenticated Codex Remote
preview for port 5217. It does not add any Facebook actions beyond login and a
read-only saved-session check. The one-account login may use **one** 2Captcha
FunCaptcha task; it never retries a paid task automatically. An Arkose response
is not considered a login: the worker saves the browser state only after a
fresh browser can open Facebook without a login form or checkpoint.

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
