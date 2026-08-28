<?php
/**
 * index.php — Toda la API del inventario en un único fichero.
 *
 * Autenticación por cookie de sesión. Sin IA, sin pagos, sin roles:
 * solo administradores que gestionan el inventario interno.
 */

declare(strict_types=1);

require __DIR__ . '/db.php';

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_name('STOCKLYSID');
session_start();

// ---------------------------------------------------------------------------
// Utilidades de respuesta
// ---------------------------------------------------------------------------
function respond($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(string $message, int $code = 400): void
{
    respond(['error' => $message], $code);
}

function body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return [];
    }
    $parsed = json_decode($raw, true);
    return is_array($parsed) ? $parsed : [];
}

function require_session(): array
{
    if (empty($_SESSION['uid'])) {
        fail('Tu sesión ha caducado. Vuelve a iniciar sesión.', 401);
    }
    return ['id' => $_SESSION['uid'], 'username' => $_SESSION['uname'] ?? '', 'name' => $_SESSION['uname_display'] ?? ''];
}

function clean_str($v, int $max = 500): string
{
    $s = trim((string)($v ?? ''));
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $s) ?? '';
    if (mb_strlen($s) > $max) {
        $s = mb_substr($s, 0, $max);
    }
    return $s;
}

/** Tipos y estados admitidos. */
const ASSET_TYPES  = ['celular', 'portatil', 'monitor', 'tablet', 'impresora', 'mobiliario', 'perifericos', 'otro'];
const ASSET_STATES = ['disponible', 'asignado', 'reparacion', 'baja'];

// ---------------------------------------------------------------------------
// Enrutado
// ---------------------------------------------------------------------------
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Ruta relativa dentro de /api  (soporta despliegue en subcarpeta).
$uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$uri  = rawurldecode($uri);
$pos  = strpos($uri, '/api/');
$path = $pos !== false ? substr($uri, $pos + 5) : ltrim($uri, '/');
$path = trim($path, '/');
$seg  = $path === '' ? [] : explode('/', $path);

try {
    route($method, $seg);
    fail('Ruta no encontrada.', 404);
} catch (Throwable $e) {
    error_log('[stockly] ' . $e->getMessage());
    fail('Ha ocurrido un error en el servidor. Inténtalo de nuevo.', 500);
}

// ---------------------------------------------------------------------------
function route(string $method, array $seg)
{
    $r = $seg[0] ?? '';

    // ---- Sesión --------------------------------------------------------
    if ($r === 'login' && $method === 'POST') {
        return handle_login();
    }
    if ($r === 'logout' && $method === 'POST') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', $p['secure'] ?? false, $p['httponly'] ?? true);
        }
        session_destroy();
        respond(['ok' => true]);
    }
    if ($r === 'me' && $method === 'GET') {
        if (empty($_SESSION['uid'])) {
            respond(['user' => null]);
        }
        respond(['user' => ['id' => $_SESSION['uid'], 'username' => $_SESSION['uname'], 'name' => $_SESSION['uname_display']]]);
    }

    // ---- A partir de aquí, todo requiere sesión -----------------------
    if ($r === 'bootstrap' && $method === 'GET') {
        return handle_bootstrap();
    }
    if ($r === 'password' && $method === 'POST') {
        return handle_change_password();
    }
    if ($r === 'admins') {
        if ($method === 'GET')  return handle_admins_list();
        if ($method === 'POST') return handle_admins_create();
    }
    if ($r === 'admins' && $method === 'DELETE' && isset($seg[1])) {
        return handle_admins_delete($seg[1]);
    }
    if ($r === 'settings' && $method === 'POST') {
        return handle_settings();
    }
    if ($r === 'export' && ($seg[1] ?? '') === 'csv' && $method === 'GET') {
        return handle_export_csv();
    }

    // ---- Activos -----------------------------------------------------
    if ($r === 'assets') {
        if ($method === 'POST' && !isset($seg[1])) return handle_asset_create();
        if (isset($seg[1])) {
            $id  = $seg[1];
            $sub = $seg[2] ?? '';
            if ($method === 'PUT' && $sub === '')          return handle_asset_update($id);
            if ($method === 'POST' && $sub === 'retire')    return handle_asset_retire($id);
            if ($method === 'POST' && $sub === 'reactivate')return handle_asset_reactivate($id);
        }
    }

    // ---- Empleados --------------------------------------------------
    if ($r === 'employees') {
        if ($method === 'POST' && !isset($seg[1])) return handle_employee_create();
        if (isset($seg[1]) && $method === 'PUT')   return handle_employee_update($seg[1]);
        if (isset($seg[1]) && $method === 'DELETE')return handle_employee_delete($seg[1]);
    }

    // ---- Asignaciones ---------------------------------------------
    if ($r === 'assign' && $method === 'POST') {
        return handle_assign();
    }
    if ($r === 'unassign' && $method === 'POST') {
        return handle_unassign();
    }
}

