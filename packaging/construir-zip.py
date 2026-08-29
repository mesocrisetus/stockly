#!/usr/bin/env python3
"""Construye dist/stockly_ubuntu.zip con todo lo necesario para desplegar en Ubuntu.

    python packaging/construir-zip.py

El zip contiene:
    stockly_ubuntu/autoinstall.sh      (ejecutable)
    stockly_ubuntu/desinstalar.sh      (ejecutable)
    stockly_ubuntu/LEEME.txt
    stockly_ubuntu/DESPLIEGUE-UBUNTU.md
    stockly_ubuntu/public_html/...     (la aplicación, sin router.php)
"""
import io
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOP = "stockly_ubuntu"
OUT = os.path.join(ROOT, "dist", "stockly_ubuntu.zip")
FIXED_DATE = (2026, 1, 1, 0, 0, 0)  # zip determinista

EXCLUDE_NAMES = {"router.php", ".DS_Store", "Thumbs.db", "desktop.ini"}


def add_bytes(zf, arcname, data, *, executable=False):
    zi = zipfile.ZipInfo(f"{TOP}/{arcname}", date_time=FIXED_DATE)
    zi.compress_type = zipfile.ZIP_DEFLATED
    # rw-r--r-- ó rwxr-xr-x  en los bits altos del external_attr
    zi.external_attr = (0o755 if executable else 0o644) << 16
    zf.writestr(zi, data)


def add_text_lf(zf, arcname, path, *, executable=False):
    with open(path, "rb") as fh:
        data = fh.read().replace(b"\r\n", b"\n")
    add_bytes(zf, arcname, data, executable=executable)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    pub = os.path.join(ROOT, "public_html")
    if not os.path.isdir(pub):
        sys.exit("No encuentro public_html/")

    files = []  # (arcname, abspath, is_text_lf, executable)
    files.append(("autoinstall.sh", os.path.join(ROOT, "packaging", "autoinstall.sh"), True, True))
    files.append(("desinstalar.sh", os.path.join(ROOT, "packaging", "desinstalar.sh"), True, True))
    files.append(("LEEME.txt", os.path.join(ROOT, "packaging", "LEEME.txt"), True, False))
    files.append(("DESPLIEGUE-UBUNTU.md", os.path.join(ROOT, "DESPLIEGUE-UBUNTU.md"), True, False))

    for base, _dirs, names in os.walk(pub):
        for n in sorted(names):
            if n in EXCLUDE_NAMES:
                continue
            ap = os.path.join(base, n)
            rel = os.path.relpath(ap, ROOT).replace(os.sep, "/")  # public_html/...
            # texto -> LF ; binario (svg/webp/ico) -> tal cual
            is_text = n.rsplit(".", 1)[-1].lower() in {
                "html", "js", "css", "php", "htaccess", "svg", "json", "txt", "md",
            } or n == ".htaccess"
            files.append((rel, ap, is_text, False))

    files.sort(key=lambda t: t[0])

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for arcname, ap, is_text, ex in files:
            if is_text:
                add_text_lf(zf, arcname, ap, executable=ex)
            else:
                with open(ap, "rb") as fh:
                    add_bytes(zf, arcname, fh.read(), executable=ex)

    size = os.path.getsize(OUT)
    print(f"OK  {OUT}  ({size/1024:.1f} KB)")
    with zipfile.ZipFile(OUT) as zf:
        for i in zf.infolist():
            mode = (i.external_attr >> 16) & 0o777
            print(f"  {mode:o}  {i.filename}")


if __name__ == "__main__":
    main()
