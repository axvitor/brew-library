import functools, http.server, os, socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


Handler = functools.partial(NoCacheHandler, directory=ROOT)


class Server(socketserver.TCPServer):
    allow_reuse_address = True


with Server(("127.0.0.1", 4173), Handler) as httpd:
    print("serving %s on http://127.0.0.1:4173" % ROOT, flush=True)
    httpd.serve_forever()