// ===========================================================================
// Sesión
// ===========================================================================
function handle_login(): void
{
    $b = body();
    $username = clean_str($b['username'] ?? '', 60);
    $password = (string)($b['password'] ?? '');
    if ($username === '' || $password === '') {
        fail('Escribe usuario y contraseña.', 422);
    }

    [$data] = db_load();
    $user = null;
    foreach ($data['users'] as $u) {
        if (strcasecmp($u['username'], $username) === 0) {
            $user = $u;
            break;
        }
    }
    // Comparación en tiempo ~constante aunque el usuario no exista.
    $hash = $user['pass_hash'] ?? '$2y$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    if (!password_verify($password, $hash) || $user === null) {
        fail('Usuario o contraseña incorrectos.', 401);
    }

    session_regenerate_id(true);
    $_SESSION['uid']           = $user['id'];
    $_SESSION['uname']         = $user['username'];
    $_SESSION['uname_display'] = $user['name'] ?? $user['username'];

    respond(['ok' => true, 'user' => [
        'id' => $user['id'], 'username' => $user['username'], 'name' => $user['name'] ?? $user['username'],
    ]]);
}

function handle_change_password(): void
{
    $me = require_session();
    $b  = body();
    $current = (string)($b['current'] ?? '');
    $next    = (string)($b['next'] ?? '');
    if (mb_strlen($next) < 8) {
        fail('La contraseña nueva debe tener al menos 8 caracteres.', 422);
    }
    db_transaction(function (array &$data) use ($me, $current, $next) {
        foreach ($data['users'] as &$u) {
            if ($u['id'] === $me['id']) {
                if (!password_verify($current, $u['pass_hash'])) {
                    fail('La contraseña actual no es correcta.', 401);
                }
                $u['pass_hash'] = password_hash($next, PASSWORD_DEFAULT);
                return;
            }
        }
        fail('Usuario no encontrado.', 404);
    });
    respond(['ok' => true]);
}

// ===========================================================================
// Administradores del sistema (opcional: "el o los administradores")
// ===========================================================================
function handle_admins_list(): void
{
    require_session();
    [$data] = db_load();
    $out = array_map(fn($u) => [
        'id' => $u['id'], 'username' => $u['username'], 'name' => $u['name'] ?? $u['username'], 'created_at' => $u['created_at'] ?? null,
    ], $data['users']);
    respond(['admins' => $out]);
}

function handle_admins_create(): void
{
    require_session();
    $b = body();
    $username = clean_str($b['username'] ?? '', 60);
    $name     = clean_str($b['name'] ?? '', 120);
    $password = (string)($b['password'] ?? '');
    if (!preg_match('/^[A-Za-z0-9._-]{3,60}$/', $username)) {
        fail('El usuario solo puede tener letras, números, punto, guion y guion bajo (3–60).', 422);
    }
    if (mb_strlen($password) < 8) {
        fail('La contraseña debe tener al menos 8 caracteres.', 422);
    }
    $created = db_transaction(function (array &$data) use ($username, $name, $password) {
        foreach ($data['users'] as $u) {
            if (strcasecmp($u['username'], $username) === 0) {
                fail('Ya existe un administrador con ese usuario.', 409);
            }
        }
        $id = db_next_id($data, 'user');
        $row = [
            'id' => $id, 'username' => $username, 'name' => $name !== '' ? $name : $username,
            'pass_hash' => password_hash($password, PASSWORD_DEFAULT), 'created_at' => db_now(),
        ];
        $data['users'][] = $row;
        return ['id' => $id, 'username' => $username, 'name' => $row['name'], 'created_at' => $row['created_at']];
    });
    respond(['ok' => true, 'admin' => $created], 201);
}

function handle_admins_delete(string $id): void
{
    $me = require_session();
    if ($id === $me['id']) {
        fail('No puedes eliminar tu propia cuenta mientras la usas.', 409);
    }
    db_transaction(function (array &$data) use ($id) {
        $before = count($data['users']);
        $data['users'] = array_values(array_filter($data['users'], fn($u) => $u['id'] !== $id));
        if (count($data['users']) === $before) {
            fail('Administrador no encontrado.', 404);
        }
        if (count($data['users']) === 0) {
            fail('Debe quedar al menos un administrador.', 409);
        }
    });
    respond(['ok' => true]);
}

