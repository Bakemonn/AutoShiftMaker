const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const publicFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/scheduler.js', 'scheduler.js'],
  ['/test-pattern.js', 'test-pattern.js'],
]);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function createServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const filename = publicFiles.get(pathname);

    if (!filename) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end('Method Not Allowed');
      return;
    }

    const filePath = path.join(__dirname, filename);
    fs.readFile(filePath, (error, data) => {
      if (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Internal Server Error');
        return;
      }

      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': contentTypes[path.extname(filename)],
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    });
  });
}

function getNetworkAddresses(port) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address?.family === 'IPv4' && !address.internal)
    .map((address) => `http://${address.address}:${port}`);
}

if (require.main === module) {
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || 4173);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORTには1から65535までの整数を指定してください。');
    process.exit(1);
  }

  createServer().listen(port, host, () => {
    console.log(`PC: http://localhost:${port}`);
    for (const address of getNetworkAddresses(port)) {
      console.log(`スマホ: ${address}`);
    }
    console.log('終了するには Ctrl+C を押してください。');
  });
}

module.exports = { createServer, getNetworkAddresses };
