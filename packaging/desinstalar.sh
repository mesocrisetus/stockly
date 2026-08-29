#!/usr/bin/env bash
# =============================================================================
#  Stockly · desinstalador para Ubuntu
# =============================================================================
#  Quita el sitio de Apache y (opcionalmente) la carpeta de la aplicación.
#  SIEMPRE guarda antes una copia de la base de datos en /var/backups/.
#
#     sudo ./desinstalar.sh
# =============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  exec sudo -E bash "$0" "$@"
fi

APP_DIR="${1:-${STOCKLY_DIR:-/var/www/stockly}}"
SITE_CONF="/etc/apache2/sites-available/stockly.conf"

echo "Desinstalando Stockly de: $APP_DIR"

# 1. Copia de seguridad de los datos
if [ -f "$APP_DIR/data_store/db.json" ]; then
  BK="/var/backups/stockly-db-$(date +%Y%m%d-%H%M%S).json"
  cp "$APP_DIR/data_store/db.json" "$BK"
  echo "  Copia de seguridad de la base de datos: $BK"
fi

# 2. Quitar el sitio de Apache
a2dissite stockly.conf >/dev/null 2>&1 || true
rm -f "$SITE_CONF"
a2disconf stockly-port >/dev/null 2>&1 || true
rm -f /etc/apache2/conf-available/stockly-port.conf
a2ensite 000-default.conf >/dev/null 2>&1 || true
systemctl reload apache2 2>/dev/null || service apache2 reload 2>/dev/null || true
echo "  Sitio de Apache y su puerto propio eliminados."

# 3. ¿Borrar también los ficheros?
read -r -p "¿Borrar la carpeta $APP_DIR y todos los datos? (escribe 'si' para confirmar): " ANS
if [ "$ANS" = "si" ]; then
  rm -rf "$APP_DIR"
  echo "  $APP_DIR eliminada."
else
  echo "  Se conserva $APP_DIR (puedes borrarla a mano cuando quieras)."
fi

echo "Listo. Apache, PHP y sus paquetes NO se han desinstalado (los usan otras webs a menudo)."
echo "Si quieres quitarlos:  sudo apt-get remove --purge apache2 'php*'"
