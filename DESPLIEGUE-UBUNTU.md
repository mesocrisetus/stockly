# Desplegar Stockly en un servidor Ubuntu (en local / on-premises)

Guía paso a paso para poner la aplicación en un servidor **Ubuntu 22.04 o
24.04** de tu red interna, sin depender de Hostinger. Al final tendrás la web
funcionando en `http://IP-DEL-SERVIDOR/` para todo el equipo de IT/RRHH.

Hay dos caminos. **El A (Apache) es el recomendado**: es idéntico a Hostinger y
el fichero `.htaccess` que ya viene funciona sin tocar nada. El B (Nginx) queda
como alternativa.

Todos los comandos se ejecutan en el servidor Ubuntu, con un usuario que pueda
hacer `sudo`.

---

## Camino rápido — instalador automático (recomendado)

En la sección **Releases** del repositorio hay un fichero **`stockly_ubuntu.zip`**
con la aplicación y un instalador que lo monta todo solo.

> El repositorio es **privado**, así que la URL de descarga del zip pide
> autenticación. Lo más cómodo: descarga `stockly_ubuntu.zip` desde la web de
> GitHub en tu PC (sesión iniciada) y pásalo al servidor con `scp`:
> `scp stockly_ubuntu.zip usuario@IP-DEL-SERVIDOR:~/`
> (Alternativas: `gh release download v1.0.0 -R mesocrisetus/stockly` tras
> `gh auth login`, o hacer el repo público.)

```bash
# ya en el servidor Ubuntu, con el zip en el directorio actual
sudo apt-get install -y unzip
unzip stockly_ubuntu.zip
cd stockly_ubuntu
sudo ./autoinstall.sh
```

El instalador: instala Apache y PHP, copia la web a `/var/www/stockly/public_html`,
crea `data_store/` fuera de la web, configura el sitio de Apache, abre el puerto
y te muestra la dirección exacta y la contraseña inicial.

**Puerto:** en un servidor limpio usa el **80** (`http://IP/`). Si el servidor
**ya aloja otras webs** o su **puerto 80 redirige a https**, Stockly se instala
en el **8080** automáticamente (`http://IP:8080/`) sin tocar el resto. Fuerza uno
con `sudo STOCKLY_PORT=9000 ./autoinstall.sh`. **Entra siempre por `http://`,
no `https://`.**

Volver a ejecutarlo **actualiza** la web **sin borrar los datos**. Otra carpeta:
`sudo ./autoinstall.sh /opt/stockly`. Quitarlo: `sudo ./desinstalar.sh`.

El resto de esta guía es el mismo proceso **paso a paso a mano**, por si
prefieres controlarlo tú o usar Nginx.

---

## 0. Qué vas a montar

```
/var/www/stockly/
├── public_html/          ← la web (esto es lo único que sirve Apache)
│   ├── index.html  app.html  styles.css  app.js
│   ├── .htaccess
│   ├── api/              ← el servidor PHP (login, datos, exportación)
│   └── assets/
└── data_store/           ← la base de datos (db.json). FUERA de public_html.
                            Nunca se borra al actualizar la web.
```

La carpeta `tools/` de tu proyecto **no se copia** al servidor: es solo el PHP
portátil para probar en Windows.

---

## Camino A — Apache + PHP  (recomendado)

### A.1. Instalar Apache y PHP

```bash
sudo apt update
sudo apt install -y apache2 php php-cli php-mbstring php-xml php-curl libapache2-mod-php unzip
```

Comprueba la versión de PHP (vale 8.1 o superior):

```bash
php -v
```

### A.2. Activar los módulos de Apache que usa el `.htaccess`

```bash
sudo a2enmod rewrite headers expires deflate
sudo systemctl restart apache2
```

### A.3. Copiar los ficheros de la aplicación

Lleva al servidor la carpeta del proyecto (por USB, `scp`, `git`, lo que uses).
Suponiendo que la dejas en `/tmp/Inventario SaaS/`:

