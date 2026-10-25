/* Ma Maison Intelligente — interface (PWA). La logique de commande est dans esp.js. */
(function () {
  'use strict';
  var VERSION = '1.4.0 MQTT';
  var api = ESP.createClient(ESP.browserTransport);

  /* ---------- Icônes ---------- */
  var IC = {
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    therm: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    camera: '<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    motion: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    rain: '<path d="M7 16a4 4 0 1 1 1-7.9A5 5 0 0 1 17.5 9 3.5 3.5 0 0 1 17 16"/><path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    power: '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/>'
  };
  function svg(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + IC[n] + '</svg>'; }

  /* ---------- Thème : auto / clair / sombre ---------- */
  function getTheme() { try { var t = localStorage.getItem('mmi.theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; } }
  function effectiveTheme() {
    var t = getTheme();
    if (t !== 'auto') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme() {
    var t = getTheme(), h = document.documentElement;
    if (t === 'auto') h.removeAttribute('data-theme'); else h.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', effectiveTheme() === 'dark' ? '#0b1220' : '#2563eb');
  }
  function setTheme(t) {
    try { if (t === 'auto') localStorage.removeItem('mmi.theme'); else localStorage.setItem('mmi.theme', t); } catch (e) {}
    applyTheme(); render();
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function () { applyTheme(); render(); });
  }

  /* ---------- État ---------- */
  var S = {
    conn: 'checking',
    mqttConn: 'checking',            // checking | online | offline | unconfigured | noserver
    lastErr: null, ms: null,
    leds: [null, null, null, null, null, null, null],   // dernier état connu : {on, gpio, at}
    sensors: { fumee: null, flamme: null, incendie: null, presence: null, ldr: null, mode: null },
    busy: [false, false, false, false, false, false, false],
    errs: [null, null, null, null, null, null, null],   // {msg, want}
    busyAll: false, errAll: null, busyAuto: false,
    names: loadNames(), deferredInstall: null,
    installed: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches),
    scanning: false
  };

  function loadNames() {
    try { var a = JSON.parse(localStorage.getItem('mmi.names') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function saveNames() { try { localStorage.setItem('mmi.names', JSON.stringify(S.names)); } catch (e) {} }
  function ledName(i) { return (S.names[i] && String(S.names[i]).trim()) || 'LED ' + (i + 1); }
  function gpioOf(i) { return S.leds[i] ? S.leds[i].gpio : ESP.DEFAULT_PINS[i]; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s, r) { return (r || document).querySelector(s); }


  /* Historique local */
  var HISTORY_KEY = 'mmi.history', HISTORY_MAX = 100;
  var historyEntries = loadHistory(), lastEventState = null;

  function loadHistory() {
    try {
      var a = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (x) {
        return x && typeof x.time === 'number' &&
          typeof x.message === 'string';
      }).slice(0, HISTORY_MAX) : [];
    } catch (e) { return []; }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(historyEntries));
    } catch (e) { console.warn('Historique local indisponible.', e); }
  }

  function addHistory(message) {
    historyEntries.unshift({time: Date.now(), message: message});
    if (historyEntries.length > HISTORY_MAX) historyEntries.length = HISTORY_MAX;
    saveHistory();
  }

  function trackState(st) {
    var n = {
      leds: st.leds.map(function (x) { return !!x.on; }),
      fumee: typeof st.fumee === 'boolean' ? st.fumee : null,
      flamme: typeof st.flamme === 'boolean' ? st.flamme : null,
      incendie: typeof st.incendie === 'boolean' ? st.incendie : null,
      presence: typeof st.presence === 'boolean' ? st.presence : null
    };
    // Suivi persistant de l’alarme, même après rechargement de la PWA.
    var fireKey = 'mmi.lastFireAlarmState';
    if (typeof n.incendie === 'boolean') {
      var fireNow = String(n.incendie);
      var fireBefore = null;
      try { fireBefore = localStorage.getItem(fireKey); } catch (e) {}

      if (fireBefore === null) {
        if (n.incendie) addHistory('ALARME INCENDIE ACTIVE au démarrage');
      } else if (fireBefore !== fireNow) {
        addHistory(n.incendie ? 'ALARME INCENDIE ACTIVÉE' : 'Alarme incendie désactivée');
      }

      try { localStorage.setItem(fireKey, fireNow); } catch (e) {}
    }

    if (lastEventState === null) { lastEventState = n; return; }

    for (var i = 0; i < 7; i++) {
      if (lastEventState.leds[i] !== n.leds[i])
        addHistory('Éclairage : ' + ledName(i) +
          (n.leds[i] ? ' allumé' : ' éteint'));
    }

    function changed(k, on, off) {
      var a = lastEventState[k], b = n[k];
      if (a !== null && b !== null && a !== b) addHistory(b ? on : off);
    }
    changed('fumee', 'Fumée/gaz détecté', 'Fumée/gaz non détecté');
    changed('flamme', 'Flamme détectée', 'Flamme non détectée');
    changed('presence', 'Présence détectée', 'Fin de présence détectée');
    lastEventState = n;
  }

  function viewHistory() {
    var out = '<div class="page-h"><div><h1>Historique</h1>' +
      '<p>Changements observés par la PWA</p></div></div>' +
      '<div class="bar"><button class="btn ghost" data-act="history-clear">' +
      'Effacer l’historique</button></div>';
    if (!historyEntries.length)
      return out + '<div class="card"><p class="note">Aucun événement enregistré.</p></div>';
    return out + '<div class="stack">' + historyEntries.map(function (x) {
      return '<div class="card"><p><strong>' + esc(x.message) +
        '</strong></p><p class="note">' +
        esc(new Date(x.time).toLocaleString()) + '</p></div>';
    }).join('') + '</div><p class="note">Maximum : 100 événements conservés sur ce navigateur.</p>';
  }

  function applyState(st) {
    if (!st || !Array.isArray(st.leds) || st.leds.length !== 7) {
      throw new Error('État MQTT invalide : les 7 LED sont requises.');
    }
    trackState(st);
    for (var i = 0; i < 7; i++) {
      S.leds[i] = { on: !!st.leds[i].on, gpio: st.leds[i].gpio, at: st.at || Date.now() };
    }
    var previousFire = S.sensors.incendie;
    S.sensors = {
      fumee: typeof st.fumee === 'boolean' ? st.fumee : null,
      flamme: typeof st.flamme === 'boolean' ? st.flamme : null,
      incendie: typeof st.incendie === 'boolean' ? st.incendie : null,
      presence: typeof st.presence === 'boolean' ? st.presence : null,
      ldr: typeof st.ldr === 'number' ? st.ldr : null,
      mode: typeof st.mode === 'string' ? st.mode : null
    };
    if (S.sensors.incendie === true && previousFire !== true) fireAlarmAlert();
    if (S.sensors.incendie !== true) stopFireSound();
    S.conn = 'online'; S.ms = st.ms; S.lastErr = null;
  }
  function applyError(e) {
    S.lastErr = e;
    S.conn = e.code === 'not_configured' ? 'unconfigured' : (e.code === 'proxy_down' || e.code === 'proxy_error' || e.code === 'server_error') ? 'noserver' : 'offline';
  }
  function onCount() { return S.leds.filter(function (l) { return l && l.on; }).length; }
  function anyBusy() { return S.busyAuto || S.busyAll || S.busy.some(Boolean); }

  /* ---------- Profil du développeur (champ caché) ---------- */
  var P = loadProfileLocal();
  function normalizeProfile(p) {
    p = p || {};
    return { nom: String(p.nom || ''), prenoms: String(p.prenoms || ''),
      photo: /^data:image\/(jpeg|png|webp);base64,/.test(p.photo || '') ? p.photo : '' };
  }
  function loadProfileLocal() {
    try { var p = JSON.parse(localStorage.getItem('mmi.profile') || 'null'); if (p) return normalizeProfile(p); } catch (e) {}
    return normalizeProfile({});
  }
  function cacheProfile() { try { localStorage.setItem('mmi.profile', JSON.stringify(P)); } catch (e) {} }
  function profileEmpty() { return !P.nom && !P.prenoms && !P.photo; }
  function initialsOf(p) { return ((p.prenoms || '').trim().charAt(0) + (p.nom || '').trim().charAt(0)).toUpperCase(); }
  function avatarHtml(photo, p) {
    if (photo) return '<img class="avatar" src="' + photo + '" alt="Photo du développeur">';
    return '<span class="avatar ph" aria-hidden="true">' + esc(initialsOf(p || P) || '?') + '</span>';
  }
  function loadProfileServer() {
    ESP.getProfile().then(function (p) {
      var sp = normalizeProfile(p);
      // Le serveur fait foi ; s'il est vide mais que ce téléphone a un profil, on le renvoie au serveur.
      if (!sp.nom && !sp.prenoms && !sp.photo && !profileEmpty()) { ESP.saveProfile(P).catch(function () {}); return; }
      P = sp; cacheProfile(); updateDev();
    }, function () { /* serveur injoignable : on garde la copie locale */ });
  }

  /* ---------- Rafraîchissement ---------- */
  function refresh() {
    if (anyBusy()) return Promise.resolve();
    return api.status().then(applyState, applyError).then(function () {
      return ESP.getConnectionStatus().then(function (status) {
        S.mqttConn = status;
      }, function () {
        S.mqttConn = 'unknown';
      });
    }).then(function () {
      if (!anyBusy()) softRender();
    });
  }

  /* ---------- Commandes ---------- */
  function command(i, want) {
    if (S.busy[i] || S.busyAll) return;                  // anti double clic
    S.busy[i] = true; S.errs[i] = null; render();
    api.setLed(i, want).then(function (r) {
      applyState(r.state);
      toast(ledName(i) + (want ? ' allumée' : ' éteinte') + ' · confirmé par l’ESP32', 'ok');
    }, function (e) {
      applyError(e); S.errs[i] = { msg: ESP.explain(e), want: want };
      toast('Échec : ' + ledName(i) + ' non modifiée', 'bad');
    }).then(function () { S.busy[i] = false; render(); });
  }
  function commandAll(want) {
    if (anyBusy()) return;
    S.busyAll = true; S.errAll = null; render();
    api.setAll(want).then(function (r) {
      applyState(r.state);
      toast(want ? 'Toutes les LED sont allumées · confirmé' : 'Toutes les LED sont éteintes · confirmé', 'ok');
    }, function (e) {
      applyError(e); S.errAll = { msg: ESP.explain(e), want: want };
      toast('Échec de la commande globale', 'bad');
    }).then(function () { S.busyAll = false; render(); });
  }

  function commandAuto() {
    if (anyBusy()) return;
    S.busyAuto = true;
    S.errAll = null;
    render();

    ESP.setAutoMode().then(function () {
      toast('Commande du mode automatique envoyée', 'ok');
    }, function (e) {
      applyError(e);
      S.errAll = { msg: ESP.explain(e), want: null };
      toast('Échec du retour au mode automatique', 'bad');
    }).then(function () {
      S.busyAuto = false;
      render();
      refresh();
    });
  }

  /* ---------- Toasts ---------- */
  function toast(msg, kind) {
    var box = $('#toasts');
    while (box.firstChild) box.removeChild(box.firstChild);   // une seule notification à la fois
    var d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(function () { d.remove(); }, 3200);
  }

  /* ---------- Libellés de connexion ---------- */
  function mqttConnLabel() {
    if (S.mqttConn === 'online') return 'En ligne';
    if (S.mqttConn === 'offline') return 'Hors ligne';
    if (S.mqttConn === 'unknown') return 'Statut indisponible';
    return 'Vérification…';
  }

  function connLabel() {
    switch (S.conn) {
      case 'online': return 'Connecté' + (S.ms != null ? ' · ' + S.ms + ' ms' : '');
      case 'offline': return 'ESP32 hors ligne';
      case 'unconfigured': return 'Adresse à configurer';
      case 'noserver': return S.lastErr && S.lastErr.code !== 'proxy_down' ? 'Erreur du serveur local' : 'Serveur local arrêté';
      default: return 'Vérification…';
    }
  }

  /* ---------- Vues ---------- */
  function badgeSoon() { return '<span class="badge">À intégrer</span>'; }

  function viewHome() {
    var n = onCount(), known = S.leds[0] !== null, dark = effectiveTheme() === 'dark';
    return '' +
      '<section class="hero" id="hero"><img src="assets/img/maison.jpg" alt="Photo de ma maison" decoding="async">' +
      '<div class="hero-shade"></div>' +
      '<button class="theme-btn" data-act="theme-toggle" aria-label="' + (dark ? 'Passer en mode clair' : 'Passer en mode sombre') + '">' + svg(dark ? 'sun' : 'moon') + '</button>' +
      '<div class="hero-in">' +
      '<p class="eyebrow">Bienvenue chez vous</p><h1>Ma Maison Intelligente</h1>' +
      '<a class="chip ' + S.conn + '" href="#/settings"><i class="dot"></i>' + esc(connLabel()) + '</a></div></section>' +
      ((S.deferredInstall && !S.installed) ? '<section class="card install-row"><span class="ico" style="display:grid;place-items:center;width:42px;height:42px;border-radius:14px;background:var(--brand-soft);color:var(--brand)">' + svg('download') + '</span><div class="t"><b>Installer l’application</b><br><small>Icône sur l’écran d’accueil, plein écran</small></div><button class="btn small" data-act="install">Installer</button></section>' : '') +
      '<h2>Contrôle rapide</h2><div class="tiles">' +
      '<a class="tile lights' + (known && n ? ' on' : '') + '" href="#/lights" style="text-decoration:none;color:inherit"><span class="ico">' + svg('bulb') + '</span><b>Éclairage</b><small>' +
        (known ? n + ' allumée' + (n > 1 ? 's' : '') + ' sur 7' : '7 LED') + '</small></a>' +
      '<a class="tile soon" href="#/sensors" style="text-decoration:none;color:inherit"><span class="ico">' + svg('therm') + '</span><b>Capteurs</b>' + badgeSoon() + '</a>' +
      '<a class="tile soon" href="#/security" style="text-decoration:none;color:inherit"><span class="ico">' + svg('shield') + '</span><b>Sécurité</b>' + badgeSoon() + '</a>' +
      '<a class="tile soon" href="#/security" style="text-decoration:none;color:inherit"><span class="ico">' + svg('camera') + '</span><b>Caméra</b>' + badgeSoon() + '</a></div>' +
      '<h2>Résumé des équipements</h2><div class="card rows">' +
      '<div class="row"><span class="ico">' + svg('bulb') + '</span><div class="t"><b>Éclairage</b><small>7 LED · GPIO ' + ESP.DEFAULT_PINS.join(', ') + '</small></div>' +
        (known ? '<span class="val">' + n + '/7</span>' : '<span class="badge ok">Disponible</span>') + '</div>' +
      '<div class="row"><span class="ico">' + svg('therm') + '</span><div class="t"><b>Capteurs</b><small>DHT22, MQ-2, luminosité, pluie, sol</small></div>' + badgeSoon() + '</div>' +
      '<div class="row"><span class="ico">' + svg('shield') + '</span><div class="t"><b>Sécurité</b><small>PIR, infrarouge, RFID, caméra</small></div>' + badgeSoon() + '</div>' +
      '<div class="row"><span class="ico">' + svg('power') + '</span><div class="t"><b>Actionneurs</b><small>Servomoteurs, relais, mini-pompes</small></div>' + badgeSoon() + '</div>' +
      '<div class="row"><span class="ico">' + svg('wifi') + '</span><div class="t"><b>Connexion ESP32 / MQTT</b><small>État de la liaison avec le broker</small></div><span class="chip ' + (S.mqttConn === 'online' ? 'online' : S.mqttConn === 'offline' ? 'offline' : 'checking') + '"><i class="dot"></i>' + esc(mqttConnLabel()) + '</span></div>' +
      '</div>';
  }

  function ledStateText(i) {
    var k = S.leds[i];
    if (S.busy[i] || S.busyAll) return ['Envoi de la commande…', 'busy'];
    if (!k) return ['État inconnu', ''];
    var txt = k.on ? 'Allumée' : 'Éteinte';
    if (S.conn === 'online') return [txt + ' · confirmée', 'ok'];
    return ['Dernier état connu : ' + txt.toLowerCase(), ''];
  }

  function ledCard(i) {
    var k = S.leds[i], on = !!(k && k.on), busy = S.busy[i] || S.busyAll, st = ledStateText(i), e = S.errs[i];
    return '<article class="card led' + (on ? ' is-on' : '') + '">' +
      '<span class="bulb">' + svg('bulb') + '</span>' +
      '<div><h3>' + esc(ledName(i)) + '<button class="icon-btn" data-act="rename" data-i="' + i + '" aria-label="Renommer ' + esc(ledName(i)) + '">' + svg('pencil') + '</button></h3>' +
      '<p class="sub">LED ' + (i + 1) + ' · GPIO ' + gpioOf(i) + '</p><p class="st ' + st[1] + '">' + esc(st[0]) + '</p></div>' +
      '<button class="switch' + (busy ? ' busy' : '') + '" role="switch" aria-checked="' + on + '" data-act="toggle" data-i="' + i + '"' + (busy ? ' disabled' : '') +
        ' aria-label="' + esc(ledName(i)) + ' : ' + (on ? 'allumée' : 'éteinte') + '"><span></span></button>' +
      (e ? '<div class="err"><span>' + esc(e.msg) + '</span><button data-act="retry" data-i="' + i + '">Réessayer</button></div>' : '') +
      '</article>';
  }

  function viewLights() {
    var n = onCount(), known = S.leds[0] !== null, dis = anyBusy() ? ' disabled' : '';
    var h = '<div class="page-h"><div><h1>Éclairage</h1><p>' + (known ? n + ' allumée' + (n > 1 ? 's' : '') + ' sur 7' : 'État non encore lu') + '</p></div>' +
      '<a class="chip ' + S.conn + '" href="#/settings" style="background:var(--card);box-shadow:var(--shadow)"><i class="dot"></i>' + esc(connLabel()) + '</a></div>' +
      '<div class="bar"><button class="btn" data-act="all-on"' + dis + '>Allumer tout</button><button class="btn ghost" data-act="all-off"' + dis + '>Éteindre tout</button><button class="btn" data-act="mode-auto"' + dis + '>Mode automatique</button></div>';
    if (S.errAll) h += '<div class="result bad" style="margin:0 0 12px">' + esc(S.errAll.msg) + ' <button class="btn small" data-act="retry-all" style="margin-top:8px">Réessayer</button></div>';
    h += '<div class="leds">';
    for (var i = 0; i < 7; i++) h += ledCard(i);
    h += '</div><p class="note">« Confirmée » signifie que l’ESP32 a lui-même renvoyé cet état après la commande. Il ne mesure pas la lumière réellement émise.</p>';
    return h;
  }

  function soonCard(icon, title, hw) {
    return '<div class="card row" style="border-bottom:0"><span class="ico">' + svg(icon) + '</span><div class="t"><b>' + title + '</b><small>' + hw + '</small></div>' +
      '<div style="text-align:right"><span class="val">—</span><br>' + badgeSoon() + '</div></div>';
  }

  function sensorCard(title, source, status, icon) {
    return '<div class="card row" style="border-bottom:0"><span class="ico">' +
      svg(icon || 'flame') + '</span><div class="t"><b>' + esc(title) +
      '</b><small>' + esc(source) + '</small></div><div style="text-align:right"><span class="val">' +
      esc(status) + '</span></div></div>';
  }
  function sensorLabel(value, yes, no) {
    return value === null ? 'En attente MQTT' : (value ? yes : no);
  }
  function viewSensors() {
    var d = S.sensors;
    return '<div class="page-h"><div><h1>Capteurs</h1><p>Valeurs reçues du firmware ESP32 par MQTT</p></div></div><div class="stack">' +
      sensorCard('Fumée / gaz', 'MQ-2 · sortie numérique GPIO25', sensorLabel(d.fumee, 'Détecté', 'Non détecté'), 'flame') +
      sensorCard('Flamme', 'KY-026 · sortie numérique GPIO32', sensorLabel(d.flamme, 'Détectée', 'Non détectée'), 'flame') +
      sensorCard('Luminosité', 'LDR · GPIO34', d.ldr === null ? 'En attente MQTT' : String(d.ldr), 'sun') +
      sensorCard('Présence', 'PIR · GPIO27', sensorLabel(d.presence, 'Présence détectée', 'Aucune présence'), 'motion') +
      '</div><p class="note">Les états proviennent du firmware. La LDR affiche sa valeur brute, pas un pourcentage de luminosité.</p>';
  }

  function viewSecurity() {
    var d = S.sensors;
    var alarm = d.incendie === null ? 'En attente MQTT' :
      (d.incendie ? 'ALARME ACTIVE' : 'Aucune alarme signalée');
    return '<div class="page-h"><div><h1>Sécurité</h1><p>Surveillance reçue par MQTT</p></div>' +
      '<button class="btn ghost" data-act="enable-notifications" title="Activer les notifications et le son" aria-label="Activer les notifications et le son" style="padding:8px 11px;min-width:42px;border-radius:50%;font-size:1.15rem">🔔</button></div><div class="stack">' +
      sensorCard('Alarme incendie', 'MQ-2 ou KY-026', alarm, 'shield') +
      sensorCard('Fumée / gaz', 'MQ-2 · GPIO25', sensorLabel(d.fumee, 'Détecté', 'Non détecté'), 'flame') +
      sensorCard('Flamme', 'KY-026 · GPIO32', sensorLabel(d.flamme, 'Détectée', 'Non détectée'), 'flame') +
      sensorCard('Présence', 'PIR · GPIO27', sensorLabel(d.presence, 'Présence détectée', 'Aucune présence'), 'motion') +
      '</div><p class="note">Prototype expérimental : cette fonction ne remplace pas un détecteur incendie certifié.</p>';
  }

  function instInner() {
    if (S.installed) return '<p><b>✔ Application installée</b> sur cet appareil.</p><p class="note">Lancez-la depuis son icône « Ma Maison » : elle s’ouvre en plein écran.</p>';
    return (S.deferredInstall ? '<button class="btn" data-act="install" style="width:100%;margin-bottom:10px">Installer l’application</button>' : '') +
      '<p class="note" style="margin-top:0">Si le bouton n’apparaît pas :<br>1) ouvrez <b>http://localhost:8000</b> dans Chrome ;<br>2) menu <b>⋮</b> en haut à droite ;<br>3) <b>Installer l’application</b> (ou « Ajouter à l’écran d’accueil »).</p>' +
      '<p class="note">Une icône « Ma Maison » est ajoutée à l’écran d’accueil et l’application s’ouvre en plein écran, comme une application Android (selon l’appareil, Chrome crée une WebAPK ou un raccourci). Le serveur Termux doit tourner pour commander les LED.</p>';
  }

  function devInner() {
    if (profileEmpty()) {
      return avatarHtml('', P) + '<div><b>Informations non renseignées</b><small>Développeur de l’application</small></div>';
    }
    var nom = (P.prenoms + ' ' + P.nom.toUpperCase()).trim();
    return avatarHtml(P.photo, P) + '<div><b>' + esc(nom) + '</b><small>Développeur de Ma Maison Intelligente</small></div>';
  }
  function updateDev() { var d = $('#devsec'); if (d) d.innerHTML = devInner(); }

  function viewSettings() {
    var th = getTheme();
    function seg(v, l) { return '<button data-act="theme-set" data-v="' + v + '" aria-pressed="' + (th === v) + '">' + l + '</button>'; }
    return '<div class="page-h"><div><h1>Réglages</h1><p>Connexion, apparence et informations</p></div></div>' +
      '<section class="card"><h3>Connexion MQTT</h3>' +
      '<p class="note" style="margin-top:6px">État : <b id="connline">' + esc(connLabel()) + '</b></p>' +
      '<label for="host">Adresse IP du téléphone (broker MQTT)</label><div class="grid2"><div><input id="host" inputmode="decimal" autocomplete="off" placeholder="10.91.34.2" aria-label="Adresse IP du broker MQTT"></div>' +
      '<div><input id="port" inputmode="numeric" autocomplete="off" placeholder="1883" aria-label="Port MQTT"></div></div>' +
      '<div class="bar" style="margin:14px 0 0"><button class="btn ghost" data-act="save">Enregistrer</button><button class="btn" data-act="test">Tester la connexion</button></div>' +
      '<p class="note">Le relais local PHP utilise le broker Mosquitto sur 127.0.0.1:1883. Cette adresse IP est celle du téléphone vue par l’ESP32 ; elle doit aussi être configurée dans le firmware. La recherche HTTP automatique n’est pas utilisée en mode MQTT.</p>' +
      '<label for="subnet" style="font-weight:500;color:var(--muted);font-size:.82rem">Réseau à explorer (facultatif, ex. 192.168.43)</label>' +
      '<input id="subnet" inputmode="decimal" autocomplete="off" placeholder="automatique" aria-label="Réseau à explorer">' +
      '<div id="scanres" class="result" hidden></div>' +
      '<div id="testres" class="result" hidden></div>' +
      '<p class="note">L’adresse du téléphone côté hotspot peut changer. Vérifiez-la avec « ifconfig » dans Termux (interface ap0), puis mettez la même adresse dans ce réglage et dans mqtt_server du firmware.</p></section>' +
      '<h2>Apparence</h2><section class="card"><h3>Mode d’affichage</h3><div class="seg" role="group" aria-label="Mode d’affichage">' +
        seg('auto', 'Auto') + seg('light', 'Clair') + seg('dark', 'Sombre') + '</div>' +
      '<p class="note">« Auto » suit le réglage de votre téléphone.</p></section>' +
      '<h2>Installer l’application</h2><section class="card" id="instsec">' + instInner() + '</section>' +
      '<h2>Application</h2><section class="card"><div class="kv"><span>Version</span><span>' + VERSION + '</span></div>' +
      '<div class="kv"><span>Type</span><span>PWA (via Termux)</span></div>' +
      '<div class="kv"><span>Commandes</span><span>HTTP local uniquement</span></div>' +
      '<div class="kv"><span>Fonctions actives</span><span>Éclairage (7 LED)</span></div></section>' +
      '<h2 id="devtap" data-act="dev-tap">Développeur</h2><section class="card dev" id="devsec" data-act="dev-tap">' + devInner() + '</section>';
  }

  var VIEWS = { home: viewHome, lights: viewLights, sensors: viewSensors, security: viewSecurity, history: viewHistory, settings: viewSettings };

  /* ---------- Rendu ---------- */
  function route() { var r = (location.hash.replace(/^#\/?/, '') || 'home'); return VIEWS[r] ? r : 'home'; }
  var lastSig = '';
  function sig() { return JSON.stringify([route(), S.conn, S.mqttConn, S.ms, S.leds.map(function (l) { return l && l.on; }), S.sensors, historyEntries, S.busy, S.busyAll, S.errs, S.errAll, S.names, !!S.deferredInstall, S.installed]); }

  function render() {
    var r = route(), v = $('#view');
    v.innerHTML = VIEWS[r]();
    var hero = $('#hero img');
    if (hero) {
      var fail = function () { $('#hero').classList.add('noimg'); };
      hero.addEventListener('error', fail);
      if (hero.complete && hero.naturalWidth === 0) fail();
    }
    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) {
      var act = a.getAttribute('data-r') === r;
      a.classList.toggle('active', act);
      if (act) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    updateBanner();
    lastSig = sig();
    if (r === 'settings') loadConfigIntoForm();
  }
  // Rendu léger : n'écrase pas la page Réglages (saisie en cours) et évite les rendus inutiles.
  function softRender() {
    var r = route();
    if (r === 'settings') { var cl = $('#connline'); if (cl) cl.textContent = connLabel(); updateBanner(); return; }
    if (sig() !== lastSig) render(); else updateBanner();
  }

  var fireVoiceAudio = null;
  var fireAudioContext = null;
  var fireAlarmInterval = null;
  var fireAlarmOscillator = null;
  var fireAlarmGain = null;

  function playFireVoice() {
    if (S.sensors.incendie !== true) return;
    try {
      if (!fireVoiceAudio) {
        fireVoiceAudio = new Audio('assets/audio/incendie.mp3');
        fireVoiceAudio.loop = true;
        fireVoiceAudio.preload = 'auto';
      }
      var p = fireVoiceAudio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function (e) {
          console.warn('Lecture de la voix bloquée par le navigateur.', e);
        });
      }
    } catch (e) {
      console.warn('Voix d’alerte indisponible.', e);
    }
  }

  function playFireSound() {
    playFireVoice();
    if (fireAlarmInterval !== null) return;

    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;

      if (!fireAudioContext) fireAudioContext = new AC();

      function startAlarm() {
        if (S.sensors.incendie !== true || fireAlarmInterval !== null) return;

        try {
          fireAlarmOscillator = fireAudioContext.createOscillator();
          fireAlarmGain = fireAudioContext.createGain();
          fireAlarmOscillator.type = 'square';
          fireAlarmOscillator.frequency.value = 880;
          fireAlarmGain.gain.value = 0.10;
          fireAlarmOscillator.connect(fireAlarmGain);
          fireAlarmGain.connect(fireAudioContext.destination);
          fireAlarmOscillator.start();

          var high = true;
          fireAlarmInterval = window.setInterval(function () {
            if (S.sensors.incendie !== true) {
              stopFireSound();
              return;
            }
            high = !high;
            try {
              fireAlarmOscillator.frequency.setTargetAtTime(
                high ? 880 : 660, fireAudioContext.currentTime, 0.03
              );
            } catch (e) {}
          }, 450);
        } catch (e) {
          stopFireSound();
        }
      }

      if (fireAudioContext.state === 'suspended') {
        fireAudioContext.resume().then(startAlarm).catch(function () {});
      } else {
        startAlarm();
      }
    } catch (e) {
      console.warn('Son d’alerte indisponible.', e);
    }
  }

  function stopFireSound() {
    if (fireVoiceAudio) {
      fireVoiceAudio.pause();
      fireVoiceAudio.currentTime = 0;
    }
    if (fireAlarmInterval !== null) {
      window.clearInterval(fireAlarmInterval);
      fireAlarmInterval = null;
    }
    try {
      if (fireAlarmOscillator) {
        fireAlarmOscillator.stop();
        fireAlarmOscillator.disconnect();
      }
    } catch (e) {}
    try {
      if (fireAlarmGain) fireAlarmGain.disconnect();
    } catch (e) {}
    fireAlarmOscillator = null;
    fireAlarmGain = null;
  }

  function showFireNotification() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var options = {
      body: 'Le système a signalé une alarme incendie. Vérifiez immédiatement les lieux.',
      tag: 'mmi-incendie',
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 500]
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(function (reg) {
        if (reg.showNotification) return reg.showNotification('ALERTE INCENDIE', options);
        new Notification('ALERTE INCENDIE', options);
      }).catch(function () {
        try { new Notification('ALERTE INCENDIE', options); } catch (e) {}
      });
    } else {
      try { new Notification('ALERTE INCENDIE', options); } catch (e) {}
    }
  }

  function fireAlarmAlert() {
    playFireSound();
    showFireNotification();
  }

  function enableFireNotifications() {
    if (!('Notification' in window)) {
      toast('Notifications non prises en charge par ce navigateur.', 'bad');
      return;
    }
    var enableAudio = function () {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          if (!fireAudioContext) fireAudioContext = new AC();
          if (fireAudioContext.state === 'suspended') fireAudioContext.resume();
        }
      } catch (e) {}
    };
    enableAudio();
    if (S.sensors.incendie === true) playFireSound();
    if (Notification.permission === 'granted') {
      toast('Notifications déjà autorisées. Le son dépend du navigateur.', 'ok');
      return;
    }
    if (Notification.permission === 'denied') {
      toast('Notifications bloquées : autorisez-les dans les réglages Android du navigateur.', 'bad');
      return;
    }
    Notification.requestPermission().then(function (permission) {
      if (permission === 'granted') {
        toast('Notifications autorisées.', 'ok');
        if (S.sensors.incendie === true) showFireNotification();
      } else {
        toast('Autorisation des notifications refusée.', 'bad');
      }
    }).catch(function () {
      toast('Impossible de demander l’autorisation.', 'bad');
    });
  }

  function updateBanner() {
    var b = $('#banner');
    if (!b) return;

    if (S.sensors.incendie === true) {
      b.className = 'fire-alert';
      var stale = S.conn !== 'online';
      b.innerHTML = '<span role="alert">⚠️ ALERTE INCENDIE — ' +
        (stale ? 'dernier état actif ; connexion non actualisée' : 'alarme active, vérifiez les lieux') +
        '</span><a href="#/security">Sécurité</a>';
      b.hidden = false;
      return;
    }

    var r = route();
    if (r === 'settings' || S.conn === 'online' || S.conn === 'checking') {
      b.hidden = true;
      return;
    }
    b.className = S.conn === 'offline' ? '' : 'warn';
    b.innerHTML = '<span>' +
      esc(ESP.explain(S.lastErr || { code: S.conn === 'unconfigured' ? 'not_configured' : 'unreachable' })) +
      '</span><a href="#/settings">Réglages</a>';
    b.hidden = false;
  }


  /* ---------- Réglages : connexion ---------- */
  function loadConfigIntoForm() {
    ESP.getConfig().then(function (c) {
      var h = $('#host'), p = $('#port');
      if (h && !h.value) h.value = c.host || '';
      if (p && !p.value) p.value = c.port || 80;
    }, function (e) { showResult(ESP.explain(e), false); applyError(e); updateBanner(); });
  }
  function showResult(msg, ok) {
    var r = $('#testres'); if (!r) return;
    r.hidden = false; r.className = 'result ' + (ok ? 'ok' : 'bad'); r.textContent = msg;
  }
  function readForm() {
    var host = ($('#host').value || '').trim(), port = parseInt($('#port').value, 10) || 80;
    var m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m || m.slice(1).some(function (x) { return parseInt(x, 10) > 255; })) return { error: ESP.EspError('invalid_ip') };
    if (port < 1 || port > 65535) return { error: ESP.EspError('invalid_port') };
    return { host: host, port: port };
  }
  function saveForm() {
    var f = readForm();
    if (f.error) { showResult(ESP.explain(f.error), false); return Promise.reject(f.error); }
    return ESP.saveConfig(f.host, f.port).then(function (c) { return c; }, function (e) { showResult(ESP.explain(e), false); throw e; });
  }
  function testConnection() {
    var btn = $('[data-act=test]'); btn.disabled = true; btn.textContent = 'Test en cours…';
    S.conn = 'checking'; var cl = $('#connline'); if (cl) cl.textContent = connLabel();
    saveForm().then(function () { return api.status(); }).then(function (st) {
      applyState(st);
      showResult('Connecté ✔ · ' + st.ms + ' ms · 7 LED détectées (GPIO ' + st.leds.map(function (l) { return l.gpio; }).join(', ') + ')', true);
    }, function (e) {
      if (e && e.code && e.code !== 'invalid_ip' && e.code !== 'invalid_port') { applyError(e); showResult(ESP.explain(e), false); }
    }).then(function () { btn.disabled = false; btn.textContent = 'Tester la connexion'; softRender(); });
  }

  /* ---------- Recherche automatique de l'ESP32 ---------- */
  function scanResult(html, kind) {
    var r = $('#scanres'); if (!r) return;
    r.hidden = false; r.className = 'result' + (kind ? ' ' + kind : ''); r.innerHTML = html;
  }
  function useFound(ip, port) {
    $('#host').value = ip; $('#port').value = port;
    scanResult('ESP32 trouvé : <b>' + esc(ip) + '</b>. Enregistrement et test…', 'ok');
    testConnection();
  }
  function scanEsp() {
    if (S.scanning) return;
    S.scanning = true;
    var btn = $('[data-act=scan]'); btn.disabled = true; btn.textContent = 'Recherche en cours…';
    scanResult('Recherche de l’ESP32 sur le réseau du hotspot… (jusqu’à 30 secondes)', '');
    var port = parseInt($('#port').value, 10) || 80, subnet = ($('#subnet').value || '').trim();
    ESP.scan(port, subnet).then(function (d) {
      var nets = (d.subnets || []).join(', ');
      if (!d.found.length) {
        scanResult('Aucun ESP32 trouvé (réseaux explorés : ' + esc(nets || '—') + '). Vérifiez que le hotspot est actif, que l’ESP32 est allumé et connecté, puis réessayez — ou indiquez le réseau à explorer, ou saisissez l’IP à la main.', 'bad');
      } else if (d.found.length === 1) {
        useFound(d.found[0].ip, d.found[0].port);
      } else {
        scanResult(d.found.length + ' appareils compatibles trouvés — choisissez :<div class="found">' + d.found.map(function (f) {
          return '<button class="btn small" data-act="use-ip" data-ip="' + esc(f.ip) + '" data-port="' + esc(f.port) + '">' + esc(f.ip) + ' · ' + esc(f.ms) + ' ms</button>';
        }).join('') + '</div>', 'ok');
      }
    }, function (e) { scanResult(esc(ESP.explain(e)), 'bad'); })
      .then(function () { S.scanning = false; var b = $('[data-act=scan]'); if (b) { b.disabled = false; b.textContent = 'Rechercher l’ESP32 automatiquement'; } });
  }

  /* ---------- Développeur : édition cachée (5 appuis rapides sur « Développeur ») ---------- */
  var devT = { n: 0, t: 0 }, draftPhoto = '';
  function devTap() {
    var now = Date.now();
    if (now - devT.t > 1500) devT.n = 0;
    devT.t = now; devT.n++;
    if (devT.n >= 5) { devT.n = 0; openDevModal(); }
  }
  function devMsg(t) { var m = $('#dv-msg'); if (m) { m.hidden = false; m.textContent = t; } }
  function closeModal() { var m = $('#modal'); if (m) m.remove(); }
  function openDevModal() {
    if ($('#modal')) return;
    draftPhoto = P.photo;
    var m = document.createElement('div');
    m.id = 'modal'; m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="sheet"><h3>Informations du développeur</h3>' +
      '<label for="dv-nom">Nom</label><input id="dv-nom" maxlength="60" autocomplete="off" value="' + esc(P.nom) + '">' +
      '<label for="dv-pre">Prénoms</label><input id="dv-pre" maxlength="80" autocomplete="off" value="' + esc(P.prenoms) + '">' +
      '<label>Photo</label><div class="photo-row"><span id="dv-prev">' + avatarHtml(draftPhoto, P) + '</span>' +
      '<label class="btn ghost small" for="dv-file" style="margin:0">Choisir une photo</label><input id="dv-file" type="file" accept="image/*" hidden>' +
      '<button class="btn ghost small" type="button" data-act="dev-clear-photo">Retirer</button></div>' +
      '<p id="dv-msg" class="note" hidden></p>' +
      '<div class="bar" style="margin:16px 0 0"><button class="btn ghost" data-act="dev-cancel">Annuler</button><button class="btn" data-act="dev-save">Enregistrer</button></div></div>';
    document.body.appendChild(m);
    setTimeout(function () { var i = $('#dv-nom'); if (i) i.focus(); }, 50);
  }
  function processPhoto(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var s = 256, c = document.createElement('canvas'); c.width = c.height = s;
        var ctx = c.getContext('2d'), m = Math.min(img.width, img.height);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s, s);
        ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s);
        draftPhoto = c.toDataURL('image/jpeg', 0.85);
        var pv = $('#dv-prev'); if (pv) pv.innerHTML = avatarHtml(draftPhoto, P);
      };
      img.onerror = function () { devMsg('Image illisible.'); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  function saveDev() {
    var np = normalizeProfile({ nom: ($('#dv-nom').value || '').trim(), prenoms: ($('#dv-pre').value || '').trim(), photo: draftPhoto });
    var btn = $('[data-act=dev-save]'); btn.disabled = true;
    ESP.saveProfile(np).then(function (p) {
      P = normalizeProfile(p); cacheProfile(); closeModal(); updateDev();
      toast('Informations du développeur enregistrées', 'ok');
    }, function (e) {
      if (e.code === 'proxy_down' || e.code === 'proxy_error' || e.code === 'server_error') {
        P = np; cacheProfile(); closeModal(); updateDev();
        toast('Enregistré sur ce téléphone seulement (serveur local injoignable)', 'bad');
      } else { btn.disabled = false; devMsg(ESP.explain(e)); }
    });
  }

  /* ---------- Installation ---------- */
  function doInstall() {
    var d = S.deferredInstall; if (!d) return;
    S.deferredInstall = null;
    d.prompt();
    if (d.userChoice) d.userChoice.then(function (c) { if (c && c.outcome === 'accepted') toast('Installation en cours…', 'ok'); });
    if (route() === 'home') render(); else { var i = $('#instsec'); if (i) i.innerHTML = instInner(); }
  }

  /* ---------- Événements ---------- */
  document.addEventListener('click', function (ev) {
    if (ev.target.id === 'modal') { closeModal(); return; }
    var t = ev.target.closest('[data-act]'); if (!t) return;
    var act = t.getAttribute('data-act'), i = parseInt(t.getAttribute('data-i'), 10);
    if (act === 'toggle') { var k = S.leds[i]; command(i, !(k && k.on)); }
    else if (act === 'retry') { command(i, S.errs[i] ? S.errs[i].want : true); }
    else if (act === 'all-on') commandAll(true);
    else if (act === 'all-off') commandAll(false);
    else if (act === 'mode-auto') commandAuto();
    else if (act === 'history-clear') {
      if (window.confirm('Effacer tous les événements ?')) {
        historyEntries = [];
        // Si l’alarme est toujours active, conserver un événement visible.
        if (S.sensors.incendie === true) {
          historyEntries.unshift({
            time: Date.now(),
            message: 'ALARME INCENDIE TOUJOURS ACTIVE après effacement'
          });
        }
        saveHistory();
        render();
      }
    }
    else if (act === 'enable-notifications') enableFireNotifications();
    else if (act === 'retry-all') commandAll(S.errAll ? S.errAll.want : true);
    else if (act === 'rename') {
      var n = window.prompt('Nom de la LED ' + (i + 1) + ' (vide = nom par défaut)', S.names[i] || ledName(i));
      if (n !== null) { S.names[i] = n.trim().slice(0, 24); saveNames(); render(); }
    }
    else if (act === 'save') { saveForm().then(function (c) { showResult('Adresse enregistrée : ' + c.host + ':' + c.port, true); }, function () {}); }
    else if (act === 'test') testConnection();
    else if (act === 'scan') scanEsp();
    else if (act === 'use-ip') useFound(t.getAttribute('data-ip'), t.getAttribute('data-port'));
    else if (act === 'install') doInstall();
    else if (act === 'theme-set') setTheme(t.getAttribute('data-v'));
    else if (act === 'theme-toggle') setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
    else if (act === 'dev-tap') devTap();
    else if (act === 'dev-cancel') closeModal();
    else if (act === 'dev-save') saveDev();
    else if (act === 'dev-clear-photo') { draftPhoto = ''; var pv = $('#dv-prev'); if (pv) pv.innerHTML = avatarHtml('', P); }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'dv-file') processPhoto(ev.target.files && ev.target.files[0]);
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeModal(); });
  window.addEventListener('hashchange', function () { closeModal(); render(); window.scrollTo(0, 0); refresh(); });
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); S.deferredInstall = e;
    if (route() === 'home') render(); else { var i = $('#instsec'); if (i) i.innerHTML = instInner(); }
  });
  window.addEventListener('appinstalled', function () {
    S.installed = true; S.deferredInstall = null; toast('Application installée ✔', 'ok');
    if (route() === 'home') render(); else { var i = $('#instsec'); if (i) i.innerHTML = instInner(); }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
  setInterval(function () {
    var r = route();
    if (!document.hidden && (r === 'home' || r === 'lights' || r === 'sensors' || r === 'security' || r === 'history')) refresh();
  }, 6000);

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  applyTheme();
  render();
  refresh();
  loadProfileServer();
})();
