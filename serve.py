"""Local web server for NITRO LINK (used by start.bat).

Same as `python -m http.server`, but tells the browser not to cache files,
so a normal refresh always loads the latest version of the game.
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # The browser opens many connections at once when loading the game's modules;
    # the default backlog of 5 makes Windows refuse some of them.
    request_queue_size = 128
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with Server(("127.0.0.1", port), NoCacheHandler) as httpd:
        print(f"NITRO LINK is running at http://localhost:{port}  (Ctrl+C to stop)")
        httpd.serve_forever()
