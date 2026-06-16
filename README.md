# 🐇 RabbitHome

A personal, customizable home dashboard — inspired by [Glance](https://github.com/glanceapp/glance),
but with the components and the interactivity tailored to how I like to work.

Widgets: **Clock · Weather · RSS · Hacker News · Markets · Calendar.**

Everything is customized **in the UI** — no config files to edit. Add feeds and
tickers with a button; drag widgets around; drop in background photos and the
text auto-adjusts for contrast.

## Architecture

A single Go binary serves a REST API and an embedded React app. One codebase,
three ways to run:

| Mode | Command | What you get |
|------|---------|--------------|
| **Standalone (Firefox)** | `./rabbithome` | Opens in Firefox; feed links open as new Firefox tabs you can bookmark/save. Default. |
| **Standalone (app window)** | `./rabbithome --browser chrome-app` | A chromeless Chromium "app-mode" window — feels like a native app, no tabs/URL bar. |
| **Web app** | `./rabbithome --serve` then open the printed URL | Plain browser tab; good for LAN sharing. |
| **Docker** | `docker run -p 7171:7171 -v rabbithome:/data rabbithome` | Anyone, any OS, no build needed. |

`--browser` accepts `firefox` | `chrome-app` | `default` | `auto` (auto = Firefox
if present, else app-window, else your default browser).

- **Backend:** Go. Integrates only **key-free** upstreams so anyone can run it:
  Open-Meteo (weather + geocoding), Hacker News Firebase API, Yahoo Finance,
  ipapi (IP geolocation), and any RSS/Atom feed.
- **Frontend:** React + Vite, `react-grid-layout` for drag/resize.
- **Persistence:** the whole dashboard is one JSON document the backend stores
  verbatim (`config.json`); background images are saved as files. Both live in
  `~/.config/rabbithome/` (override with `RABBITHOME_DATA`).

```
main.go            entry: starts server, opens the window/browser
launch.go          standalone window via Chromium app-mode (fallback: default browser)
internal/server/   HTTP routes (data APIs, config, background upload, static SPA)
internal/feeds/    upstream integrations (rss, hn, weather, markets, geo) + cache
internal/config/   on-disk paths + atomic config save
web/               React frontend (built into web/dist, embedded into the binary)
```

## Build & run

Prerequisites: Go ≥ 1.24 and Node ≥ 20.

```bash
make build                        # builds the frontend + the single Go binary
./rabbithome                      # standalone, opens in Firefox
./rabbithome --browser chrome-app # standalone, chromeless app window instead
```

Development with hot reload (two terminals):

```bash
make dev-api   # Go backend on :7171
make dev-web   # Vite dev server on :5173 (proxies /api to the backend)
```

Docker:

```bash
make docker
docker run -p 7171:7171 -v rabbithome:/data rabbithome:latest
# open http://localhost:7171
```

## Using it

- **＋ Add widget** — pick any component; it drops onto the grid.
- **✥ Arrange** — toggles edit mode: drag widgets by their header, resize from the
  corner, rename inline, or remove. Layout saves automatically.
- **⚙ Settings** — upload background photos (static or shuffle), pick which to use,
  and enable OS notifications.
- **RSS** — add feed URLs and "filter words". A filter word (e.g. `AI`) splits the
  feed into an `AI` category and `Other` by title match. Set max length; click ✕ to
  permanently ignore an item; read items dim; new items raise a notification.
- **Weather** — auto-detects location (or search a place); shows current, hourly,
  and a past+future daily strip with wind, rain %, sunrise/sunset.
- **Clock** — switch between flip, analog, and binary faces.

## Notes & limitations (prototype)

- A Reddit widget was scoped originally but **removed**: Reddit shut down
  unauthenticated access to its public JSON (HTTP 403), so it can no longer work
  without OAuth app credentials. May revisit with OAuth later.
- The Calendar widget is a local month view; Google Calendar sync is a planned
  follow-up and would plug into `CalendarWidget` as event markers.
- The standalone window uses a Chromium-family browser in app-mode because the
  common Go webview binding requires `webkit2gtk-4.0`, which Ubuntu 24.04 dropped
  in favour of `4.1`. App-mode needs no system dev packages.
