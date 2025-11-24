# TeamShifter — Deployment & Sharing Guide

This repository contains the TeamShifter front-end and a minimal Express backend (`server.js`). Below are several ways to make the app accessible to other people for testing, from the fastest temporary method (ngrok) to a simple cloud deployment (Render / Railway / Heroku).

Important: keep `data/` folder (users/shifts/companies JSON files) on the server — it's where data is stored.

---

## Quick local start (what you've already done)

1. Open a terminal in the project folder (`C:\Users\charl\Desktop\Schedule online`).
2. Install dependencies (only once):

```powershell
npm install
```

Note: The project now uses a lightweight SQLite database (`data/teamshifter.db`). If you previously used JSON files, the server will attempt to import `data/companies.json`, `data/users.json`, and `data/shifts.json` into the database on first run.

3. Start the server:

```powershell
node server.js
```

4. Open in your browser (on the same machine):

```
http://localhost:3000
```

The `server.js` listens on `0.0.0.0` so it will accept connections from other machines on your LAN, provided firewall/router allow them.

---

## Option A — Share quickly with ngrok (temporary public URL)

Ngrok creates a secure tunnel from the public internet to your local server. This is the fastest way to let remote users test without changing router settings.

1. Download ngrok: https://ngrok.com/download
2. Unzip and put `ngrok.exe` somewhere (e.g., `C:\tools\ngrok`).
3. Run ngrok to forward port 3000 (in a new terminal):

```powershell
# from any folder where ngrok.exe is available
ngrok http 3000
```

4. ngrok will print a `Forwarding` URL like `https://abcd-1234.ngrok.io`. Share that URL — it forwards to your local TeamShifter instance.

Notes:
- The URL is temporary and changes each time unless you have a paid ngrok plan.
- Ngrok exposes your local server to the internet — consider security implications.

---

## Option B — LAN sharing (no internet): give testers your IPv4

1. Ensure server is running (`node server.js`).
2. Find your local IP:

```powershell
ipconfig
```

Look for `IPv4 Address` on the interface you use for the LAN (e.g., `192.168.1.100`).

3. Share:

```
http://192.168.1.100:3000
```

Make sure:
- Windows Firewall has an inbound rule allowing TCP port 3000 (Private and Public profiles).
- Both devices are on the same network (same Wi-Fi SSID or LAN).

---

## Option C — Deploy to a cloud host (recommended for repeated public testing)

You can deploy the app as a small web service. The code is already compatible with common hosts (it uses `process.env.PORT`). Below are simple instructions for Render (free tier) or Railway.

### Render (quick):
1. Create a GitHub repo with this project and push the code.
2. Sign in to https://render.com and create a new Web Service.
3. Connect your GitHub repo, set the build command to `npm install` and the start command to `npm start` (or `node server.js`).
4. Set environment variables in Render settings if you want to customize:
   - `SCHEDULE_JWT_SECRET` — set to a long, random value
   - `PORT` — not required (Render provides one)
5. Deploy: Render will provide a public URL like `https://teamshifter-xxxxx.onrender.com`.

### Railway / other hosts:
- Railway and other simple hosts follow similar steps: push repo to GitHub, create a new project, select web service, and set start command `npm start`.

### Deploying with Docker (works around native build errors)

If you see build errors for `better-sqlite3` on cloud builders (native compilation errors), use the included `Dockerfile` which installs the system dependencies and compiles the native module during image build.

1. Build the Docker image locally (optional test):

```powershell
docker build -t teamshifter:latest .
```

2. Run the container locally and map port 3000:

```powershell
docker run --rm -p 3000:3000 -v ${PWD}/data:/usr/src/app/data teamshifter:latest
```

3. Deploy using Render (or other hosts) with Docker:
   - In Render create a new Web Service and select "Docker" as the Environment.
   - Connect your GitHub repo and Render will use the `Dockerfile` in the repo to build the image.
   - Set environment variable `SCHEDULE_JWT_SECRET` in the Render dashboard.

Using Docker ensures the build environment has the necessary packages to compile `better-sqlite3` and avoids `node-gyp` errors during cloud builds.

### Heroku (if you prefer):
- Add a `Procfile` with:

```
web: node server.js
```

- Create an app on Heroku, connect GitHub or push via the Heroku CLI.

Security & storage notes:
- This app stores data in JSON files in the `data/` folder. For production, consider using an actual database (SQLite/Postgres) or persistent volume so the host does not wipe files on redeploy.
- Use a strong `SCHEDULE_JWT_SECRET` and keep it private.
- Consider enabling HTTPS on your host (Render and Railway automatically provide HTTPS).

---

## Useful commands

Start the server (dev):

```powershell
npm run dev   # requires nodemon (already in devDependencies)
```

Start the server (production):

```powershell
npm start
```

Run `npm audit` to review vulnerabilities and `npm audit fix` or `npm audit fix --force` if desired.

---

## Troubleshooting
- "Port in use": ensure no other service uses port 3000, or change `PORT` environment variable.
- "Cannot access from other devices": check firewall, use `ipconfig` for IPv4, ensure both devices are on same network.
- For persistent public access, prefer deploying to Render/Railway instead of port forwarding.

---

If you tell me which option you prefer (ngrok quick share, LAN sharing, or deploy to Render/Railway/Heroku), I will give step-by-step instructions tailored to that choice and help with any files or configuration changes needed.