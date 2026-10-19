// Tests de la logique de commande contre un faux ESP32 fidèle au firmware.
const assert = require('assert');
const http = require('http');
const ESP = require('../assets/js/esp.js');
const { createMock } = require('./mock-esp.js');

function directTransport(port, timeoutMs) {
  return (path) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = http.get({ host: '127.0.0.1', port, path, timeout: timeoutMs || 1500 }, (res) => {
      let b = ''; res.on('data', (c) => b += c);
      res.on('end', () => res.statusCode === 200 ? resolve({ ok: true, body: b, ms: Date.now() - t0 }) : reject(ESP.EspError('http_error')));
    });
    req.on('timeout', () => { req.destroy(); reject(ESP.EspError('timeout')); });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET' || !req.destroyed) reject(ESP.EspError('unreachable')); });
  });
}

let pass = 0, failN = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✔', name); }
  catch (e) { failN++; console.log('  ✘', name, '\n     ', e && e.stack || e); }
}

(async () => {
  const { server, st } = createMock();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const api = ESP.createClient(directTransport(port));

  await t('parseState lit les 7 LED et les GPIO du firmware', async () => {
    const s = await api.status();
    assert.strictEqual(s.leds.length, 7);
    assert.deepStrictEqual(s.leds.map((l) => l.gpio), [2, 4, 5, 18, 19, 21, 22]);
    assert(s.leds.every((l) => l.on === false));
  });

  for (let i = 0; i < 7; i++) {
    await t('LED ' + (i + 1) + ' : allumage puis extinction confirmés', async () => {
      let r = await api.setLed(i, true);
      assert.strictEqual(r.state.leds[i].on, true);
      assert.strictEqual(st.leds[i], true);
      assert(r.state.leds.filter((l, k) => k !== i).every((l) => !l.on), 'les autres LED ne bougent pas');
      r = await api.setLed(i, false);
      assert.strictEqual(r.state.leds[i].on, false);
      assert.strictEqual(st.leds[i], false);
    });
  }

  await t('commande ON explicite repetee : la LED reste allumee', async () => {
    await api.setLed(3, true);
    const r = await api.setLed(3, true);
    assert.strictEqual(r.state.leds[3].on, true);
    assert.strictEqual(st.leds[3], true);
    assert(st.hits.includes('/led/3/on'), 'route ON explicite utilisee');
    await api.setLed(3, false);
    assert.strictEqual(st.leds[3], false);
  });

  await t('Allumer tout / Éteindre tout', async () => {
    let r = await api.setAll(true);
    assert(r.state.leds.every((l) => l.on)); assert(st.leds.every(Boolean));
    r = await api.setAll(false);
    assert(r.state.leds.every((l) => !l.on)); assert(st.leds.every((x) => !x));
  });

  await t('délai dépassé -> erreur timeout (et message clair)', async () => {
    st.delay = 600;
    const slow = ESP.createClient(directTransport(port, 150));
    await assert.rejects(slow.status(), (e) => e.code === 'timeout' && /ne répond pas/.test(ESP.explain(e)));
    st.delay = 0;
  });

  await t('ESP32 injoignable (port fermé) -> erreur unreachable', async () => {
    const dead = ESP.createClient(directTransport(1, 500));
    await assert.rejects(dead.status(), (e) => e.code === 'unreachable');
  });

  await t('réponse qui n’est pas celle du firmware -> bad_response', async () => {
    assert.throws(() => ESP.parseState('<html>routeur</html>'), (e) => e.code === 'bad_response');
  });

  await t('état non confirmé -> mismatch (jamais présenté comme réussi)', async () => {
    const liar = ESP.createClient(async (p) => ({ ok: true, ms: 1, body: createMock().page() })); // renvoie toujours tout éteint
    await assert.rejects(liar.setLed(2, true), (e) => e.code === 'mismatch');
  });

  server.close();
  console.log(`\n${pass} réussis, ${failN} échoués`);
  process.exit(failN ? 1 : 0);
})();
