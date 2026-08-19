"""Serve the app to a phone on the same Wi-Fi, without deploying anything.

    python3 .claude/serve-phone.py

Prints the URLs to open on the phone. Unlike serve.py this binds to every
interface rather than just the loopback, so another device can reach it.

Plain HTTP is fine here: the label scanner uses a file input rather than
getUserMedia, so it needs no secure context, and an https:// script tag on
an http:// page is allowed (only the reverse is blocked).

Nothing persists — ?preview runs the app on seeded data with auth skipped,
and save() no-ops while nobody is signed in, so a reload returns to the
clean starter library.
"""

import functools
import http.server
import os
import socket
import socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 4173


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Editing and reloading is the whole point; never let the phone
        # hold on to a stale app.js.
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One tidy line per request, so a failing asset is obvious.
        print("  %s" % (fmt % args), flush=True)


def lan_addresses():
    """Best-effort list of addresses this machine is reachable at."""
    found = []

    # Opening a UDP socket to a public address reveals which interface
    # would carry the traffic. Nothing is actually sent.
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        found.append(probe.getsockname()[0])
    except OSError:
        pass
    finally:
        probe.close()

    try:
        host = socket.gethostname()
        if host.endswith(".local"):
            found.append(host)
        else:
            found.append(host + ".local")
        for info in socket.getaddrinfo(host, None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass

    out = []
    for addr in found:
        if addr and not addr.startswith("127.") and addr not in out:
            out.append(addr)
    return out


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with Server(("0.0.0.0", PORT), handler) as httpd:
        print("\nServing %s\n" % ROOT, flush=True)
        addrs = lan_addresses()
        if addrs:
            print("Open this on your phone (same Wi-Fi):\n", flush=True)
            for addr in addrs:
                print("    http://%s:%d/?preview" % (addr, PORT), flush=True)
        else:
            print("Couldn't detect a LAN address — check System Settings > Network.", flush=True)
        print("\nOn this machine:  http://localhost:%d/?preview" % PORT, flush=True)
        print("\nCtrl-C to stop.\n", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.\n")
