// Faux ESP32 : reproduit les routes et le HTML du firmware fourni (serveur Web, port variable).
const http = require('http');
const pins = [2, 4, 5, 18, 19, 21, 22];
function createMock() {
  const st = { leds: new Array(7).fill(false), delay: 0, hits: [] };
  function page() {
    let p = '<!DOCTYPE html><html><head><title>Ma maison intelligente</title></head><body>\n' +
      '<h1>Ma maison intelligente</h1><h2>Commande de 7 LED</h2><div class="carte"><a href="/all/on"><button class="on">ALLUMER TOUT</button></a><a href="/all/off"><button class="off">ETEINDRE TOUT</button></a></div>';
    for (let i = 0; i < 7; i++) {
      p += "<div class='carte'><h3>LED " + (i + 1) + ' - GPIO ' + pins[i] + '</h3><p>Etat : <b>' + (st.leds[i] ? 'ALLUMEE' : 'ETEINTE') + '</b></p>';
      p += "<a href='/toggle/" + i + "'><button class='" + (st.leds[i] ? 'off' : 'on') + "'>" + (st.leds[i] ? 'ETEINDRE' : 'ALLUMER') + '</button></a></div>';
    }
    return p + '</body></html>';
  }
  const server = http.createServer((req, res) => {
    st.hits.push(req.url);
    const respond = () => {
      let m;
      if (req.url === '/') { /* page */ }
      else if (req.url === '/all/on') st.leds.fill(true);
      else if (req.url === '/all/off') st.leds.fill(false);
      else if ((m = req.url.match(/^\/toggle\/([0-6])$/))) st.leds[+m[1]] = !st.leds[+m[1]];
      else if ((m = req.url.match(/^\/led\/([0-6])\/(on|off)$/))) st.leds[+m[1]] = m[2] === 'on';
      else { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page());
    };
    st.delay ? setTimeout(respond, st.delay) : respond();
  });
  return { server, st, page };
}
module.exports = { createMock, pins };