// ===========================================================================
// Ajustes
// ===========================================================================
function handle_settings(): void
{
    require_session();
    $b = body();
    $days = (int)($b['stale_days'] ?? 30);
    $days = max(1, min(365, $days));
    db_transaction(function (array &$data) use ($days) {
        $data['settings']['stale_days'] = $days;
    });
    respond(['ok' => true, 'settings' => ['stale_days' => $days]]);
}

// ===========================================================================
// Bootstrap: todo lo que la app necesita en una sola llamada
// ===========================================================================
function handle_bootstrap(): void
{
    require_session();
    [$data] = db_load();
    respond([
        'user'        => ['id' => $_SESSION['uid'], 'username' => $_SESSION['uname'], 'name' => $_SESSION['uname_display']],
        'assets'      => array_values($data['assets']),
        'employees'   => array_values($data['employees']),
        'assignments' => array_values($data['assignments']),
        'settings'    => $data['settings'],
        'meta'        => ['types' => ASSET_TYPES, 'states' => ASSET_STATES, 'server_time' => db_now()],
    ]);
}

// ===========================================================================
// Activos
// ===========================================================================
function asset_payload(array $b): array
{
    $type = clean_str($b['type'] ?? '', 30);
    if (!in_array($type, ASSET_TYPES, true)) {
        $type = 'otro';
    }
    return [
        'type'          => $type,
        'brand'         => clean_str($b['brand'] ?? '', 80),
        'model'         => clean_str($b['model'] ?? '', 120),
        'serial'        => clean_str($b['serial'] ?? '', 120),
        'tag'           => clean_str($b['tag'] ?? '', 60),
        'purchase_date' => clean_date($b['purchase_date'] ?? ''),
        'notes'         => clean_str($b['notes'] ?? '', 2000),
    ];
}

function clean_date($v): string
{
    $s = trim((string)$v);
    return preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) ? $s : '';
}

function handle_asset_create(): void
{
    require_session();
    $b = body();
    $p = asset_payload($b);
    if ($p['brand'] === '' && $p['model'] === '' && $p['serial'] === '') {
        fail('Indica al menos la marca, el modelo o el número de serie.', 422);
    }
    $wantState = clean_str($b['status'] ?? 'disponible', 20);
    if (!in_array($wantState, ['disponible', 'reparacion'], true)) {
        $wantState = 'disponible';
    }
    $asset = db_transaction(function (array &$data) use ($p, $wantState) {
        if ($p['serial'] !== '') {
            foreach ($data['assets'] as $a) {
                if ($a['serial'] !== '' && strcasecmp($a['serial'], $p['serial']) === 0) {
                    fail('Ya hay un activo con ese número de serie.', 409);
                }
            }
        }
        $id = db_next_id($data, 'asset');
        $row = $p + [
            'id'             => $id,
            'status'         => $wantState,
            'assigned_to'    => null,
            'assigned_since' => null,
            'created_at'     => db_now(),
            'updated_at'     => db_now(),
        ];
        $data['assets'][] = $row;
        return $row;
    });
    respond(['ok' => true, 'asset' => $asset], 201);
}

function &find_ref(array &$list, string $id)
{
    foreach ($list as $k => &$row) {
        if ($row['id'] === $id) {
            return $row;
        }
    }
    $null = null;
    return $null;
}

function handle_asset_update(string $id): void
{
    require_session();
    $b = body();
    $p = asset_payload($b);
    $newStatus = clean_str($b['status'] ?? '', 20);

    $asset = db_transaction(function (array &$data) use ($id, $p, $newStatus) {
        $a = &find_ref($data['assets'], $id);
        if ($a === null) {
            fail('Activo no encontrado.', 404);
        }
        if ($p['serial'] !== '') {
            foreach ($data['assets'] as $other) {
                if ($other['id'] !== $id && $other['serial'] !== '' && strcasecmp($other['serial'], $p['serial']) === 0) {
                    fail('Ya hay otro activo con ese número de serie.', 409);
                }
            }
        }
        $a['type']          = $p['type'];
        $a['brand']         = $p['brand'];
        $a['model']         = $p['model'];
        $a['serial']        = $p['serial'];
        $a['tag']           = $p['tag'];
        $a['purchase_date'] = $p['purchase_date'];
        $a['notes']         = $p['notes'];

        // Cambio de estado permitido solo entre disponible <-> reparacion.
        // asignado y baja se gestionan con sus acciones propias.
        if (in_array($newStatus, ['disponible', 'reparacion'], true) && $a['status'] !== 'asignado' && $a['status'] !== 'baja') {
            $a['status'] = $newStatus;
        }
        $a['updated_at'] = db_now();
        return $a;
    });
    respond(['ok' => true, 'asset' => $asset]);
}

