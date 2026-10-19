// SERVEUR DE TEST UNIQUEMENT (Node) : sert la PWA et imite le contrat JSON de api/esp.php.
// Le vrai relais PHP n'est pas exécuté ici (PHP absent de l'environnement de test).
const http = require('http'), fs = require('fs'), path = require('path');
const { createMock } = require('./mock-esp.js');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const privRe = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|127\.0\.0\.1)$/; // 127 admis ici pour le faux ESP32
module.exports = async function start(opts = {}) {
  const mock = createMock();
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  let scanPort = null;
  let profile = { nom: '', prenoms: '', photo: '' };
  let cfg = { host: opts.host === undefined ? '127.0.0.1' : opts.host, port: mock.server.address().port };
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/api/esp.php')) {
      let b = ''; req.on('data', (c) => b += c); req.on('end', () => {
        const J = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
        if (req.method !== 'POST' || req.headers['x-mmi'] !== '1') return J({ ok: false, error: 'forbidden' }, 403);
        const q = JSON.parse(b || '{}');
        if (q.action === 'config_get') return J({ ok: true, config: cfg });
        if (q.action === 'config_set') {
          if (!privRe.test(q.host || '')) return J({ ok: false, error: 'invalid_ip' });
          cfg = { host: q.host, port: +q.port }; return J({ ok: true, config: cfg });
        }
        if (q.action === 'profile_get') return J({ ok: true, profile });
        if (q.action === 'profile_set') {
          const ph = q.photo || '';
          if (ph && (!/^data:image\/(jpeg|png|webp);base64,/.test(ph) || ph.length > 400000)) return J({ ok: false, error: 'invalid_photo' });
          profile = { nom: String(q.nom || '').slice(0, 60), prenoms: String(q.prenoms || '').slice(0, 80), photo: ph };
          return J({ ok: true, profile });
        }
        if (q.action === 'scan') {  // imite le contrat du vrai relais (le scan PHP n'est pas exécuté ici)
          if (q.subnet === '10.9.9') return J({ ok: true, found: [], scanned: 254, subnets: ['10.9.9.0/24'] });
          return J({ ok: true, found: [{ ip: '127.0.0.1', port: scanPort || mock.server.address().port, ms: 4 }], scanned: 254, subnets: ['127.0.0.0/24'] });
        }
        if (q.action === 'get') {
          if (!/^\/(all\/(on|off)|toggle\/[0-6]|led\/[0-6]\/(on|off))?$/.test(q.path)) return J({ ok: false, error: 'forbidden' }, 403);
          if (!cfg.host) return J({ ok: false, error: 'not_configured' });
          const t0 = Date.now();
          const r = http.get({ host: cfg.host, port: cfg.port, path: q.path, timeout: 1500 }, (rr) => {
            let d = ''; rr.on('data', (c) => d += c); rr.on('end', () => J({ ok: true, http: rr.statusCode, ms: Date.now() - t0, body: d }));
          });
          r.on('timeout', () => { r.destroy(); J({ ok: false, error: 'timeout' }); });
          r.on('error', () => { if (!res.headersSent) J({ ok: false, error: 'unreachable' }); });
          return;
        }
        J({ ok: false, error: 'bad_request' }, 400);
      });
      return;
    }
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: 'http://localhost:' + srv.address().port, mock, setCfg: (c) => { cfg = c; }, setScanPort: (p) => { scanPort = p; }, close: () => { srv.close(); mock.server.close(); } };
};
