/* Client ESP32 — logique de commande, indépendante de l'interface (testable sous Node).
 * Contrat avec le firmware (lu dans le code fourni) :
 *   GET /            -> page HTML avec l'état de chaque LED
 *   GET /toggle/N    -> INVERSE la LED N (0..6) puis renvoie la même page
 *   GET /all/on|off  -> allume / éteint tout puis renvoie la même page
 * Comme /toggle/N inverse au lieu de fixer, setLed() lit d'abord l'état et ne
 * bascule que si nécessaire, puis vérifie l'état renvoyé par l'ESP32. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ESP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LED_COUNT = 7;
  var DEFAULT_PINS = [2, 4, 5, 18, 19, 21, 22];

  function EspError(code, message) {
    var e = new Error(message || code);
    e.name = 'EspError';
    e.code = code;
    return e;
  }

  var MESSAGES = {
    not_configured: "Adresse de l'ESP32 non configurée. Ouvrez Réglages pour la saisir.",
    invalid_ip: 'Adresse IP invalide. Exemple : 192.168.43.25',
    invalid_port: 'Port invalide (1 à 65535).',
    timeout: "L'ESP32 ne répond pas (délai dépassé). Vérifiez qu'il est alimenté et sur le même hotspot.",
    unreachable: 'ESP32 injoignable à cette adresse. Vérifiez l’IP (elle peut avoir changé) et le Wi-Fi.',
    http_error: "L'ESP32 a répondu avec une erreur.",
    bad_response: "Réponse inattendue : ce n'est pas la page du firmware attendu.",
    mismatch: "L'ESP32 n'a pas confirmé le changement d'état.",
    proxy_down: 'Serveur local Termux injoignable. Relancez « bash start.sh » dans Termux.',
    proxy_error: 'Le serveur local répond mais avec une erreur PHP (voir la fenêtre Termux ou lancez « bash diagnostic.sh »).',
    server_error: 'Erreur interne du relais PHP.',
    invalid_photo: 'Photo refusée (format ou taille).',
    forbidden: 'Requête refusée par le serveur local.',
    write_failed: "Impossible d'enregistrer la configuration."
  };

  function explain(err) {
    if (!err) return 'Erreur inconnue.';
    if (err.code === 'proxy_error') return MESSAGES.proxy_error + (err.message && err.message !== 'proxy_error' ? ' Détail : ' + err.message : '');
    if (err.code === 'server_error') return err.message && err.message !== 'server_error' ? err.message : MESSAGES.server_error;
    return MESSAGES[err.code] || err.message || 'Erreur inconnue.';
  }

  // Extrait l'état des 7 LED de la page HTML du firmware.
  function parseState(html) {
    if (typeof html !== 'string') throw EspError('bad_response');
    var re = /LED\s+(\d+)\s*-\s*GPIO\s*(\d+)\s*<\/h3>\s*<p>\s*Etat\s*:\s*<b>\s*(ALLUMEE|ETEINTE)\s*<\/b>/gi;
    var leds = new Array(LED_COUNT).fill(null);
    var m;
    while ((m = re.exec(html)) !== null) {
      var n = parseInt(m[1], 10);
      if (n >= 1 && n <= LED_COUNT) {
        leds[n - 1] = { index: n - 1, number: n, gpio: parseInt(m[2], 10), on: m[3].toUpperCase() === 'ALLUMEE' };
      }
    }
    for (var i = 0; i < LED_COUNT; i++) if (!leds[i]) throw EspError('bad_response');
    return { leds: leds, at: Date.now() };
  }

  // transport(path) -> Promise<{ok:true, body, ms}>  ou rejette EspError
  function createClient(transport) {
    function call(path) { return transport(path); }

    function status() {
      return call('/').then(function (r) {
        var s = parseState(r.body);
        s.ms = r.ms;
        return s;
      });
    }

    function setLed(index, want) {
      if (!(index >= 0 && index < LED_COUNT)) return Promise.reject(EspError('bad_response', 'LED inconnue'));
      return call('/led/' + index + '/' + (want ? 'on' : 'off')).then(function (r) {
        var after = parseState(r.body);
        after.ms = r.ms;
        if (after.leds[index].on !== want) throw EspError('mismatch');
        return { state: after, changed: true };
      });
    }

    function setAll(want) {
      return call(want ? '/all/on' : '/all/off').then(function (r) {
        var after = parseState(r.body);
        after.ms = r.ms;
        for (var i = 0; i < LED_COUNT; i++) if (after.leds[i].on !== want) throw EspError('mismatch');
        return { state: after };
      });
    }

    return { status: status, setLed: setLed, setAll: setAll };
  }

  // Transport navigateur : passe par le relais PHP de Termux (même origine).
  function proxyPost(payload, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 9000) : null;
    return fetch('api/esp.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MMI': '1' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data;
        try { data = JSON.parse(txt); } catch (e) {
          var snippet = String(txt).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
          throw EspError('proxy_error', 'HTTP ' + res.status + (snippet ? ' — ' + snippet : ' — réponse vide'));
        }
        return data;
      });
    }).then(function (data) {
      if (timer) clearTimeout(timer);
      return data;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw (e && e.name === 'EspError') ? e : EspError('proxy_down');
    });
  }

  function browserTransport(path) {
    return proxyPost({ action: 'get', path: path }).then(function (d) {
      if (!d || d.ok !== true) throw EspError((d && d.error) || 'proxy_down', d && d.message);
      return d;
    });
  }

  function getConnectionStatus() {
    return proxyPost({ action: 'connection_get' }, 3000).then(function (d) {
      if (!d || d.ok !== true) {
        throw EspError((d && d.error) || 'proxy_down', d && d.message);
      }
      return (d.status === 'online' || d.status === 'offline')
        ? d.status : 'unknown';
    });
  }

  function setAutoMode() {
    return proxyPost({ action: 'mode_auto' }, 5000).then(function (d) {
      if (!d || d.ok !== true) {
        throw EspError((d && d.error) || 'proxy_down', d && d.message);
      }
      return d;
    });
  }

  function getConfig() {
    return proxyPost({ action: 'config_get' }).then(function (d) {
      if (!d || d.ok !== true) throw EspError('proxy_down');
      return d.config;
    });
  }

  function saveConfig(host, port) {
    return proxyPost({ action: 'config_set', host: host, port: port }).then(function (d) {
      if (!d || d.ok !== true) throw EspError((d && d.error) || 'proxy_down', d && d.message);
      return d.config;
    });
  }

  function getProfile() {
    return proxyPost({ action: 'profile_get' }).then(function (d) {
      if (!d || d.ok !== true) throw EspError((d && d.error) || 'proxy_down', d && d.message);
      return d.profile;
    });
  }

  function saveProfile(p) {
    return proxyPost({ action: 'profile_set', nom: p.nom, prenoms: p.prenoms, photo: p.photo }).then(function (d) {
      if (!d || d.ok !== true) throw EspError((d && d.error) || 'proxy_down', d && d.message);
      return d.profile;
    });
  }

  // Recherche de l'ESP32 sur le réseau du hotspot (peut durer jusqu'à ~30 s).
  function scan(port, subnet) {
    return proxyPost({ action: 'scan', port: port, subnet: subnet || '' }, 70000).then(function (d) {
      if (!d || d.ok !== true) throw EspError((d && d.error) || 'proxy_down', d && d.message);
      return d;
    });
  }

  return {
    setAutoMode: setAutoMode,
    getProfile: getProfile, saveProfile: saveProfile, scan: scan,
    LED_COUNT: LED_COUNT, DEFAULT_PINS: DEFAULT_PINS, EspError: EspError,
    explain: explain, parseState: parseState, createClient: createClient,
    browserTransport: browserTransport, getConfig: getConfig, saveConfig: saveConfig,
    getConnectionStatus: getConnectionStatus
  };
});
