<?php
// Relais local entre la PWA et l'ESP32 (+ profil développeur + recherche de l'ESP32).
// Pourquoi un relais : le firmware n'envoie pas d'en-têtes CORS, donc le navigateur ne pourrait
// pas lire ses réponses directement. Ce relais (même origine que la PWA) transmet
// uniquement les routes connues du firmware et renvoie le résultat en JSON.
declare(strict_types=1);

// Aucune alerte/avis PHP ne doit polluer la réponse JSON ; les erreurs vont dans la console Termux.
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ob_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const CONFIG_FILE = __DIR__ . '/../data/config.json';
const PROFILE_FILE = __DIR__ . '/../data/profile.json';
// Routes réellement présentes dans le firmware : /, /all/on, /all/off, /toggle/0..6
const ROUTES_OK = '#^/(all/(on|off)|toggle/[0-6]|led/[0-6]/(on|off))?$#';

function out(array $d, int $code = 200): void {
    while (ob_get_level() > 0) ob_end_clean();   // supprime toute sortie parasite
    http_response_code($code);
    echo json_encode($d, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function fail(string $error, string $message, int $code = 200): void {
    out(['ok' => false, 'error' => $error, 'message' => $message], $code);
}

function read_json_file(string $file): array {
    if (!is_file($file)) return [];
    $j = json_decode((string)file_get_contents($file), true);
    return is_array($j) ? $j : [];
}

function write_json_file(string $file, array $data): bool {
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return @file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
}

function load_config(): array {
    $cfg = ['host' => '', 'port' => 1883];
    $j = read_json_file(CONFIG_FILE);
    if (isset($j['host']) && is_string($j['host'])) $cfg['host'] = $j['host'];
    if (isset($j['port'])) $cfg['port'] = (int)$j['port'];
    return $cfg;
}

function clip(string $s, int $n): string {
    $s = preg_replace('/[\x00-\x1F\x7F]/u', '', $s) ?? '';
    $s = trim($s);
    return preg_match('/^.{0,' . $n . '}/us', $s, $m) ? $m[0] : substr($s, 0, $n);
}

function load_profile(): array {
    $j = read_json_file(PROFILE_FILE);
    $photo = isset($j['photo']) && is_string($j['photo']) ? $j['photo'] : '';
    if ($photo !== '' && !preg_match('#^data:image/(jpeg|png|webp);base64,#', $photo)) $photo = '';
    return [
        'nom' => isset($j['nom']) ? clip((string)$j['nom'], 60) : '',
        'prenoms' => isset($j['prenoms']) ? clip((string)$j['prenoms'], 80) : '',
        'photo' => $photo,
    ];
}

// Uniquement une adresse IPv4 privée (réseau local / hotspot) : jamais Internet.
function host_is_private_ipv4(string $h): bool {
    if (!filter_var($h, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) return false;
    return filter_var($h, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE) === false;
}

function http_get(string $host, int $port, string $path, int $timeoutMs = 5000): array {
    $url = 'http://' . $host . ':' . $port . $path;
    $t0 = microtime(true);
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT_MS => min(2500, $timeoutMs),
            CURLOPT_TIMEOUT_MS => $timeoutMs,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP,
        ]);
        $body = curl_exec($ch);
        $errno = curl_errno($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $ms = (int)round((microtime(true) - $t0) * 1000);
        if ($body === false) {
            return ['error' => $errno === 28 ? 'timeout' : 'unreachable', 'ms' => $ms];
        }
        return ['http' => $code, 'ms' => $ms, 'body' => (string)$body];
    }
    // Repli sans extension curl
    $ctx = stream_context_create(['http' => ['timeout' => $timeoutMs / 1000, 'ignore_errors' => true, 'follow_location' => 0]]);
    $body = @file_get_contents($url, false, $ctx);
    $ms = (int)round((microtime(true) - $t0) * 1000);
    if ($body === false) return ['error' => $ms >= $timeoutMs - 500 ? 'timeout' : 'unreachable', 'ms' => $ms];
    $code = 200;
    if (isset($http_response_header[0]) && preg_match('#\s(\d{3})\s#', $http_response_header[0], $m)) $code = (int)$m[1];
    return ['http' => $code, 'ms' => $ms, 'body' => $body];
}

// ---------- Recherche de l'ESP32 sur le réseau local ----------

// Adresses IPv4 vues par le téléphone (interfaces + voisins) : sert à deviner le réseau du hotspot.
function local_ipv4_candidates(): array {
    $ips = [];
    if (function_exists('net_get_interfaces')) {
        $ifs = @net_get_interfaces();
        if (is_array($ifs)) {
            foreach ($ifs as $if) {
                foreach (($if['unicast'] ?? []) as $u) {
                    if (!empty($u['address']) && is_string($u['address'])) $ips[] = $u['address'];
                }
            }
        }
    }
    $texts = [];
    if (function_exists('shell_exec')) {
        foreach (['ifconfig 2>/dev/null', 'ip -o -4 addr 2>/dev/null', 'ip neigh 2>/dev/null'] as $cmd) {
            $o = @shell_exec($cmd);
            if (is_string($o)) $texts[] = $o;
        }
    }
    $arp = @file_get_contents('/proc/net/arp');
    if (is_string($arp)) $texts[] = $arp;
    foreach ($texts as $t) {
        if (preg_match_all('/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/', $t, $m)) {
            foreach ($m[1] as $ip) $ips[] = $ip;
        }
    }
    return array_values(array_unique($ips));
}

// Teste en parallèle quels hôtes acceptent une connexion TCP sur $port (sans curl).
function scan_open_hosts(array $hosts, int $port, float $window = 0.9): array {
    $open = [];
    foreach (array_chunk($hosts, 120) as $chunk) {
        $socks = [];
        foreach ($chunk as $ip) {
            $s = @stream_socket_client("tcp://$ip:$port", $errno, $errstr, 0, STREAM_CLIENT_CONNECT | STREAM_CLIENT_ASYNC_CONNECT);
            if ($s) { stream_set_blocking($s, false); $socks[$ip] = $s; }
        }
        $pending = $socks;
        $deadline = microtime(true) + $window;
        while ($pending && microtime(true) < $deadline) {
            $w = array_values($pending); $r = null; $e = null;
            $left = max(0.0, $deadline - microtime(true));
            $n = @stream_select($r, $w, $e, (int)$left, (int)(($left - (int)$left) * 1000000));
            if ($n === false || $n < 1) break;
            foreach ($w as $s) {
                $ip = array_search($s, $pending, true);
                if ($ip === false) continue;
                if (@stream_socket_get_name($s, true) !== false) $open[] = (string)$ip;   // connecté
                unset($pending[$ip]);                                                    // sinon : refusé
            }
        }
        foreach ($socks as $s) @fclose($s);
    }
    return $open;
}

function prefix_of(string $ip): string {
    return implode('.', array_slice(explode('.', $ip), 0, 3));
}

// ---------- Garde-fous ----------
// MQTT local: l'application parle à PHP sur localhost; PHP relaie par MQTT TCP au broker Termux.
function mqtt_cli(string $cmd): string {
    if (!function_exists('shell_exec')) fail('mqtt_unavailable', 'shell_exec est désactivé dans PHP.');
    $out = @shell_exec($cmd . ' 2>&1');
    return is_string($out) ? trim($out) : '';
}
function mqtt_state(): array {
    $raw = mqtt_cli('mosquitto_sub -h 127.0.0.1 -p 1883 -t maison/etat -C 1 -W 3');
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['leds']) || count($data['leds']) !== 7) {
        fail('mqtt_offline', 'État MQTT indisponible. Vérifiez Mosquitto, puis allumez/redémarrez l’ESP32 MQTT. Détail : ' . substr($raw, 0, 120));
    }
    return $data;
}
function mqtt_publish(string $payload): void {
    $cmd = 'mosquitto_pub -h 127.0.0.1 -p 1883 -q 1 -t maison/commande -m ' . escapeshellarg($payload);
    $out = mqtt_cli($cmd);
    // mosquitto_pub returns no output on success; command existence is checked separately.
    if (strpos($out, 'Error:') !== false || strpos($out, 'not found') !== false) fail('mqtt_publish_failed', 'Publication MQTT impossible : ' . substr($out,0,160));
}
function html_from_state(array $state): string {
    $pins = [2,4,5,18,19,21,22];
    $html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>';
    for ($i=0;$i<7;$i++) {
        $on = !empty($state['leds'][$i]['on']);
        $html .= '<div class="carte"><h3>LED '.($i+1).' - GPIO '.$pins[$i].'</h3><p>Etat : <b>'.($on?'ALLUMEE':'ETEINTE').'</b></p></div>';
    }
    return $html.'</body></html>';
}

