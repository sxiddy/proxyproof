"""
Turn a Windows laptop into the organiser's beacon.

Handy when you only have one Android phone: run this on the laptop, open the
app on the phone as a *student*, and the phone checks itself in exactly like
it would in class.

    py -m pip install -r tools/requirements.txt
    py tools/laptop_beacon.py --api https://your-server --join OSDEMO

It logs in as the organiser, starts a session for the course (or reuses the
one already running), then broadcasts the same packet the app does:
manufacturer id 0xFFFF, "PP" + version + beacon code + rotating token.
"""

import argparse
import calendar
import getpass
import hashlib
import hmac
import json
import struct
import sys
import time
import urllib.error
import urllib.request

from winrt.windows.devices.bluetooth.advertisement import (
    BluetoothLEAdvertisementPublisher,
    BluetoothLEManufacturerData,
)
from winrt.windows.storage.streams import DataWriter

MANUFACTURER_ID = 0xFFFF
PREFIX = bytes([0x50, 0x50, 0x01])


def call(api, path, body=None, token=None, method=None):
    req = urllib.request.Request(api + path, method=method or ("POST" if body is not None else "GET"))
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=15) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        msg = json.loads(e.read() or b"{}").get("error", {}).get("message", str(e))
        sys.exit(f"Server said no: {msg}")


def token_for(secret_hex, code, window):
    mac = hmac.new(bytes.fromhex(secret_hex), f"{code}:{window}".encode(), hashlib.sha256).digest()
    return mac[:8]


def publish(payload):
    writer = DataWriter()
    writer.write_bytes(bytes(payload))
    data = BluetoothLEManufacturerData()
    data.company_id = MANUFACTURER_ID
    data.data = writer.detach_buffer()
    pub = BluetoothLEAdvertisementPublisher()
    pub.advertisement.manufacturer_data.append(data)
    pub.add_status_changed(_on_status)
    pub.start()
    return pub


def _on_status(_pub, args):
    # 5 = aborted. The usual cause is simply that Bluetooth is switched off.
    if int(args.status) == 5:
        reason = "Bluetooth looks switched off. Turn it on in Quick Settings and run this again." if int(args.error) == 1 else f"error {int(args.error)}"
        print(f"\n  Broadcast stopped: {reason}")


def main():
    ap = argparse.ArgumentParser(description="Broadcast a ProxyProof session from this laptop.")
    ap.add_argument("--api", default="http://localhost:4000")
    ap.add_argument("--join", default="OSDEMO", help="join code of the course to run")
    ap.add_argument("--email", default="organiser@proxyproof.dev")
    ap.add_argument("--password")
    ap.add_argument("--minutes", type=int, default=5)
    args = ap.parse_args()
    api = args.api.rstrip("/")
    password = args.password or getpass.getpass(f"Password for {args.email}: ")

    login = call(api, "/auth/login", {"email": args.email, "password": password})
    tok = login["token"]
    courses = call(api, "/courses", token=tok)["courses"]
    course = next((c for c in courses if c["joinCode"] == args.join.upper()), None)
    if not course:
        sys.exit(f"No course with join code {args.join} on this account.")

    session_id = course["liveSessionId"]
    if not session_id:
        session_id = call(api, f"/courses/{course['id']}/sessions", {"durationMinutes": args.minutes}, tok)["session"]["id"]
    sent = time.time() * 1000
    detail = call(api, f"/sessions/{session_id}", token=tok)
    offset = detail["serverTime"] - (sent + time.time() * 1000) / 2
    session = detail["session"]
    beacon = session["beacon"]
    if not beacon:
        sys.exit("That session has already ended.")

    code, secret, win = beacon["code"], beacon["secret"], beacon["windowSeconds"]
    ends = calendar.timegm(time.strptime(session["endsAt"][:19], "%Y-%m-%dT%H:%M:%S"))
    print(f"Broadcasting {course['code']} (beacon {code}). Ctrl+C to stop.\n")

    pub = None
    last_window = None
    try:
        while True:
            now_ms = time.time() * 1000 + offset
            if now_ms / 1000 > ends:
                print("\nSession time is up.")
                break
            window = int(now_ms // (win * 1000))
            if window != last_window:
                if pub:
                    pub.stop()
                token = token_for(secret, code, window)
                pub = publish(PREFIX + struct.pack(">I", code) + token)
                left = int(ends - now_ms / 1000)
                print(f"\r  code {token.hex().upper()}   {left // 60}:{left % 60:02d} left   ", end="", flush=True)
                last_window = window
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        if pub:
            pub.stop()


if __name__ == "__main__":
    main()
