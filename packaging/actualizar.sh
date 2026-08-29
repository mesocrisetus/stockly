#!/usr/bin/env bash
# =============================================================================
#  Stockly · actualizar SOLO la aplicación
# =============================================================================
#  Copia la web nueva encima de la instalada. NO toca Apache, ni el puerto,
#  ni los datos (data_store se deja intacto).
#
#     unzip stockly_ubuntu.zip
#     cd stockly_ubuntu
#     sudo ./actualizar.sh
#
#  Carpeta por defecto /var/www/stockly  (cámbiala:  sudo ./actualizar.sh /opt/stockly)
# =============================================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Necesito permisos de administrador; re-lanzando con sudo..."
  exec sudo -E bash "$0" "$@"
fi

SRC_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APP_DIR="${1:-${STOCKLY_DIR:-/var/www/stockly}}"

[ -d "$SRC_DIR/public_html" ] || { echo "ERROR: no encuentro public_html junto a este script."; exit 1; }
if [ ! -d "$APP_DIR/public_html" ]; then
  echo "ERROR: no hay ninguna instalación en $APP_DIR."
  echo "       Para instalar por primera vez usa:  sudo ./autoinstall.sh"
  exit 1
fi

echo "Actualizando la aplicación en $APP_DIR (los datos NO se tocan)..."

# Copia de seguridad de la base de datos, por si acaso
if [ -f "$APP_DIR/data_store/db.json" ]; then
  cp "$APP_DIR/data_store/db.json" "$APP_DIR/data_store/db.json.bak-$(date +%Y%m%d-%H%M%S)"
fi

rm -rf "$APP_DIR/public_html"
cp -a "$SRC_DIR/public_html" "$APP_DIR/public_html"
rm -f "$APP_DIR/public_html/router.php"

chown -R www-data:www-data "$APP_DIR/public_html"
find "$APP_DIR/public_html" -type d -exec chmod 755 {} +
find "$APP_DIR/public_html" -type f -exec chmod 644 {} +

systemctl reload apache2 2>/dev/null || service apache2 reload 2>/dev/null || true

echo "Hecho. La configuración de Apache y todos los datos siguen igual."
echo "Si el navegador muestra la versión vieja, recarga con Ctrl+F5."
