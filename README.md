# ProxyProof

Bluetooth attendance that's hard to cheat. The organiser's phone broadcasts a code that changes every 5 seconds. Students' phones hear it and mark them present on their own, as long as they're actually in the room, on their own registered phone.

**[Download the APK](../../releases/latest)** (Android 7+)

---

## How it works

```
 Organiser's phone                    Student's phone                      Server
 ─────────────────                    ───────────────                      ──────
 BLE advert, no pairing:   ───────▶   scans, collects a few      ───────▶  checks, in order:
  "PP" v1                             RSSI readings, takes the              1. live session for this beacon?
  beacon code (4 bytes)               median, signs the request             2. student enrolled?
  token (8 bytes, new                 with this phone's private             3. signed by their registered phone?
  every 5 s)                          key                                   4. token from the last few seconds?
                                                                            5. signal strong enough (in the room)?
                                                                            6. phone not already used for someone else?
                                                                           → marked, and the live dashboard updates
```

The token is `HMAC-SHA256(session secret, beacon code + time window)`, cut to 8 bytes. It works like a Google Authenticator code. The organiser's phone works it out offline, and the server accepts only the current window or one either side of it (about 15 seconds). Student phones sync their clock with the server (on login and again if the server says a request looks out of date), so a phone set a few minutes off still works.

## What stops proxies

| Trick | Why it fails |
|---|---|
| Screenshot or WhatsApp the code to a friend | The code expires in seconds, and it never appears as text a student could type in. |
| Record the Bluetooth packet and replay it later | Same: the token inside goes stale, and the server logs a `stale_token` attempt. |
| Log in as your friend on your phone | Each student is locked to one phone. Every check-in is signed with an Ed25519 key that never leaves that phone's secure storage. The same key can't be linked to two accounts, and any new phone or new key (even a reinstall) becomes a request an admin must approve. |
| One phone marks five people | A phone is bound to one student, and the database has a unique index on (session, device), so it can't happen even by accident. |
| Relay the live beacon to a friend's phone in the hostel | When a student's phone hears the beacon it beeps back a short "echo" made from its key and the current token. The organiser's phone listens for these, and the dashboard shows a "heard" badge next to students whose phone was actually in range of the organiser. |
| Stand outside the door / in the hostel | The server checks the median RSSI from several readings against the session's cut-off. The organiser can tighten or loosen it mid-session. |
| Spam the endpoint | Rate-limited per student. Rejected attempts show up on the organiser's dashboard with the reason. |

RSSI isn't a precise ruler: walls, bodies and phone models all change it. That's why the app takes the median of several readings and the cut-off is adjustable (small room / classroom / lecture hall).

## Features (mapped to the brief)

1. **Roles and login.** Student, Organiser and Admin. A student is bound to the phone they sign up on. Logging in on a new phone creates a switch request, which an admin approves or rejects in the app.
2. **Timed sessions.** The organiser picks 2, 5, 10 or 15 minutes. The session closes itself when the timer runs out, or the organiser can close it early.
3. **Zero-tap marking.** A student keeps the app open, it hears the beacon, and they're marked within a few seconds, with a buzz and a "PRESENT" stamp.
4. **Anti-proxy.** Rotating tokens, device-signed check-ins, one phone per student, RSSI check (see the table above).
5. **Live dashboard.** Names appear as students are marked (Socket.IO). The organiser can mark someone present by hand (a dead phone, say), remove someone, change the range, and close the session. Blocked attempts are listed with the reason.
6. **History and export.** Students see per-course and overall percentages, with a nudge when they drop below 75%. Organisers export one session or the whole register (students × sessions) as CSV through the share sheet.

## Try it

The default server address in the APK is a hosted demo. These accounts are created there automatically:

| Role | Email | Password |
|---|---|---|
| Organiser | `organiser@proxyproof.dev` | `demo1234` |
| Admin | `admin@proxyproof.dev` | `admin1234` |

The course **Operating Systems (CS301)** has join code **`OSDEMO`**. Students sign up in the app (any email) and join with that code. To sign up as a new organiser, use staff code `STAFF-2026`.

### Only have one phone?

