# Stockly

Aplicación web interna para gestionar los equipos de la empresa (celulares,
portátiles, monitores, tablets, impresoras, mobiliario…) y a quién están
asignados. Sin IA, sin planes ni pagos: solo un acceso de administrador.

---

## 1. Probarlo en tu ordenador (Windows)

> **Si acabas de clonar el repositorio:** primero descarga el PHP portátil de
> pruebas (no viaja en el repo por su tamaño). Clic derecho en
> `tools/descargar-php.ps1` → *Ejecutar con PowerShell*. Solo hay que hacerlo
> una vez.

1. Entra en la carpeta `tools` y haz **doble clic en `servir.bat`**
   (o clic derecho en `servir.ps1` → *Ejecutar con PowerShell*).
2. Se abre una ventana negra. Déjala abierta.
3. En el navegador ve a **http://localhost:8080**
4. Entra con:
   - **Usuario:** `admin`
   - **Contraseña:** la que aparece en
     `data_store/CONTRASENA_INICIAL_ADMIN.txt`
5. Cuando termines, cierra la ventana negra para parar.

Cambia la contraseña desde la app (arriba a la derecha, tu nombre → *Cambiar
contraseña*) y luego borra ese fichero `.txt`.

---

## 2. Qué hace

| Sección | Para qué sirve |
|---|---|
| **Panel** | Resumen: totales, avisos (activos en reparación o parados mucho tiempo), reparto por tipo. |
| **Activos** | Lista completa con buscador y filtros por tipo, estado y persona. Botón *Nuevo activo*. Clic en una fila para ver su ficha. |
| **Empleados** | Alta de personas (nombre, área, correo). Clic en una fila para ver sus activos y su historial. |
| **Ajustes** | Días para el aviso de "sin asignar", **tipos de activo** (añadir/renombrar/eliminar categorías como switch, router…), cambio de contraseña y alta de más administradores. |
| **Exportar CSV** | Descarga todo el inventario para abrirlo en Excel. |
| **Modo claro / oscuro** | Botón en la barra superior. Arranca en **claro** (aspecto empresarial) y recuerda tu elección en ese navegador. |

**Ficha de un activo:** toda su información, botones para *Editar*, *Asignar /
Desasignar*, *Enviar a reparación* y *Dar de baja*, y el historial completo de
quién lo ha tenido.

**Ficha de un empleado:** además de sus datos e historial, en *Activos en uso*
cada activo tiene un botón **Quitar** para devolvértelo (uno a uno) sin salir de
la pestaña Empleados. Se registra en el historial igual que una devolución
normal.

Los datos de ejemplo (6 activos y 3 empleados) están para que veas cómo
funciona. Bórralos cuando metas los tuyos: entra en cada uno y usa *Dar de
baja* / *Eliminar*, o pídeme que te deje la aplicación vacía.

---

## 3. Dónde se guardan los datos  (IMPORTANTE)

Todo el inventario vive en **`data_store/db.json`**, una carpeta que está
**fuera** de `public_html`. Esto es a propósito: cuando se vuelve a publicar la
web, se reemplaza `public_html` entero. Si la base de datos estuviera dentro,
se borraría en cada actualización. Al estar fuera, **se conserva siempre**.

- Copia de seguridad = copiar el fichero `data_store/db.json`.
- No hace falta ninguna base de datos ni servidor extra.

---

## 4. Ponerlo en un servidor

- **Servidor Ubuntu propio (red interna) — lo más fácil:** descarga
  `stockly_ubuntu.zip` de la sección **[Releases](../../releases)**, descomprímelo
  en el servidor y ejecuta `sudo ./autoinstall.sh`. Instala y arranca todo solo.
  Detalles y método manual (o con Nginx) en
  [`DESPLIEGUE-UBUNTU.md`](DESPLIEGUE-UBUNTU.md).
- **Hostinger:** ver abajo.

> Para regenerar el zip tú mismo: `python packaging/construir-zip.py`
> (queda en `dist/stockly_ubuntu.zip`).

### 4b. Publicarlo en Hostinger  (cuando quieras)

Todavía no está publicado. Para hacerlo:

1. Conecta tu cuenta de Hostinger (te guío: es entrar con tu usuario en una
   ventana del navegador).
2. Se sube el contenido de **`public_html/`** al hosting.
3. La carpeta **`data_store/`** se crea sola la primera vez, un nivel por
   encima de la web, y ya no se toca nunca más.
4. La carpeta `tools/` **no se sube** (es solo para probar en local).

Requisitos del hosting: cualquier plan de Hostinger con PHP (todos lo tienen).
No hace falta Node ni nada que compilar.

---

## 5. Seguridad

- Las contraseñas se guardan cifradas (bcrypt), nunca en texto plano.
- Todo pasa por un acceso con sesión; sin iniciar sesión no se ve ni se
  cambia nada.
- Los ficheros de datos no son accesibles desde el navegador.
- No hay claves ni secretos en el código que descarga el navegador (no usa
  ningún servicio externo de pago).