function handle_asset_retire(string $id): void
{
    require_session();
    $note = clean_str(body()['notes'] ?? '', 500);
    $res = db_transaction(function (array &$data) use ($id, $note) {
        $a = &find_ref($data['assets'], $id);
        if ($a === null) {
            fail('Activo no encontrado.', 404);
        }
        // Si estaba asignado, cerramos la asignación abierta.
        if ($a['assigned_to'] !== null) {
            foreach ($data['assignments'] as &$as) {
                if ($as['asset_id'] === $id && $as['returned_date'] === null) {
                    $as['returned_date'] = date('Y-m-d');
                    $as['return_notes']  = $note !== '' ? $note : 'Baja del activo';
                }
            }
            unset($as);
        }
        $a['status']         = 'baja';
        $a['assigned_to']    = null;
        $a['assigned_since'] = null;
        $a['notes']          = $note !== '' ? trim($a['notes'] . "\n[Baja] " . $note) : $a['notes'];
        $a['updated_at']     = db_now();
        return $a;
    });
    respond(['ok' => true, 'asset' => $res]);
}

function handle_asset_reactivate(string $id): void
{
    require_session();
    $res = db_transaction(function (array &$data) use ($id) {
        $a = &find_ref($data['assets'], $id);
        if ($a === null) {
            fail('Activo no encontrado.', 404);
        }
        if ($a['status'] !== 'baja') {
            fail('El activo no está dado de baja.', 409);
        }
        $a['status']     = 'disponible';
        $a['updated_at'] = db_now();
        return $a;
    });
    respond(['ok' => true, 'asset' => $res]);
}

// ===========================================================================
// Empleados
// ===========================================================================
function employee_payload(array $b): array
{
    return [
        'name'  => clean_str($b['name'] ?? '', 120),
        'area'  => clean_str($b['area'] ?? '', 100),
        'email' => clean_str($b['email'] ?? '', 160),
    ];
}

function handle_employee_create(): void
{
    require_session();
    $p = employee_payload(body());
    if ($p['name'] === '') {
        fail('El empleado necesita al menos un nombre.', 422);
    }
    if ($p['email'] !== '' && !filter_var($p['email'], FILTER_VALIDATE_EMAIL)) {
        fail('El correo no tiene un formato válido.', 422);
    }
    $emp = db_transaction(function (array &$data) use ($p) {
        $id = db_next_id($data, 'employee');
        $row = $p + ['id' => $id, 'active' => true, 'created_at' => db_now(), 'updated_at' => db_now()];
        $data['employees'][] = $row;
        return $row;
    });
    respond(['ok' => true, 'employee' => $emp], 201);
}

function handle_employee_update(string $id): void
{
    require_session();
    $p = employee_payload(body());
    if ($p['name'] === '') {
        fail('El empleado necesita al menos un nombre.', 422);
    }
    if ($p['email'] !== '' && !filter_var($p['email'], FILTER_VALIDATE_EMAIL)) {
        fail('El correo no tiene un formato válido.', 422);
    }
    $emp = db_transaction(function (array &$data) use ($id, $p) {
        $e = &find_ref($data['employees'], $id);
        if ($e === null) {
            fail('Empleado no encontrado.', 404);
        }
        $e['name']       = $p['name'];
        $e['area']       = $p['area'];
        $e['email']      = $p['email'];
        $e['updated_at'] = db_now();
        return $e;
    });
    respond(['ok' => true, 'employee' => $emp]);
}

function handle_employee_delete(string $id): void
{
    require_session();
    db_transaction(function (array &$data) use ($id) {
        foreach ($data['assets'] as $a) {
            if ($a['assigned_to'] === $id) {
                fail('Este empleado tiene activos asignados. Desasígnalos antes de eliminarlo.', 409);
            }
        }
        $before = count($data['employees']);
        $data['employees'] = array_values(array_filter($data['employees'], fn($e) => $e['id'] !== $id));
        if (count($data['employees']) === $before) {
            fail('Empleado no encontrado.', 404);
        }
    });
    respond(['ok' => true]);
}

