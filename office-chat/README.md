# AI Department Office Chat

A private messenger for the **AI department** that runs on the **office network (LAN)**.
Everyone opens it in their browser. Nothing needs to be installed on their computers,
and no internet connection is required.

> **Roman Urdu khulasa:** Yeh office ke network par chalne wali chat app hai. Ek computer
> par server chalayein (`start-windows.bat`), baqi sab colleagues apne browser mein us
> computer ka address kholein (jaise `https://192.168.1.20:8080`). Group chat, private
> chat, files / images / videos, voice notes (WhatsApp jaise), voice aur video calls,
> screen sharing, search, broadcast aur admin panel sab is mein hai. Internet ki zaroorat nahi.
> Har computer par pehli dafa 1 minute ka setup hota hai (certificate install) taake
> microphone aur calls kaam karein.

![Office chat: channel with image, video and file sharing](docs/screenshot.png)

## Features

**Chat**
- **Channels** for group chat. Starts with `#ai-department` and `#resources`; anyone can add more, e.g. `#computer-vision`.
- **Direct messages**: private one-to-one chats, plus your own "(you)" notes.
- **Reply** to a specific message (hover a message, then ↩).
- **@mentions**: type `@` and pick a name. That person gets a highlighted message, a badge and a pop-up.
  `@all` in a channel alerts everyone in it.
- **Seen ✓✓** read receipts: "Seen" in private chats, "Seen by N" in channels (hover to see who).
- **Pin** important messages (📌). The pin icon at the top lists them.
- **📢 Broadcast**: send one message privately to everyone (or to the people you tick). Replies come back to you privately.
- Online status (green dot), "last seen", "… is typing", unread badges, sound alert, and the unread count in the tab title.

**Files, voice and calls**
- **File transfer**: send any file (datasets, model weights, PDFs, zip files), up to **2 GB per file** by default.
  Use the 📎 button, drag and drop, or paste a screenshot with Ctrl+V. Shows a progress bar with cancel.
- **Images** show inline and open full-screen. **Videos** and **audio** play in the chat with seeking.
- **🎤 Voice notes, like WhatsApp:** press the mic, speak, press send. They play in the chat with a waveform, at 1×, 1.5× or 2× speed.
- **📞 Voice and 🎥 video calls** (one-to-one, use headphones for best sound) with **🖥️ screen sharing**.
  Audio and video go directly between the two computers over the office network.
  Calls appear in the chat history ("Video call · 4:12", "Missed voice call", with a "Call back" button).

**Records and management**
- **History is saved automatically** on the server. It is there the next day, next month and after restarts.
  Scroll up and click "Load earlier messages" to go further back.
- **🔍 Search** all your chats and file names (or press Ctrl+K). Click a result to jump to it.
- **⬇ Export** any chat's full history as a text file, for records or reports.
- **💾 Automatic daily backup** of all chats and files, kept for 30 days.
- **⚙️ Admin panel**: reset a forgotten PIN, remove someone who left (or restore them), make others admin,
  delete any message, edit or delete channels, see storage used, and run a backup now.
- Works on desktop and phones (on the office Wi-Fi), with automatic dark mode.

## Setup (10 minutes)

Pick **one** computer to be the server. It should stay on during office hours.

### 1. Install Node.js on the server computer

Download the **LTS** version from <https://nodejs.org> and install it with the default options.
You only need it on this one computer.

### 2. Copy this `office-chat` folder to that computer

For example to `C:\office-chat` or `D:\office-chat`.

### 3. Set a team passcode (recommended)

Copy `config.example.json` to `config.json` and edit it in Notepad:

```json
{
  "teamName": "AI Department",
  "passcode": "choose-a-secret",
  "port": 8080,
  "maxUploadMB": 2048,
  "backupDir": "E:\\chat-backups",
  "admins": ["aamir patni"]
}
```

- `passcode`: only people who know it can join. This keeps other departments on the network out.
- `backupDir`: where daily backups go. **Use a different drive** (or a network folder) so a disk failure can't take both.
- `admins`: usernames that are always admin. If you leave it out, the first person who joined is the admin.

### 4. Start the server

- **Windows:** double-click `start-windows.bat`
- **Linux / macOS:** run `./start.sh` (or `npm start`)

The window shows the address to share, for example:

```
  AI Department chat is running.

  On this computer:      https://localhost:8080
  Colleagues open:       https://192.168.1.20:8080
```

Keep this window open. Closing it stops the chat.

### 5. Allow it through the firewall (Windows)

The first time you start it, Windows asks whether to allow Node.js on networks.
Tick **Private networks** and click **Allow**. If you missed the prompt, run this once
in an **Administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "AI Dept Chat" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Any
```

### 6. One-time setup on each computer (1 minute)

Browsers only allow the **microphone, camera and screen sharing on secure (https) pages**,
so the chat serves https with its own certificate. Each computer trusts it once:

1. Open the chat address. The first time, the **setup page** appears automatically
   (it's also at `http://<address>:8080/setup`).
