<?php
/**
 * router.php — SOLO para el servidor local de PHP en desarrollo.
 *
 *   php -S localhost:8000 -t public_html public_html/router.php
 *
 * En Hostinger no se usa: allí Apache sirve los ficheros y .htaccess enruta /api.
 */

$uri  = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$root = __DIR__;

// Todas las llamadas a /api/... las atiende api/index.php
if (strpos($uri, '/api/') === 0 || $uri === '/api') {
    require $root . '/api/index.php';
    return true;
}

// Fichero estático existente -> que lo sirva el servidor embebido
$file = realpath($root . $uri);
if ($file && is_file($file) && strpos($file, $root) === 0) {
    return false;
}

// Raíz -> login
if ($uri === '/' || $uri === '') {
    require $root . '/index.html';
    return true;
}

// Rutas "bonitas" -> su .html
$maybe = $root . rtrim($uri, '/') . '.html';
if (is_file($maybe)) {
    require $maybe;
    return true;
}

http_response_code(404);
echo 'No encontrado';
return true;
