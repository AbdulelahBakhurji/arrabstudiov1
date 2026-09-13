# Arrab Testing Workspace (`testingworkspace.arrabai.com`)

Sign-in (email + password every browser session), workspace, **Plans** (Moyasar), and **Download** for Studio installers.

## Layout

```
apps/testingworkspace/
  public/                 ← nginx document root
    index.html            ← email + password gate
    app.html              ← workspace (Plans, Chat, Download…)
  deploy.sh
  publish-release.sh      ← copy a .dmg/.deb/.AppImage into the download page
```

## Auth

Opening `/app` without a session always returns to `/`. Sign-in requires email and password. The session lives in `sessionStorage`, so closing the tab requires signing in again.

## Plans / Moyasar

Paid plans create a Moyasar invoice and redirect to checkout. Set `MOYASAR_SECRET_KEY` on the API, then restart `arrab-api`. Plan copy and SAR prices live in `packages/shared/src/account.ts` until you send final details.

## Downloads

After each desktop build:

```bash
./apps/testingworkspace/publish-release.sh /path/to/ArrabStudio-0.1.0.dmg
```

Files land in `/var/www/testingworkspace/releases/` and show up on **Download**.

## Production

```bash
./apps/testingworkspace/deploy.sh
```
