# Keycloak and the SPAs

How `gui_agent` and `gui_treedb` log in, and what the identity provider
(Keycloak in every deployment so far) must be configured with. The full
contract of the server side is `YUNO_AUTH.md` §2 in yunetas
(`yunos/c/yuno_agent/YUNO_AUTH.md`, published as
[/yuno-auth](https://doc.yuneta.io/yuno-auth)); this note says only what the
two SPAs take from it.

## The model: the SPA never talks to Keycloak

Each SPA has an **auth BFF** (an `auth_bff` yuno, gclass `C_AUTH_BFF`) on its
own host. The browser talks to the BFF only; the BFF is the one that talks
OAuth2 to Keycloak.

| SPA | BFF | Who reads the BFF port |
|---|---|---|
| `gui_agent` | `https://<host>:1806` (agents plane), `:1807` (agent22 plane) | `gui_agent/src/conf/deploy.js` |
| `gui_treedb` | `https://<host>:1808` | `gui_treedb/src/conf/deploy.js` |

Both SPAs use the same flow:

1. The SPA's own login form POSTs `{username, password}` to `/auth/login`.
2. The BFF exchanges them with Keycloak (`grant_type=password`) and writes the
   access and refresh tokens as `HttpOnly; Secure; SameSite=Strict` cookies.
   The SPA receives only `{username, email, expires_in, refresh_expires_in}`.
3. The SPA calls `/auth/refresh` before the access token expires, and on
   load to restore a session. `/auth/logout` ends the session at Keycloak and
   clears the cookies.
4. The WebSocket upgrade to a backend on the **same host** carries the cookie;
   `C_IEVENT_SRV` gives the token to `C_AUTHZ`, which checks it against the
   issuer's JWKS.

Why: a token that JavaScript cannot read cannot be stolen by an XSS. The
browser knows that it is logged in, and nothing else.

## The exception: backends on other hosts

The cookie does not travel to another host. `gui_treedb` opens backends on
hosts that the user configures, and the Monitor workspace of `gui_agent`
talks to a node's agent directly. For these, the SPA asks the BFF for the
access token (`POST /auth/token`) and puts it in the `jwt` of each
`C_IEVENT_CLI` identity card.

`/auth/token` is off by default. Turn it on only on the BFF of an SPA that
needs it, with both settings:

```json
"expose_access_token": true,
"allowed_origin":      "https://<spa host>"
```

The BFF gives the token only to a request whose `Origin` is exactly
`allowed_origin`. Keep the access-token lifetime short: an XSS on that one
origin can read the token.

## The Keycloak client

One client per BFF, in the realm of the project.

| Setting | Value | Why |
|---|---|---|
| Direct access grants | **On** | `/auth/login` uses `grant_type=password`. Without it Keycloak refuses every login. |
| Standard flow | On, if the BFF must also serve `/auth/callback` | The PKCE code exchange. Neither SPA uses it today. |
| Client authentication | Off (public), or On with `client_secret` in the BFF config | The BFF runs on the server, so it can keep a secret. With a secret, only the BFF can use the client: a stolen code cannot be exchanged elsewhere. |
| PKCE method | `S256` | Only for `/auth/callback`. `plain` gives no protection. |
| Valid redirect URIs | `https://<spa host>/*` | Only for `/auth/callback`. |
| Web origins | `https://<spa host>` | No trailing slash, no wildcard. |
| Require DPoP bound tokens | Off | The SPAs keep tokens in `HttpOnly` cookies and do not sign DPoP proofs. |

The BFF side of the same client, in `auth_bff.<port>.json`:

```json
"issuer":        "https://auth.example.com/realms/<realm>/",
"client_id":     "<client id>",
"client_secret": "",
"cookie_domain": "<spa host>"
```

## Content Security Policy

Each SPA's `config.json` → `csp_connect_src` is written into the CSP at build
time. It lists the `wss:` and `https:` schemes, not origins, because the user
chooses the hosts at run time. Its `_comment` says so.

## See also

- `README-KEYCLOAK-LOGIN-FORM.md`: the identity provider's own login page
  compared with an application login form, and Keycloak compared with other
  identity providers.
- `yunos/c/auth_bff/README.md` in yunetas: the BFF yuno and its endpoints.