Two helpers in this repo cover the missing device:

- **Your laptop as the beacon** (Windows, needs Bluetooth on). It starts a session and broadcasts exactly what the organiser's phone would, so your phone can check in as a student.
  ```bash
  py -m pip install -r tools/requirements.txt
  py tools/laptop_beacon.py --api https://proxyproof-api.onrender.com --join OSDEMO
  ```
- **A pretend classroom.** Start a session on your phone as the organiser, then:
  ```bash
  cd server && npm install
  npm run simulate -- --api https://proxyproof-api.onrender.com --join OSDEMO --count 12
  ```
  Twelve students check in over a few seconds, and two of them try something they shouldn't (one too far away, one with an old code). You'll see both appear under "blocked attempts".

## Project layout

```
app/       Expo (React Native) app, Android
  modules/proxy-beacon/   small Kotlin module: BLE advertise + scan
  src/app/                screens (expo-router)
  src/lib/                api client, device keys, token maths, auto check-in
server/    Node + Express + Socket.IO + Postgres (PGlite locally)
tools/     laptop beacon (Python)
```

## Running it yourself

**Server** (Node 22.18+; runs TypeScript directly, no build step):

```bash
cd server
npm install
cp .env.example .env
npm run dev          # http://localhost:4000, embedded Postgres, demo data
npm test             # 18 end-to-end API tests
```

Point the app at it from the app's **Settings → Server** (use your laptop's LAN IP, e.g. `http://192.168.1.5:4000`).

**App.** Bluetooth needs native code, so it doesn't run in Expo Go:

```bash
cd app
npm install
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

Or push a tag (`v1.0.1`) and GitHub Actions builds the APK and attaches it to a release (`.github/workflows/build.yml`).

### Hosting the server

`render.yaml` is a Render blueprint: a free web service plus a free Postgres. Connect the repo at render.com → **New → Blueprint**, and it sets up everything, including a random `JWT_SECRET`.

Two things to know about the free tier: the server goes to sleep after about 15 minutes of no traffic, so the first request can take up to a minute (the app shows "Waking the server up…"), and the free Postgres expires after 30 days, so upgrade it or make a new one before then.

## API

| | |
|---|---|
| `POST /auth/register`, `POST /auth/login` | Students send their device's public key. Returns a JWT and the device status. |
| `GET /me` | Profile and whether *this* phone is the bound one |
| `GET /time` | Server clock, for syncing |
| `GET/POST /courses`, `POST /courses/join` | Courses and enrolment |
| `GET /courses/:id`, `GET /courses/:id/export.csv` | Roster with percentages; full register |
| `DELETE /courses/:id/students/:studentId` | Take a student off a course |
| `POST /courses/:id/sessions` | Start a session (returns the beacon secret to the organiser) |
| `GET/PATCH /sessions/:id`, `POST /sessions/:id/close` | Live view, change range, close |
| `POST/DELETE /sessions/:id/attendance[/:studentId]` | Manual add / remove |
| `POST /sessions/:id/heard` | Echoes the organiser's phone picked up |
| `GET /sessions/:id/export.csv` | One session |
| `POST /checkin` | The signed check-in from a student's phone |
| `GET /me/history` | Student's history and percentage |
| `GET /admin/device-requests`, `POST …/:id/approve\|reject` | Phone switches |
| `GET /admin/overview` | Counts for the admin screen |

Socket.IO events: `mark`, `unmark`, `attempt` and `closed` go to the organiser watching a session. `session_started`, `unmarked` and `device` go to the student, plus `marked` when an organiser marks them by hand (automatic marks come back in the check-in reply).

## Known limits

- The laptop beacon (`tools/laptop_beacon.py`) needs the laptop's Bluetooth switched on; if it's off, the script says so and stops.
- Android only. iOS limits what an app can put in a BLE advert, so it would need a different packet layout.
- The app has to be open (foreground) to broadcast and to scan. Android restricts background BLE, and a foreground service is the next step.
- RSSI comes from the student's phone. Signing stops anyone else from faking it, but a student with a rooted phone and patience could still tamper with their own readings. The other checks (fresh token, bound device) still apply.
