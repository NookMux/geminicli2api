# Admin Panel Frontend API

This document describes the HTTP APIs used by the admin OAuth panel frontend.
It only covers panel related endpoints, not the public `/v1/*` model APIs.

Base URL examples:

- Local development: `http://localhost:8045`
- Docker deployment: `http://<your-host>:8045`

## Auth and session

- Login uses username and password from env vars `PANEL_USER` and `PANEL_PASSWORD`.
- On successful login the server sets a `panel_session` cookie (HttpOnly, SameSite=Lax).
- Session lifetime is **2 hours**:
  - The server stores an expiry timestamp in memory for each session token.
  - The cookie is issued with `Max-Age=7200`.
  - After 2 hours, protected APIs behave as "not logged in" and the user must login again.

If not logged in or the session is expired:

- Page endpoints redirect to `/admin/login`.
- JSON APIs return HTTP `401 Unauthorized`.

---

## Endpoint overview (frontend related)

- `GET /`
  - Not logged in: redirect to `/admin/login`.
  - Logged in: redirect to `/admin/oauth`.

- `GET /admin/login`
  - Returns the HTML login page with a simple form.

- `POST /admin/login`
  - Handles login form submission, sets `panel_session` cookie and redirects to `/admin/oauth` on success.

- `POST /admin/logout`
  - Clears the current session and cookie, effectively logging the user out.

- `GET /admin/oauth`
  - Returns the main admin panel HTML (served from `public/admin/index.html`), requires login.

- `GET /auth/accounts`
  - Returns the list of stored Google accounts as JSON, requires login.

- `GET /auth/oauth/url`
  - Returns a JSON object with the Google OAuth URL, requires login.

- `GET /auth/oauth/callback`
  - Google OAuth callback landing page. The server no longer exchanges tokens here; it only shows an instructional page asking the user to copy the full URL from the browser address bar.

- `POST /auth/oauth/parse-url`
  - New endpoint used by the admin panel to submit the pasted callback URL and exchange the contained `code` for tokens.

The sections below describe the main frontend APIs in more detail.

---

## 1. Login: POST /admin/login

- Method: `POST`
- Path: `/admin/login`
- Content-Type: `application/x-www-form-urlencoded`

Request body fields:

- `username`: should match `PANEL_USER` (default `admin`).
- `password`: should match `PANEL_PASSWORD`.

Behavior:

- On success:
  - Creates a server side session with 2 hour TTL.
  - Sets `panel_session=<token>; HttpOnly; Path=/; SameSite=Lax; Max-Age=7200`.
  - Responds with HTTP 302 redirect to `/admin/oauth`.
- On failure:
  - Responds with HTTP 401 and a small HTML error page.

Note: current implementation uses a server rendered HTML form, so the frontend usually does not need to call this via `fetch`.

---

## 2. Logout: POST /admin/logout

- Method: `POST`
- Path: `/admin/logout`

Behavior:

1. Reads `panel_session` from cookies if present.
2. Removes the session from the in-memory session map.
3. Issues `Set-Cookie: panel_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0` to clear the cookie.

Responses:

- If the request `Accept` header includes `application/json`:

  ```json
  { "success": true }
  ```

- Otherwise:
  - Responds with HTTP 302 redirect to `/admin/login`.

Example frontend call (plain JS):

```js
async function logout() {
  const res = await fetch('/admin/logout', {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
    credentials: 'same-origin'
  });

  // Regardless of response body, redirect to login page
  window.location.href = '/admin/login';
}
```

---

## 3. Get OAuth URL: GET /auth/oauth/url

- Method: `GET`
- Path: `/auth/oauth/url`
- Requires valid `panel_session` cookie (logged in).

Response example:

```json
{
  "url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=..."
}
```

Typical usage (from `public/admin/panel.js`):

```js
const res = await fetch('/auth/oauth/url', { credentials: 'same-origin' });
if (!res.ok) throw new Error('request failed');
const data = await res.json();
window.open(data.url, '_blank', 'noopener');
```

---

## 4. Submit callback URL: POST /auth/oauth/parse-url

After the user completes Google OAuth in the browser, they are redirected to the configured callback URL (for example `https://your-host/auth/oauth/callback?code=...&state=...`).  
The admin panel now asks the user to copy that full URL and paste it back into a text input, which is then sent to this endpoint.

- Method: `POST`
- Path: `/auth/oauth/parse-url`
- Requires valid `panel_session` cookie (logged in).
- Content-Type: `application/json`

Request body:

```json
{ "url": "https://your-host/auth/oauth/callback?code=...&state=..." }
```

Behavior:

- Parses the provided URL using `new URL(url)`.
- Extracts the `code` and optional `state` query parameters.
- Verifies `state` against the server-side `OAUTH_STATE` if present.
- Derives `redirect_uri` as `origin + pathname` from the pasted URL.
- Calls the shared `exchangeCodeForToken(code, redirect_uri)` helper.
- Appends the new account (access token + refresh token) into `data/accounts.json`.
- Re-initializes the `TokenManager` so the new account is usable without restart.

Response examples:

- On success:

```json
{ "success": true }
```

- On failure:

```json
{ "error": "reason string" }
```

Typical usage (from `public/admin/panel.js`):

```js
const res = await fetch('/auth/oauth/parse-url', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'same-origin',
  body: JSON.stringify({ url: pastedUrl })
});
const data = await res.json();
if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
```

---

## 5. Get accounts: GET /auth/accounts

- Method: `GET`
- Path: `/auth/accounts`
- Requires valid `panel_session` cookie (logged in).

Response example:

```json
{
  "accounts": [
    {
      "index": 0,
      "projectId": "projects/xxx",
      "enable": true,
      "hasRefreshToken": true,
      "createdAt": 1710000000000,
      "expiresIn": 3599
    }
  ]
}
```

Field meanings:

- `index`: index in the local `accounts.json` array.
- `projectId`: project identifier, may be `null`.
- `enable`: whether the account is enabled.
- `hasRefreshToken`: whether a `refresh_token` is present.
- `createdAt`: timestamp (ms) when the account was stored.
- `expiresIn`: access token lifetime in seconds, may be `null`.

---

## 6. Root entry: GET /

- Method: `GET`
- Path: `/`

Behavior:

- Not logged in: redirect to `/admin/login`.
- Logged in: redirect to `/admin/oauth`.

Operations and frontend can treat `/` as the canonical entry URL for the admin panel.
