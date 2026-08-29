#!/usr/bin/env bash
# =============================================================================
#  Stockly · instalador automático para Ubuntu (Apache + PHP)
# =============================================================================
#  Uso:
#     unzip stockly_ubuntu.zip
#     cd stockly_ubuntu
#     sudo ./autoinstall.sh
#
#  Opciones (variables de entorno):
#     STOCKLY_DIR=/opt/stockly     carpeta de instalación (por defecto /var/www/stockly)
#     STOCKLY_PORT=8080            fuerza un puerto concreto (por defecto: 80 si el
#                                  servidor está limpio, 8080 si ya aloja otras webs
#                                  o si el puerto 80 redirige a https)
#
#  - Instala Apache y PHP, copia la aplicación, crea el sitio y lo arranca.
#  - Elige el puerto solo para no chocar con otras webs del servidor.
#  - Si lo vuelves a ejecutar, ACTUALIZA la web y CONSERVA todos tus datos.
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
PORT_REQUESTED="${STOCKLY_PORT:-}"
SITE_CONF="/etc/apache2/sites-available/stockly.conf"
PORT_CONF="/etc/apache2/conf-available/stockly-port.conf"

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
  if grep -q '"pass_hash"' "$APP_DIR/data_store/db.json" 2>/dev/null; then
    FRESH=0
    warn "Ya hay una instalación en $APP_DIR — se ACTUALIZARÁ la web y se conservarán los datos."
  else
    warn "Encontré un db.json incompleto de un intento anterior; se regenerará."
    rm -f "$APP_DIR/data_store/db.json" "$APP_DIR/data_store/db.json.lock"
  fi
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

say "Ajustando permisos"
chown -R www-data:www-data "$APP_DIR"
find "$APP_DIR/public_html" -type d -exec chmod 755 {} +
find "$APP_DIR/public_html" -type f -exec chmod 644 {} +
chmod 770 "$APP_DIR/data_store"
ok "Propietario www-data; data_store con permiso de escritura"

# ---- Utilidades -----------------------------------------------------
reload_apache() {
  systemctl reload apache2   2>/dev/null && return 0
  systemctl restart apache2  2>/dev/null && return 0
  service apache2 reload     2>/dev/null && return 0
  service apache2 restart    2>/dev/null && return 0
  apache2ctl -k graceful     2>/dev/null && return 0
  apache2ctl start           2>/dev/null && return 0
  return 1
}

# Escribe la config del sitio para un puerto dado y recarga Apache.
apply_vhost() {
  local port="$1" vhline
  if [ "$port" = "80" ]; then vhline="*:80"; else vhline="*:${port}"; fi

  if [ ! -f /etc/apache2/conf-available/servername.conf ]; then
    echo "ServerName $(hostname -f 2>/dev/null || hostname 2>/dev/null || echo localhost)" \
      > /etc/apache2/conf-available/servername.conf
    a2enconf servername >/dev/null 2>&1 || true
  fi

  if [ "$port" = "80" ]; then
    rm -f "$PORT_CONF"; a2disconf stockly-port >/dev/null 2>&1 || true
  else
    echo "Listen ${port}" > "$PORT_CONF"
    a2enconf stockly-port >/dev/null
  fi

  cat > "$SITE_CONF" <<APACHE
<VirtualHost ${vhline}>
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

  a2ensite stockly.conf >/dev/null
  apache2ctl configtest
  reload_apache || warn "No pude recargar Apache; hazlo con: systemctl restart apache2"
}

# ¿Sirve Stockly de verdad en este puerto? (rechaza redirects a https, páginas de otro sitio…)
probe() {
  local port="$1" base body
  base="http://127.0.0.1:${port}"
  curl -fsS -m 15 -X POST "$base/api/login" -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"arranque"}' -o /dev/null 2>/dev/null || true
  chown -R www-data:www-data "$APP_DIR/data_store" 2>/dev/null || true
  body="$(curl -s -m 10 "$base/api/me" 2>/dev/null || true)"
  case "$body" in
    *'"user"'*) return 0 ;;
    *) return 1 ;;
  esac
}

open_firewall() {
  local port="$1"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "${port}/tcp" >/dev/null 2>&1 || true
    ok "Puerto $port permitido en ufw"
  fi
}