```bash
sudo mkdir -p /var/www/stockly
sudo cp -r "/tmp/Inventario SaaS/public_html" /var/www/stockly/
sudo mkdir -p /var/www/stockly/data_store
```

> Si copiaste el proyecto entero, borra lo que no hace falta en el servidor:
> `sudo rm -rf /var/www/stockly/tools /var/www/stockly/public_html/router.php`
> (`router.php` solo sirve para probar en Windows; en Apache no se usa).

### A.4. Permisos

Apache corre como el usuario `www-data`. Necesita **leer** la web y
**escribir** en `data_store/` (ahí guarda cuentas e inventario).

```bash
sudo chown -R www-data:www-data /var/www/stockly
sudo find /var/www/stockly/public_html -type d -exec chmod 755 {} \;
sudo find /var/www/stockly/public_html -type f -exec chmod 644 {} \;
sudo chmod 770 /var/www/stockly/data_store
```

### A.5. Crear el sitio en Apache

```bash
sudo nano /etc/apache2/sites-available/stockly.conf
```

Pega esto (cambia `stockly.local` por tu dominio interno o déjalo así):

```apache
<VirtualHost *:80>
    ServerName stockly.local
    DocumentRoot /var/www/stockly/public_html

    <Directory /var/www/stockly/public_html>
        Options -Indexes +FollowSymLinks
        AllowOverride All          # <-- imprescindible: hace que el .htaccess funcione
        Require all granted
    </Directory>

    # Nunca servir la base de datos aunque alguien acierte la ruta
    <Directory /var/www/stockly/data_store>
        Require all denied
    </Directory>

    ErrorLog  ${APACHE_LOG_DIR}/stockly_error.log
    CustomLog ${APACHE_LOG_DIR}/stockly_access.log combined
</VirtualHost>
```

Activa el sitio y desactiva el de bienvenida por defecto:

```bash
sudo a2ensite stockly.conf
sudo a2dissite 000-default.conf
sudo systemctl reload apache2
```

### A.6. Abrir el puerto (si tienes cortafuegos)

```bash
sudo ufw allow 'Apache'
```

### A.7. Probar

Desde otro ordenador de la red, abre en el navegador:

```
http://IP-DEL-SERVIDOR/
```

(La IP la ves con `hostname -I` en el servidor.)

1. Debe aparecer la pantalla de acceso.
2. Entra con usuario **`admin`** y la contraseña que está en
   `data_store/CONTRASENA_INICIAL_ADMIN.txt`. Ese fichero lo crea la propia
   aplicación la primera vez que alguien intenta entrar:

   ```bash
   sudo cat /var/www/stockly/data_store/CONTRASENA_INICIAL_ADMIN.txt
   ```

3. Entra, cambia la contraseña (arriba a la derecha → tu nombre → *Cambiar
   contraseña*) y borra ese `.txt`:

   ```bash
   sudo rm /var/www/stockly/data_store/CONTRASENA_INICIAL_ADMIN.txt
   ```

### A.8. Comprobaciones de seguridad

```bash
# La base de datos NO debe ser accesible por web (todas deben dar 403 o 404):
curl -s -o /dev/null -w "%{http_code}\n" http://IP-DEL-SERVIDOR/../data_store/db.json
curl -s -o /dev/null -w "%{http_code}\n" http://IP-DEL-SERVIDOR/api/db.php

# El login sí debe responder (JSON):
curl -s http://IP-DEL-SERVIDOR/api/me
```

Si `/api/me` devuelve `{"user":null}` y las otras dan 403/404, está bien.

---

## Camino B — Nginx + PHP-FPM  (alternativa)

Nginx no lee `.htaccess`, así que las reglas van en la configuración del sitio.

### B.1. Instalar

```bash
sudo apt update
sudo apt install -y nginx php-fpm php-cli php-mbstring php-xml php-curl unzip
php -v                       # anota la versión, p.ej. 8.3
systemctl status php8.3-fpm  # ajusta el número a tu versión
```