2. Click **Download certificate** and open the file.
3. **Install Certificate… → Current User → Place all certificates in the following store →
   Trusted Root Certification Authorities → OK → Next → Finish → Yes.**
4. Close Chrome/Edge completely and open the chat again.

The page also has steps for Android, iPhone and Mac. Old `http://` bookmarks keep working:
they forward to the secure address automatically once the certificate is installed.

**IT shortcut:** to install the certificate for all users of a PC at once, run in an Administrator
command prompt: `certutil -addstore -f Root AI-Department-Chat-Certificate.crt`.
The certificate stays the same even if the server's IP address changes, so this is a one-time job.

### 7. Everyone joins

Each colleague opens the address and bookmarks it.
The first time, they choose a **username** (spaces are fine, e.g. "Aamir Patni") and a **PIN**,
and add their name and role. After that, they sign in with the same username and PIN.

**Tip:** ask IT to give the server computer a **fixed IP address**, or reserve one on
the router (DHCP reservation), so the address never changes.

## Updating to a new version

1. Stop the server (Ctrl+C in its window).
2. Replace `server.js`, the `public` folder and the `lib` folder with the new ones.
3. **Keep** the `data` folder, `backups` folder and `config.json`. They hold your chats, accounts and settings.
4. Start the server again. Colleagues just refresh the page.

## Settings

Settings go in `config.json` (or environment variables, which take priority):

| `config.json` | Environment variable | Default | Meaning |
|---|---|---|---|
| `teamName` | `TEAM_NAME` | `AI Department` | Name shown in the app |
| `passcode` | `TEAM_PASSCODE` | *(none)* | Needed to sign up or sign in |
| `port` | `PORT` | `8080` | Network port (https and http share it) |
| `maxUploadMB` | `MAX_UPLOAD_MB` | `2048` | Largest file allowed, in MB |
| `dataDir` | `DATA_DIR` | `data` | Where history and files are stored |
| `backupDir` | `BACKUP_DIR` | `backups` | Daily backup folder; `"off"` to disable |
| `backupDays` | `BACKUP_DAYS` | `30` | How many days of backups to keep |
| `admins` | `ADMINS` (comma separated) | *(first user)* | Usernames that are always admin |
| `https` | `CHAT_HTTPS` | `true` | Secure connection with the chat's own certificate; `false` for plain http (no voice notes or calls) |
| `tlsKey`, `tlsCert` | `TLS_KEY`, `TLS_CERT` | *(none)* | Use your company's own certificate instead |
| `defaultChannels` | | `ai-department`, `resources` | Channels created on first start |

## Backups and storage

Everything lives in the `data/` folder next to `server.js`:

- `messages.jsonl`: all messages
- `uploads/`: all shared files
- `users.json`, `channels.json`, `reads.json`, `sessions.json`
- `tls/`: the chat's certificate (keep `ca.key` private)

**Automatic backups** run a few seconds after the server starts and then once a day.
Each day gets a dated folder (`backups/2026-10-07/`) with the history and accounts, and all shared
files are mirrored into `backups/uploads/`. Deleted files stay in the backup for 30 days. The admin
panel shows when the last backup ran and has a **Back up now** button.

**To restore:** stop the server, copy the files from a dated backup folder into `data/`, copy
`backups/uploads/*` into `data/uploads/`, and start the server.

## Good to know

- **Forgot PIN:** an admin opens ⚙️ Admin → **Reset PIN** and tells the person the new PIN.
- **Someone left:** ⚙️ Admin → **Remove**. They're signed out and can't sign in; their old messages stay.
- **Headphones** are best for calls. Echo cancellation is on, but speakers next to a mic can still echo.
- **Calls** are one-to-one. Both people must be signed in (green dot). Screen sharing works in Chrome and Edge on computers.
- **Video formats:** MP4 (H.264) and WebM play inside the chat in Chrome, Edge and Firefox.
  Other formats (e.g. `.mkv`, `.avi`) are still shared and can be downloaded with one click.
- **Security:** traffic is encrypted (https). Do not expose this port to the internet. PINs are stored
  hashed (scrypt), private chats and their files are only visible to the two people in them, and wrong
  PIN attempts are rate-limited.

## How it works

- `server.js` is a single Node.js file with **no dependencies** (no `npm install` needed).
  It serves the web app, a small JSON API, live updates over Server-Sent Events, and relays the
  setup messages for calls. Uploads are streamed to disk, so large videos do not use much memory.
- `lib/certs.js` creates the https certificates (no OpenSSL needed) and renews them when the IP changes.
- `public/` is the web app: `app.js` (chat), `calls.js` (WebRTC calls), `setup.html` (certificate setup).
