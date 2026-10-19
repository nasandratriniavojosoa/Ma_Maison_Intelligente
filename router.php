<?php
// Routeur du serveur PHP intégré : bloque l'accès web aux fichiers internes.
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (preg_match('#^/(data|tests)(/|$)#', $path) || preg_match('#\.(sh|md|log|bak)$#i', $path) || $path === '/router.php') {
    http_response_code(404);
    echo 'Not found';
    return true;
}
return false; // sert le fichier demandé / exécute le .php demandé