set_exception_handler(function (Throwable $e) {
    error_log('esp.php : ' . $e->getMessage() . ' (' . $e->getFile() . ':' . $e->getLine() . ')');
    out(['ok' => false, 'error' => 'server_error', 'message' => 'Erreur PHP : ' . $e->getMessage()], 500);
});

// Seule la PWA servie par ce même serveur peut appeler ce relais.
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('forbidden', 'Méthode non autorisée.', 405);
if (($_SERVER['HTTP_X_MMI'] ?? '') !== '1') fail('forbidden', 'En-tête requis manquant.', 403);
$site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
if ($site !== '' && $site !== 'same-origin' && $site !== 'none') fail('forbidden', 'Origine refusée.', 403);

$req = json_decode((string)file_get_contents('php://input'), true);
if (!is_array($req)) fail('bad_request', 'Requête invalide.', 400);
$action = $req['action'] ?? '';

switch ($action) {
    case 'config_get':
        out(['ok' => true, 'config' => load_config()]);

    case 'config_set':
        $host = trim((string)($req['host'] ?? ''));
        $port = (int)($req['port'] ?? 1883);
        if (!host_is_private_ipv4($host)) {
            fail('invalid_ip', "Adresse invalide. Utilisez une adresse locale, par exemple 192.168.43.25.");
        }
        if ($port < 1 || $port > 65535) fail('invalid_port', 'Port invalide (1 à 65535).');
        if (!write_json_file(CONFIG_FILE, ['host' => $host, 'port' => $port])) {
            fail('write_failed', "Impossible d'enregistrer la configuration (dossier data/).");
        }
        out(['ok' => true, 'config' => ['host' => $host, 'port' => $port]]);

    case 'connection_get':
        $raw = mqtt_cli('/data/data/com.termux/files/usr/bin/mosquitto_sub -h 127.0.0.1 -p 1883 -t maison/connexion -C 1 -W 3');
        $status = trim($raw);
        if ($status !== 'online' && $status !== 'offline') {
            $status = 'unknown';
        }
        out(['ok' => true, 'status' => $status]);

    case 'mode_auto':
        $cfg = load_config();
        if ($cfg['host'] === '') {
            fail('not_configured', "Configurez d'abord le broker MQTT dans Réglages.");
        }
        if (!host_is_private_ipv4($cfg['host'])) {
            fail('invalid_ip', 'Adresse du broker MQTT invalide.');
        }
        mqtt_publish('MODE:AUTO');
        out(['ok' => true, 'message' => 'Commande MODE:AUTO envoyée.']);

    case 'get':
        $path = (string)($req['path'] ?? '');
        if (!preg_match(ROUTES_OK, $path)) fail('forbidden', "Route non autorisée.", 403);
        $cfg = load_config();
        if ($cfg['host'] === '') fail('not_configured', "Configurez l'adresse locale du broker MQTT dans Réglages, puis utilisez la même adresse dans le firmware ESP32.");
        if (!host_is_private_ipv4($cfg['host'])) fail('invalid_ip', 'Adresse enregistrée invalide.');
        $before = microtime(true);
        $is_toggle = false;
        $expected_led = null;
        $expected_on = null;

        if ($path === '/all/on') {
            mqtt_publish('ALL:ON');
        } elseif ($path === '/all/off') {
            mqtt_publish('ALL:OFF');
        } elseif (preg_match('#^/led/([0-6])/(on|off)$#', $path, $m)) {
            $expected_led = (int)$m[1];
            $expected_on = ($m[2] === 'on');
            mqtt_publish('LED:'.$expected_led.':'.($expected_on ? 'ON' : 'OFF'));
        } elseif (preg_match('#^/toggle/([0-6])$#', $path, $m)) {
            $state = mqtt_state();
            $i = (int)$m[1];
            $want = empty($state['leds'][$i]['on']) ? 'ON' : 'OFF';
            mqtt_publish('LED:'.$i.':'.$want);
            $state['leds'][$i]['on'] = ($want === 'ON');
            $is_toggle = true;
        }

        if (!$is_toggle) {
            if ($path !== '' && $path !== '/') usleep(150000);
            $state = mqtt_state();
        }

        if ($expected_led !== null &&
            !isset($state['leds'][$expected_led]['on'])) {
            fail('mqtt_state_invalid', 'Etat MQTT incomplet.');
        }
        if ($expected_led !== null &&
            (bool)$state['leds'][$expected_led]['on'] !== $expected_on) {
            fail('mismatch', 'La commande a ete envoyee, mais le nouvel etat MQTT n’est pas encore confirme.');
        }
        out(['ok' => true, 'http' => 200, 'ms' => (int)round((microtime(true)-$before)*1000), 'body' => html_from_state($state), 'state' => $state]);

    case 'profile_get':
        out(['ok' => true, 'profile' => load_profile()]);

    case 'profile_set':
        $nom = clip((string)($req['nom'] ?? ''), 60);
        $pre = clip((string)($req['prenoms'] ?? ''), 80);
        $photo = (string)($req['photo'] ?? '');
        if ($photo !== '') {
            if (strlen($photo) > 400000) fail('invalid_photo', 'Photo trop lourde (max. 400 Ko).');
            if (!preg_match('#^data:image/(jpeg|png|webp);base64,#', $photo, $pm)) fail('invalid_photo', 'Format de photo non pris en charge.');
            if (base64_decode(substr($photo, strlen($pm[0])), true) === false) fail('invalid_photo', 'Photo illisible.');
        }
        $p = ['nom' => $nom, 'prenoms' => $pre, 'photo' => $photo];
        if (!write_json_file(PROFILE_FILE, $p)) fail('write_failed', "Impossible d'enregistrer (dossier data/).");
        out(['ok' => true, 'profile' => $p]);

    case 'scan':
        @set_time_limit(90);
        $cfg = load_config();
        $port = (int)($req['port'] ?? 0);
        if ($port < 1 || $port > 65535) $port = $cfg['port'] ?: 80;
        $prefixes = [];
        $add = function (string $ip) use (&$prefixes): void {
            if (!host_is_private_ipv4($ip) || strpos($ip, '127.') === 0) return;
            $p = prefix_of($ip);
            if (!in_array($p, $prefixes, true)) $prefixes[] = $p;
        };
        $manual = trim((string)($req['subnet'] ?? ''));
        if ($manual !== '') {
            // « 192.168.43 », « 192.168.43.1 » ou « 192.168.43.0/24 » -> réseau /24
            $m = preg_replace('#/\d+$#', '', $manual) ?? '';
            if (preg_match('/^\d{1,3}\.\d{1,3}\.\d{1,3}$/', $m)) $m .= '.1';
            if (!host_is_private_ipv4($m)) fail('invalid_ip', 'Réseau invalide. Exemple : 192.168.43');
            $add($m);
        } else {
            if ($cfg['host'] !== '') $add($cfg['host']);
            foreach (local_ipv4_candidates() as $ip) $add($ip);
            $add('192.168.43.1');
        }
        $prefixes = array_slice($prefixes, 0, 6);
        $found = [];
        $scanned = 0;
        foreach ($prefixes as $pre) {
            $hosts = [];
            for ($i = 1; $i <= 254; $i++) $hosts[] = $pre . '.' . $i;
            $scanned += count($hosts);
            foreach (scan_open_hosts($hosts, $port) as $ip) {
                $r = http_get($ip, $port, '/', 2500);
                if (isset($r['body']) && preg_match('/LED\s+1\s*-\s*GPIO\s*\d+/i', $r['body'])) {
                    $found[] = ['ip' => $ip, 'port' => $port, 'ms' => $r['ms']];
                }
            }
        }
        out(['ok' => true, 'found' => $found, 'scanned' => $scanned,
             'subnets' => array_map(function ($p) { return $p . '.0/24'; }, $prefixes)]);

    default:
        fail('bad_request', 'Action inconnue.', 400);
}