# ---- 5. Elegir puerto -------------------------------------------------
say "Comprobando la configuración web del servidor"
OTHER_SITES="$(ls /etc/apache2/sites-enabled/ 2>/dev/null | grep -vE '^(000-default|default-ssl)\.conf$' || true)"

REDIRECTS_HTTPS=0
if curl -s -o /dev/null -m 5 -w '%{http_code} %{redirect_url}' http://127.0.0.1/ 2>/dev/null \
     | grep -qE '^30[0-9] https'; then
  REDIRECTS_HTTPS=1
fi

if [ -n "$PORT_REQUESTED" ]; then
  PORT="$PORT_REQUESTED"
  ok "Puerto solicitado: $PORT"
elif [ -n "$OTHER_SITES" ] || [ "$REDIRECTS_HTTPS" -eq 1 ]; then
  PORT=8080
  [ -n "$OTHER_SITES" ] && { warn "El servidor ya aloja otras webs:"; printf '        %s\n' $OTHER_SITES; }
  [ "$REDIRECTS_HTTPS" -eq 1 ] && warn "El puerto 80 redirige a https (de otra web)."
  warn "Stockly se instalará en el puerto $PORT para no interferir."
else
  PORT=80
  ok "Servidor limpio: se usará el puerto 80"
fi

# ---- 6. Montar el sitio, con reintento en 8080 si el 80 no sirve --------
say "Configurando el sitio de Apache (puerto $PORT)"
if [ "$PORT" = "80" ] && [ -z "$OTHER_SITES" ]; then
  a2dissite 000-default.conf >/dev/null 2>&1 || true   # Stockly será el sitio por defecto
fi
apply_vhost "$PORT"
open_firewall "$PORT"

say "Arrancando la aplicación y comprobando que responde"
sleep 2
if probe "$PORT"; then
  ok "Stockly responde en http://127.0.0.1:${PORT}"
elif [ "$PORT" = "80" ] && [ -z "$PORT_REQUESTED" ]; then
  warn "El puerto 80 no entrega Stockly directamente (lo ocupa otra web o redirige)."
  warn "Reconfigurando en el puerto 8080..."
  a2ensite 000-default.conf >/dev/null 2>&1 || true    # devolvemos el sitio por defecto
  PORT=8080
  apply_vhost "$PORT"
  open_firewall "$PORT"
  sleep 2
  if probe "$PORT"; then
    ok "Stockly responde en http://127.0.0.1:${PORT}"
  else
    warn "Sigue sin responder. Revisa: tail /var/log/apache2/stockly_error.log"
  fi
else
  warn "Stockly no respondió en el puerto $PORT."
  warn "Revisa: systemctl status apache2 ; tail /var/log/apache2/stockly_error.log"
fi

# ---- 7. Resumen -----------------------------------------------------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP" ] || IP="LA-IP-DEL-SERVIDOR"
URL="http://$IP/"
[ "$PORT" = "80" ] || URL="http://$IP:$PORT/"

echo
echo "======================================================================"
echo "  ✔ Stockly instalado"
echo "======================================================================"
echo
echo "  Ábrelo desde cualquier ordenador de la red (con http://, no https://):"
echo
echo "        $URL"
echo
if [ -f "$APP_DIR/data_store/CONTRASENA_INICIAL_ADMIN.txt" ]; then
  echo "  Acceso inicial:"
  sed 's/^/        /' "$APP_DIR/data_store/CONTRASENA_INICIAL_ADMIN.txt"
  echo "  (cámbiala en la app: menú de tu nombre -> Cambiar contraseña; luego borra ese fichero)"
elif [ "$FRESH" -eq 1 ]; then
  warn "No se pudo crear la cuenta inicial (la app no respondió)."
  warn "Cuando responda, ejecútalo de nuevo o entra a $URL y se creará al primer intento de login."
else
  echo "  Tus datos y cuentas anteriores se han conservado."
fi
echo
echo "  Ficheros de la aplicación : $APP_DIR/public_html"
echo "  Base de datos (respaldar) : $APP_DIR/data_store/db.json"
echo "  Puerto                    : $PORT"
echo "  Actualizar más adelante   : vuelve a ejecutar  sudo ./autoinstall.sh"
echo "  Desinstalar               : sudo ./desinstalar.sh"
echo "======================================================================"