// ===========================================================================
// Asignaciones
// ===========================================================================
function handle_assign(): void
{
    require_session();
    $b        = body();
    $assetId  = clean_str($b['asset_id'] ?? '', 40);
    $empId    = clean_str($b['employee_id'] ?? '', 40);
    $date     = clean_date($b['date'] ?? '') ?: date('Y-m-d');
    $notes    = clean_str($b['notes'] ?? '', 1000);

    $res = db_transaction(function (array &$data) use ($assetId, $empId, $date, $notes) {
        $a = &find_ref($data['assets'], $assetId);
        if ($a === null) {
            fail('Activo no encontrado.', 404);
        }
        $e = &find_ref($data['employees'], $empId);
        if ($e === null) {
            fail('Empleado no encontrado.', 404);
        }
        if ($a['status'] === 'baja') {
            fail('No puedes asignar un activo dado de baja.', 409);
        }
        if ($a['assigned_to'] !== null) {
            fail('Ese activo ya está asignado. Desasígnalo primero.', 409);
        }

        $asId = db_next_id($data, 'assignment');
        $data['assignments'][] = [
            'id'            => $asId,
            'asset_id'      => $assetId,
            'employee_id'   => $empId,
            'assigned_date' => $date,
            'returned_date' => null,
            'assign_notes'  => $notes,
            'return_notes'  => '',
            'created_at'    => db_now(),
        ];
        $a['status']         = 'asignado';
        $a['assigned_to']    = $empId;
        $a['assigned_since'] = $date;
        $a['updated_at']     = db_now();
        return ['assignment_id' => $asId, 'asset' => $a];
    });
    respond(['ok' => true] + $res, 201);
}

function handle_unassign(): void
{
    require_session();
    $b       = body();
    $assetId = clean_str($b['asset_id'] ?? '', 40);
    $date    = clean_date($b['date'] ?? '') ?: date('Y-m-d');
    $notes   = clean_str($b['notes'] ?? '', 1000);
    $toState = clean_str($b['to_state'] ?? 'disponible', 20);
    if (!in_array($toState, ['disponible', 'reparacion'], true)) {
        $toState = 'disponible';
    }

    $res = db_transaction(function (array &$data) use ($assetId, $date, $notes, $toState) {
        $a = &find_ref($data['assets'], $assetId);
        if ($a === null) {
            fail('Activo no encontrado.', 404);
        }
        if ($a['assigned_to'] === null) {
            fail('Ese activo no está asignado a nadie.', 409);
        }
        $closed = false;
        foreach ($data['assignments'] as &$as) {
            if ($as['asset_id'] === $assetId && $as['returned_date'] === null) {
                $as['returned_date'] = $date;
                $as['return_notes']  = $notes;
                $closed = true;
            }
        }
        unset($as);
        if (!$closed) {
            // Coherencia: no había asignación abierta pese al puntero. La creamos cerrada.
            $asId = db_next_id($data, 'assignment');
            $data['assignments'][] = [
                'id' => $asId, 'asset_id' => $assetId, 'employee_id' => $a['assigned_to'],
                'assigned_date' => $a['assigned_since'] ?: $date, 'returned_date' => $date,
                'assign_notes' => '', 'return_notes' => $notes, 'created_at' => db_now(),
            ];
        }
        $a['status']         = $toState;
        $a['assigned_to']    = null;
        $a['assigned_since'] = null;
        $a['updated_at']     = db_now();
        return ['asset' => $a];
    });
    respond(['ok' => true] + $res);
}

// ===========================================================================
// Exportación CSV (todo el inventario)
// ===========================================================================
function handle_export_csv(): void
{
    require_session();
    [$data] = db_load();

    $empById = [];
    foreach ($data['employees'] as $e) {
        $empById[$e['id']] = $e;
    }

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="stockly-' . date('Y-m-d') . '.csv"');
    header('Cache-Control: no-store');

    $out = fopen('php://output', 'w');
    // BOM para que Excel abra los acentos bien.
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, [
        'ID', 'Codigo', 'Tipo', 'Marca', 'Modelo', 'Numero de serie', 'Fecha de compra',
        'Estado', 'Asignado a', 'Area', 'Correo', 'Asignado desde', 'Notas',
    ], ';');

    $labels = [
        'disponible' => 'Disponible', 'asignado' => 'Asignado',
        'reparacion' => 'En reparacion', 'baja' => 'Dado de baja',
    ];
    foreach ($data['assets'] as $a) {
        $emp = $a['assigned_to'] !== null ? ($empById[$a['assigned_to']] ?? null) : null;
        fputcsv($out, [
            $a['id'],
            $a['tag'] ?? '',
            $a['type'],
            $a['brand'],
            $a['model'],
            $a['serial'],
            $a['purchase_date'],
            $labels[$a['status']] ?? $a['status'],
            $emp['name'] ?? '',
            $emp['area'] ?? '',
            $emp['email'] ?? '',
            $a['assigned_since'] ?? '',
            str_replace(["\r", "\n"], ' ', (string)($a['notes'] ?? '')),
        ], ';');
    }
    fclose($out);
    exit;
}
