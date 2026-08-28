<?php
/**
 * db.php — Almacén de datos en un único fichero JSON.
 *
 * ⚠️ IMPORTANTE: la base de datos vive FUERA de public_html, en ../../data_store/,
 * para que una republicación de la web (que reemplaza public_html entero) NO
 * borre el inventario ni las cuentas. Se crea sola la primera vez.
 */

declare(strict_types=1);

/** Ruta al fichero de datos, siempre fuera de la carpeta web. */
function db_path(): string
{
    // Desde public_html/api/ subimos dos niveles hasta la raíz del proyecto/dominio.
    $fuera = dirname(__DIR__, 2) . '/data_store';
    if (is_dir($fuera) || @mkdir($fuera, 0770, true)) {
        if (is_writable($fuera)) {
            return $fuera . '/db.json';
        }
    }
    // Último recurso (protegido por .htaccess). No debería llegar aquí en Hostinger.
    $fallback = __DIR__ . '/_datos';
    if (!is_dir($fallback)) {
        @mkdir($fallback, 0770, true);
    }
    return $fallback . '/db.json';
}

/** Estructura inicial vacía. */
function db_default(): array
{
    return [
        'version'     => 1,
        'users'       => [],
        'employees'   => [],
        'assets'      => [],
        'assignments' => [],
        'settings'    => ['stale_days' => 30],
        'seq'         => ['asset' => 0, 'employee' => 0, 'assignment' => 0, 'user' => 0],
    ];
}

/**
 * Lee la base de datos completa. Crea el fichero y el admin inicial si no existen.
 * Devuelve [datos, credencialesIniciales|null].
 */
function db_load(): array
{
    $path = db_path();
    $seededPassword = null;

    if (!is_file($path)) {
        $data = db_default();
        // Admin inicial: usuario "admin" + contraseña aleatoria fuerte.
        $seededPassword = db_random_password();
        $data['seq']['user'] = 1;
        $data['users'][] = [
            'id'         => 'u1',
            'username'   => 'admin',
            'name'       => 'Administrador',
            'pass_hash'  => password_hash($seededPassword, PASSWORD_DEFAULT),
            'created_at' => db_now(),
        ];
        db_save($data);
        // Guarda la contraseña inicial en un txt fuera de la web, por si se pierde.
        @file_put_contents(
            dirname($path) . '/CONTRASENA_INICIAL_ADMIN.txt',
            "Usuario: admin\nContraseña: {$seededPassword}\n\n" .
            "Cámbiala desde la app (menú de tu nombre → Cambiar contraseña) y borra este fichero.\n"
        );
        return [$data, ['username' => 'admin', 'password' => $seededPassword]];
    }

    $raw = file_get_contents($path);
    $data = json_decode($raw ?: '[]', true);
    if (!is_array($data)) {
        throw new RuntimeException('La base de datos está dañada.');
    }
    // Rellena claves que pudieran faltar (compatibilidad hacia adelante).
    $data += db_default();
    $data['settings'] += db_default()['settings'];
    $data['seq'] += db_default()['seq'];

    return [$data, null];
}

/** Escribe la base de datos completa de forma atómica y con bloqueo. */
function db_save(array $data): void
{
    $path = db_path();
    $tmp  = $path . '.tmp';
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        throw new RuntimeException('No se pudo guardar la base de datos.');
    }
    $fh = fopen($tmp, 'wb');
    if (!$fh) {
        throw new RuntimeException('No se pudo abrir el fichero de datos para escritura.');
    }
    flock($fh, LOCK_EX);
    fwrite($fh, $json);
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException('No se pudo confirmar el guardado de la base de datos.');
    }
}

/**
 * Ejecuta $fn con la base de datos cargada y bloqueada, y guarda el resultado.
 * $fn recibe &$data por referencia y devuelve el valor de respuesta.
 */
function db_transaction(callable $fn)
{
    $path = db_path();
    // Asegura que el fichero existe (y crea admin inicial si toca).
    [$data] = db_load();

    $lockFile = $path . '.lock';
    $lock = fopen($lockFile, 'c');
    if ($lock) {
        flock($lock, LOCK_EX);
    }
    try {
        // Recarga dentro del lock por si otro proceso escribió entretanto.
        $raw = file_get_contents($path);
        $data = json_decode($raw ?: '[]', true) ?: db_default();
        $data += db_default();
        $data['settings'] += db_default()['settings'];
        $data['seq'] += db_default()['seq'];

        $result = $fn($data);
        db_save($data);
        return $result;
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}

function db_now(): string
{
    return date('c');
}

function db_next_id(array &$data, string $kind): string
{
    $data['seq'][$kind] = ($data['seq'][$kind] ?? 0) + 1;
    $prefix = ['asset' => 'a', 'employee' => 'e', 'assignment' => 'as', 'user' => 'u'][$kind] ?? 'x';
    return $prefix . $data['seq'][$kind];
}

function db_random_password(int $len = 14): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    $out = '';
    for ($i = 0; $i < $len; $i++) {
        $out .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    }
    return $out;
}
