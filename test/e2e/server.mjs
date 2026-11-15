// The e2e tests' web servers, started by playwright.config.js:
//   http://localhost:8601   the pages: /video?src=<url> plays a video, /other is another page
//   http://127.0.0.1:8602   another origin with the same routes, serving the videos without CORS
//                           headers (like a CDN that doesn't allow reading them)
// Videos are the files in fixtures/, at /fixtures/<name>.webm on both, with range requests.
import fs from 'node:fs';
import http from 'node:http';

const page = (body) =>
    `<!doctype html><meta charset="utf-8"><title>e2e</title><body style="margin:0;background:#111;color:#eee">${body}</body>`;

function serve(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/video') {
        // a small preview video above the one to watch, so "the largest video" means something
        const src = url.searchParams.get('src');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(
            page(`<p>e2e test page</p>
<video src="/fixtures/mono.webm" muted loop autoplay playsinline style="width:160px"></video>
<video id="main" src="${src}" muted loop autoplay playsinline style="width:640px;display:block"></video>`),
        );
    }
    if (url.pathname === '/other') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(page('<p>another page</p>'));
    }
    const name = /^\/fixtures\/([\w-]+\.webm)$/.exec(url.pathname)?.[1];
    if (!name) return res.writeHead(404).end();
    const file = new URL(`./fixtures/${name}`, import.meta.url);
    const size = fs.statSync(file).size;
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const headers = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' };
    if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : size - 1;
        res.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': end - start + 1,
        });
        fs.createReadStream(file, { start, end }).pipe(res);
    } else {
        res.writeHead(200, { ...headers, 'Content-Length': size });
        fs.createReadStream(file).pipe(res);
    }
}

http.createServer(serve).listen(8601, 'localhost');
http.createServer(serve).listen(8602, '127.0.0.1');
console.log('e2e servers on http://localhost:8601 and http://127.0.0.1:8602');