### B.2. Copiar ficheros y permisos

Igual que en **A.3** y **A.4** (Nginx y PHP-FPM también corren como `www-data`).

### B.3. Configurar el sitio

```bash
sudo nano /etc/nginx/sites-available/stockly
```

```nginx
server {
    listen 80;
    server_name stockly.local;               # o la IP del servidor
    root /var/www/stockly/public_html;
    index index.html;

    # --- API: todo /api/... lo atiende un único PHP ---
    location /api/ {
        try_files $uri /api/index.php$is_args$args;
    }

    location = /api/index.php {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;   # <-- ajusta la versión
    }

    # --- Bloquear el resto de PHP y los ficheros de datos ---
    location ~ ^/api/(?!index\.php$).*\.php$ { deny all; }
    location ~* \.(json|lock|tmp|bak|log)$   { deny all; }

    # --- Páginas y estáticos ---
    location / {
        try_files $uri $uri.html $uri/ =404;
    }

    location ~* \.(html)$ {
        add_header Cache-Control "no-cache, must-revalidate";
    }
    location ~* \.(css|js)$ {
        add_header Cache-Control "no-cache, must-revalidate";
    }
    location ~* \.(webp|svg|ico|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, max-age=2592000";
    }

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

### B.4. Activar y probar

```bash
sudo ln -s /etc/nginx/sites-available/stockly /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
sudo ufw allow 'Nginx HTTP'
```

Luego los mismos pasos de prueba y seguridad que en **A.7** y **A.8**.

---

## Actualizar la aplicación más adelante

Cuando yo te pase una versión nueva, solo se reemplaza la web; **la carpeta
`data_store/` no se toca**, así que no se pierde ningún dato:

```bash
sudo rm -rf /var/www/stockly/public_html
sudo cp -r "/ruta/a/la/nueva/version/public_html" /var/www/stockly/
sudo rm -f /var/www/stockly/public_html/router.php
sudo chown -R www-data:www-data /var/www/stockly/public_html
sudo systemctl reload apache2      # o: nginx
```

---

## Copia de seguridad

Todo el inventario y las cuentas están en un único fichero. Cópialo cada noche:

```bash
sudo crontab -e
```

Añade esta línea (guarda una copia diaria, conserva 30 días):

```
30 22 * * * cp /var/www/stockly/data_store/db.json /var/backups/stockly-$(date +\%F).json; find /var/backups -name "stockly-*.json" -mtime +30 -delete
```

Restaurar = volver a copiar un `stockly-FECHA.json` como
`/var/www/stockly/data_store/db.json` y `sudo chown www-data:www-data` sobre él.

---

## (Opcional) HTTPS en la red interna

Para que sea `https://stockly.tuempresa.local` sin avisos, lo normal en una
red interna es emitir un certificado con la CA de tu empresa. Si el servidor
llega a tener un nombre público, con **Certbot** es directo:

```bash
sudo apt install -y certbot python3-certbot-apache   # o ...-certbot-nginx
sudo certbot --apache                                # o: --nginx
```

---

## Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| La pantalla de acceso carga pero “Entrar” no hace nada | Falta `AllowOverride All` (Apache) o el bloque `location /api/` (Nginx). Revisa `A.5` / `B.3`. |
| Error “No se pudo guardar la base de datos” | `data_store/` no tiene permiso de escritura para `www-data`. Repite `A.4`. |
| `/api/...` devuelve 404 | En Apache falta `sudo a2enmod rewrite`. En Nginx, revisa el `fastcgi_pass` (versión de PHP correcta). |
| Página en blanco / error 500 | Mira el log: `sudo tail -n 50 /var/log/apache2/stockly_error.log`. Casi siempre es una extensión de PHP que falta: `sudo apt install php-mbstring php-xml`. |
| La web va lenta o “se cuelga” al abrir varias pestañas | Solo pasa con el PHP de pruebas de Windows. En Apache/Nginx del servidor no ocurre. |
