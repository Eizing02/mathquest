const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.gif':'image/gif', '.woff2':'font/woff2' };

async function startServer(port = 0) {
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep) || pathname.split('/').some(part=>part.startsWith('.')) || !types[path.extname(file)] || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404); return response.end('Not found');
      }
      response.setHeader('Content-Type',types[path.extname(file)]);
      response.setHeader('Cache-Control','no-store');
      fs.createReadStream(file).pipe(response);
    } catch { response.writeHead(400); response.end('Bad request'); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return server;
}
module.exports = { startServer };
if (require.main === module) startServer(Number(process.argv[2]) || 5173).then(server=>console.log('MathQuest: http://127.0.0.1:'+server.address().port)).catch(error=>{console.error(error.message);process.exitCode=1;});
