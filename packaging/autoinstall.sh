#!/usr/bin/env bash
# =============================================================================
#  Stockly · instalador automático para Ubuntu (Apache + PHP)
# =============================================================================
#  Uso:
#     unzip stockly_ubuntu.zip
#     cd stockly_ubuntu
#     sudo ./autoinstall.sh
#
#  - Instala Apache y PHP, copia la aplicación, crea el sitio y lo arranca.
#  - Si lo vuelves a ejecutar, ACTUALIZA la web y CONSERVA todos tus datos.
#  - Carpeta de instalación por defecto: /var/www/stockly
#    (cámbiala con:  sudo ./autoinstall.sh /ruta/que/quieras )
# =============================================================================
set -euo pipefail

# ---- 0. Requiere root: si no lo es, se re-lanza con sudo -------------------
if [ "$(id -u)" -ne 0 ]; then
  echo "Necesito permisos de administrador; re-lanzando con sudo..."
  exec sudo -E bash "$0" "$@"
fi

# ---- 1. Parámetros -------------------------------------------------------
SRC_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APP_DIR="${1:-${STOCKLY_DIR:-/var/www/stockly}}"
SERVER_NAME="${STOCKLY_SERVER_NAME:-stockly.local}"
SITE_CONF="/etc/apache2/sites-available/stockly.conf"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$SRC_DIR/public_html" ] || die "No encuentro la carpeta 'public_html' junto a este script. ¿Descomprimiste el zip entero?"
command -v apt-get >/dev/null 2>&1 || die "Este instalador es para Ubuntu/Debian (no encuentro apt-get)."

echo "======================================================================"
echo "  Stockly — instalador para Ubuntu"
echo "  Origen : $SRC_DIR"
echo "  Destino: $APP_DIR"
echo "======================================================================"

# ---- 2. ¿Instalación nueva o actualización? --------------------------------
FRESH=1
if [ -f "$APP_DIR/data_store/db.json" ]; then
  FRESH=0
  warn "Ya hay una instalación en $APP_DIR — se ACTUALIZARÁ la web y se conservarán los datos."
fi

# ---- 3. Paquetes --------------------------------------------------------
say "Instalando Apache y PHP (puede tardar un par de minutos)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  apache2 libapache2-mod-php \
  php php-cli php-mbstring php-xml php-curl \
  >/dev/null
ok "Apache y PHP instalados"

say "Activando módulos de Apache"
a2enmod rewrite headers expires deflate >/dev/null
ok "rewrite, headers, expires, deflate"

# ---- 4. Copiar la aplicación (sin tocar data_store) ----------------------
say "Copiando la aplicación a $APP_DIR"
mkdir -p "$APP_DIR"
rm -rf "$APP_DIR/public_html"
cp -a "$SRC_DIR/public_html" "$APP_DIR/public_html"
rm -f "$APP_DIR/public_html/router.php"        # solo sirve para pruebas en Windows
mkdir -p "$APP_DIR/data_store"                  # se crea solo si no existía
ok "Web copiada"

# ---- 5. Permisos ------------------------------------------------------
say "Ajustando permisos"
chown -R www-data:www-data "$APP_DIR"
find "$APP_DIR/public_html" -type d -exec chmod 755 {} +
find "$APP_DIR/public_html" -type f -exec chmod 644 {} +
chmod 770 "$APP_DIR/data_store"
ok "Propietario www-data; data_store con permiso de escritura"

# ---- 6. Sitio de Apache ---------------------------------------------
say "Creando el sitio de Apache"
cat > "$SITE_CONF" <<APACHE
<VirtualHost *:80>
    ServerName ${SERVER_NAME}
    DocumentRoot ${APP_DIR}/public_html

    <Directory ${APP_DIR}/public_html>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    # La base de datos vive fuera de public_html y nunca se sirve por web
    <Directory ${APP_DIR}/data_store>
        Require all denied
    </Directory>

    ErrorLog  \${APACHE_LOG_DIR}/stockly_error.log
    CustomLog \${APACHE_LOG_DIR}/stockly_access.log combined
</VirtualHost>
APACHE

a2dissite 000-default.conf >/dev/null 2>&1 || true
a2ensite stockly.conf >/dev/null
apache2ctl configtest

# Recargar Apache. En un servidor normal basta 'systemctl reload'; la cadena
# cubre también entornos sin systemd (contenedores, instalaciones mínimas).
reload_apache() {
  systemctl reload apache2   2>/dev/null && return 0
  systemctl restart apache2  2>/dev/null && return 0
  service apache2 reload     2>/dev/null && return 0
  service apache2 restart    2>/dev/null && return 0
  apache2ctl -k graceful     2>/dev/null && return 0
  apache2ctl start           2>/dev/null && return 0
  return 1
}
reload_apache || warn "No pude recargar Apache automáticamente; hazlo con: systemctl restart apache2"
ok "Sitio activado"

# ---- 7. Cortafuegos (si está activo) ------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  say "Abriendo el puerto web en el cortafuegos"
  ufw allow 'Apache' >/dev/null || true
  ok "Regla 'Apache' añadida a ufw"
fi

# ---- 8. Primer arranque: crea la base de datos y la cuenta admin --------
say "Arrancando la aplicación por primera vez"
sleep 2
curl -fsS -m 15 -X POST http://127.0.0.1/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"primer-arranque"}' -o /dev/null 2>/dev/null || true
chown -R www-data:www-data "$APP_DIR/data_store"

if curl -fsS -m 10 http://127.0.0.1/api/me >/dev/null 2>&1; then
  ok "La aplicación responde correctamente"
else
  warn "La aplicación no respondió todavía. Comprueba: systemctl status apache2 ; tail /var/log/apache2/stockly_error.log"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP" ] || IP="LA-IP-DEL-SERVIDOR"

echo
echo "======================================================================"
echo "  ✔ Stockly instalado"
echo "======================================================================"
echo
echo "  Ábrelo desde cualquier ordenador de la red:"
echo
echo "        http://$IP/"
echo
if [ "$FRESH" -eq 1 ] && [ -f "$APP_DIR/data_store/CONTRASENA_INICIAL_ADMIN.txt" ]; then
  echo "  Acceso inicial:"
  sed 's/^/        /' "$APP_DIR/data_store/CONTRASENA_INICIAL_ADMIN.txt"
  echo "  (cámbiala en la app: tu nombre → Cambiar contraseña; luego borra ese fichero)"
else
  echo "  Tus datos y cuentas anteriores se han conservado."
fi
echo
echo "  Ficheros de la aplicación : $APP_DIR/public_html"
echo "  Base de datos (respaldar) : $APP_DIR/data_store/db.json"
echo "  Actualizar más adelante   : vuelve a ejecutar  sudo ./autoinstall.sh"
echo "  Desinstalar               : sudo ./desinstalar.sh"
echo "======================================================================"
