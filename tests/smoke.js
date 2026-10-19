// Test navigateur (Chromium, écran 393x851 ~ Redmi Note 13) de toute l'interface contre le faux ESP32.
const { chromium } = require(process.env.PW || '/home/claude/.npm-global/lib/node_modules/playwright');
const assert = require('assert');
const start = require('./dev-server.js');
let pass = 0, bad = 0;
async function t(n, f) { try { await f(); pass++; console.log('  ✔', n); } catch (e) { bad++; console.log('  ✘', n, '\n     ', e.message); } }

(async () => {
  const app = await start();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(app.url + '/#/home');
  await page.waitForSelector('.chip.online', { timeout: 5000 });

  await t('Accueil : photo réelle chargée (pas le repli)', async () => {
    const ok = await page.evaluate(() => { const i = document.querySelector('#hero img'); return i.complete && i.naturalWidth === 666 && !document.querySelector('#hero.noimg'); });
    assert(ok);
  });
  await t('Accueil : nom, indicateur « Connecté », résumé', async () => {
    assert((await page.textContent('.hero h1')).includes('Ma Maison Intelligente'));
    assert((await page.textContent('.chip')).includes('Connecté'));
    assert((await page.textContent('.rows')).includes('À intégrer'));
  });
  await page.screenshot({ path: '/tmp/shot-home.png' });

  await t('Navigation : les 5 pages s’ouvrent', async () => {
    for (const r of ['lights', 'sensors', 'security', 'settings', 'home']) {
      await page.click(`#nav a[data-r=${r}]`);
      await page.waitForSelector(`#nav a[data-r=${r}][aria-current=page]`, { timeout: 3000 });
    }
  });

  await page.click('#nav a[data-r=lights]');
  await page.waitForSelector('.led');
  await t('Éclairage : 7 cartes avec GPIO du firmware', async () => {
    const subs = await page.$$eval('.led .sub', (e) => e.map((x) => x.textContent));
    assert.deepStrictEqual(subs, ['LED 1 · GPIO 2', 'LED 2 · GPIO 4', 'LED 3 · GPIO 5', 'LED 4 · GPIO 18', 'LED 5 · GPIO 19', 'LED 6 · GPIO 21', 'LED 7 · GPIO 22']);
  });
  for (let i = 0; i < 7; i++) {
    await t(`LED ${i + 1} : allumer puis éteindre depuis l'interface`, async () => {
      const sw = page.locator(`.switch[data-i="${i}"]`);
      await sw.click();
      await page.waitForFunction((k) => document.querySelectorAll('.switch')[k].getAttribute('aria-checked') === 'true' && !document.querySelectorAll('.switch')[k].disabled, i);
      assert.strictEqual(app.mock.st.leds[i], true, 'GPIO réellement commandé (faux ESP32)');
      assert(/confirmée/.test(await page.locator('.led').nth(i).locator('.st').textContent()));
      await page.locator(`.switch[data-i="${i}"]`).click();
      await page.waitForFunction((k) => document.querySelectorAll('.switch')[k].getAttribute('aria-checked') === 'false' && !document.querySelectorAll('.switch')[k].disabled, i);
      assert.strictEqual(app.mock.st.leds[i], false);
    });
  }
  await t('Anti double clic : 2 clics rapides = un seul changement', async () => {
    app.mock.st.hits.length = 0;
    await page.evaluate(() => { const s = document.querySelectorAll('.switch')[0]; s.click(); s.click(); });
    await page.waitForFunction(() => document.querySelectorAll('.switch')[0].getAttribute('aria-checked') === 'true' && !document.querySelectorAll('.switch')[0].disabled);
    assert.strictEqual(app.mock.st.hits.filter((h) => h.startsWith('/toggle')).length, 1);
    assert.strictEqual(app.mock.st.leds[0], true);
  });
  await t('Allumer tout / Éteindre tout', async () => {
    await page.click('[data-act=all-on]');
    await page.waitForFunction(() => [...document.querySelectorAll('.switch')].every((s) => s.getAttribute('aria-checked') === 'true'));
    assert(app.mock.st.leds.every(Boolean));
    await page.click('[data-act=all-off]');
    await page.waitForFunction(() => [...document.querySelectorAll('.switch')].every((s) => s.getAttribute('aria-checked') === 'false'));
    assert(app.mock.st.leds.every((x) => !x));
  });
  await page.click('[data-act=all-on]');
  await page.waitForFunction(() => document.querySelectorAll('.led.is-on').length === 7);
  await page.waitForTimeout(3500); await page.screenshot({ path: '/tmp/shot-lights.png' });
  await page.click('[data-act=all-off]');

  await t('Capteurs / Sécurité : « À intégrer », aucune fausse valeur', async () => {
    await page.click('#nav a[data-r=sensors]');
    await page.waitForSelector('#nav a[data-r=sensors][aria-current=page]');
    let txt = await page.textContent('#view');
    assert(txt.includes('À intégrer') && !/\d\s?°C|\d\s?%/.test(txt));
    await page.click('#nav a[data-r=security]');
    await page.waitForSelector('#nav a[data-r=security][aria-current=page]');
    txt = await page.textContent('#view');
    assert(txt.includes('RFID') && txt.includes('ESP32-S3-CAM') && txt.includes('À intégrer'));
  });

  await t('ESP32 déconnecté : erreur claire, commande non présentée comme réussie, Réessayer', async () => {
    await page.click('#nav a[data-r=lights]');
    await page.waitForSelector('.led');
    await new Promise((r) => app.mock.server.close(r)); // l'ESP32 « tombe »
    await page.click('.switch[data-i="2"]');
    await page.waitForSelector('.led .err');
    assert(/injoignable|ne répond pas/.test(await page.textContent('.led .err')));
    assert.strictEqual(await page.getAttribute('.switch[data-i="2"]', 'aria-checked'), 'false');
    assert(await page.isVisible('#banner'));
    assert(/Dernier état connu/.test(await page.textContent('.led:nth-child(3) .st')));
    assert(await page.isVisible('[data-act=retry]'));
  });
  await page.screenshot({ path: '/tmp/shot-error.png' });

  await t('Réglages : IP invalide refusée avec message', async () => {
    await page.click('#nav a[data-r=settings]');
    await page.waitForSelector('#host');
    await page.fill('#host', '8.8.8.8'); await page.click('[data-act=save]');
    await page.waitForSelector('#testres:not([hidden])');
    assert(/invalide|locale/i.test(await page.textContent('#testres')));
    await page.fill('#host', '999.1.1.1'); await page.click('[data-act=save]');
    assert(/invalide/i.test(await page.textContent('#testres')));
  });
  await t('Réglages : changer l’adresse sans rebuild, puis tester (ESP32 revenu)', async () => {
    const { createMock } = require('./mock-esp.js');
    const m2 = createMock(); await new Promise((r) => m2.server.listen(0, '127.0.0.1', r));
    await page.fill('#host', '127.0.0.1'); await page.fill('#port', String(m2.server.address().port));
    await page.click('[data-act=test]');
    await page.waitForFunction(() => /Connecté ✔/.test((document.querySelector('#testres') || {}).textContent || ''));
    assert(/7 LED détectées \(GPIO 2, 4, 5, 18, 19, 21, 22\)/.test(await page.textContent('#testres')));
    m2.server.close();
  });
  await page.screenshot({ path: '/tmp/shot-settings.png' });

  await t('PWA : manifest valide et service worker enregistré', async () => {
    const m = await (await page.request.get(app.url + '/manifest.webmanifest')).json();
    assert(m.display === 'standalone' && m.icons.length >= 3);
    for (const ic of m.icons) assert((await page.request.get(app.url + '/' + ic.src)).ok());
    await page.evaluate(() => navigator.serviceWorker.ready);
    assert((await page.evaluate(() => navigator.serviceWorker.getRegistrations())).length === 1);
  });
  await t('Réponse PHP polluée (avis/erreur) -> message précis, pas « injoignable »', async () => {
    await page.route('**/api/esp.php', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<br />Deprecated: Function curl_close() is deprecated in /x/esp.php on line 9{"ok":true}' }));
    await page.click('#nav a[data-r=lights]');
    await page.click('#nav a[data-r=home]');
    await page.waitForFunction(() => /erreur PHP/.test((document.querySelector('#banner') || {}).textContent || ''), null, { timeout: 8000 });
    const b = await page.textContent('#banner');
    assert(/Deprecated/.test(b) && /HTTP 200/.test(b));
    await page.unroute('**/api/esp.php');
  });

  // ---------- v1.3 ----------
  await page.unroute('**/api/esp.php').catch(() => {});
  await page.goto(app.url + '/#/settings');
  await page.waitForSelector('#devsec');

  await t('Développeur : section visible, aucun champ de saisie affiché (champ caché)', async () => {
    assert((await page.textContent('#devsec')).includes('non renseignées'));
    assert.strictEqual(await page.locator('#devsec input, #modal').count(), 0);
  });
  await t('Développeur : 5 appuis rapides ouvrent l’édition cachée, 4 appuis non', async () => {
    for (let i = 0; i < 4; i++) await page.click('#devtap');
    assert.strictEqual(await page.locator('#modal').count(), 0);
    await page.click('#devtap');
    await page.waitForSelector('#modal');
  });
  await t('Développeur : nom, prénoms et photo enregistrés puis affichés comme une section normale', async () => {
    await page.fill('#dv-nom', 'Dupont'); await page.fill('#dv-pre', 'Jean Marc');
    await page.setInputFiles('#dv-file', '/home/claude/MaMaisonIntelligente_v1.3/assets/icons/icon-192.png');
    await page.waitForFunction(() => document.querySelector('#dv-prev img'));
    await page.click('[data-act=dev-save]');
    await page.waitForSelector('#modal', { state: 'detached' });
    const txt = await page.textContent('#devsec');
    assert(txt.includes('Jean Marc DUPONT'), txt);
    assert(await page.locator('#devsec img.avatar').count() === 1);
    assert.strictEqual(await page.locator('#devsec input').count(), 0);
  });
  await page.screenshot({ path: '/tmp/shot-dev.png', fullPage: true });
  await t('Développeur : persiste après rechargement (serveur) et reste modifiable', async () => {
    await page.reload(); await page.waitForSelector('#devsec img.avatar');
    assert((await page.textContent('#devsec')).includes('Jean Marc DUPONT'));
    for (let i = 0; i < 5; i++) await page.click('#devsec');
    await page.waitForSelector('#modal');
    assert.strictEqual(await page.inputValue('#dv-nom'), 'Dupont');
    await page.fill('#dv-nom', 'Martin'); await page.click('[data-act=dev-save]');
    await page.waitForFunction(() => /Jean Marc MARTIN/.test(document.querySelector('#devsec').textContent));
  });
  await t('Développeur : photo non image refusée côté serveur', async () => {
    const r = await page.evaluate(() => ESP.saveProfile({ nom: 'x', prenoms: 'y', photo: 'data:text/html;base64,AAAA' }).then(() => 'ok', (e) => e.code));
    assert.strictEqual(r, 'invalid_photo');
  });

  await t('Thème : Sombre / Clair / Auto, fond qui change et mémorisé après rechargement', async () => {
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click('[data-act=theme-set][data-v=light]'); const light = await bg();
    await page.click('[data-act=theme-set][data-v=dark]'); const dark = await bg();
    assert.notStrictEqual(light, dark);
    assert.strictEqual(await page.getAttribute('html', 'data-theme'), 'dark');
    await page.screenshot({ path: '/tmp/shot-dark.png' });
    await page.reload(); await page.waitForSelector('#devsec');
    assert.strictEqual(await page.getAttribute('html', 'data-theme'), 'dark');
    assert.strictEqual(await bg(), dark);
    await page.click('[data-act=theme-set][data-v=auto]');
    assert.strictEqual(await page.getAttribute('html', 'data-theme'), null);
  });
  await t('Thème : bouton rapide de l’accueil bascule clair/sombre', async () => {
    await page.click('[data-act=theme-set][data-v=light]');
    await page.click('#nav a[data-r=home]'); await page.waitForSelector('.theme-btn');
    await page.click('.theme-btn');
    assert.strictEqual(await page.getAttribute('html', 'data-theme'), 'dark');
    await page.click('.theme-btn');
    assert.strictEqual(await page.getAttribute('html', 'data-theme'), 'light');
    await page.evaluate(() => localStorage.removeItem('mmi.theme')); await page.reload();
  });

  await t('Recherche ESP32 : trouvé -> adresse remplie, enregistrée et testée automatiquement', async () => {
    const m3 = require('./mock-esp.js').createMock(); await new Promise((r) => m3.server.listen(0, '127.0.0.1', r)); app.setScanPort(m3.server.address().port);
    await page.goto(app.url + '/#/settings'); await page.waitForSelector('#host');
    await page.fill('#host', '192.168.1.1');
    await page.click('[data-act=scan]');
    await page.waitForFunction(() => /Connecté ✔/.test((document.querySelector('#testres') || {}).textContent || ''), null, { timeout: 8000 });
    assert.strictEqual(await page.inputValue('#host'), '127.0.0.1');
  });
  await t('Recherche ESP32 : rien trouvé -> message d’aide avec les réseaux explorés', async () => {
    await page.fill('#subnet', '10.9.9'); await page.click('[data-act=scan]');
    await page.waitForFunction(() => /Aucun ESP32 trouvé/.test((document.querySelector('#scanres') || {}).textContent || ''));
    assert((await page.textContent('#scanres')).includes('10.9.9.0/24'));
  });

  await t('Installation : section présente avec les étapes et bouton quand Chrome le propose', async () => {
    const txt = await page.textContent('#instsec');
    assert(/Installer l’application/.test(txt) && /localhost:8000/.test(txt));
    await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
    await page.waitForSelector('#instsec [data-act=install]');
    await page.click('#instsec [data-act=install]');
    assert.strictEqual(await page.evaluate(() => window.__prompted), true);
  });

  await t('Aucune erreur JavaScript', async () => assert.deepStrictEqual(errors, []));

  await browser.close(); app.close();
  console.log(`\n${pass} réussis, ${bad} échoués`); process.exit(bad ? 1 : 0);
})();
