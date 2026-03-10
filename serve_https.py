import http.server, ssl

PORT = 8443
handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.HTTPServer(("localhost", PORT), handler)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(certfile="cert.pem", keyfile="key.pem")
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

print(f"Serving https://localhost:{PORT}")
httpd.serve_forever()