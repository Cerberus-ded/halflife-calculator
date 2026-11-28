#!/usr/bin/env bash
# Компактная версия для Windows: один файл halflife-calc.exe (около 8 МБ), веб-версия зашита внутрь.
# Окно — WebView2 (движок Microsoft Edge, есть в Windows 10 и 11). Установка не нужна.
#
#   bash windows/build.sh [папка]     → <папка>/halflife-calc.exe (по умолчанию dist/)
#
# Нужны Go 1.22+ и windres из MinGW (Ubuntu: apt-get install binutils-mingw-w64-x86-64) — значок, манифест
# и сведения о файле. Собирается на Linux без Wine и без компилятора C. Номер версии — из desktop/package.json.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
OUT="${1:-$ROOT/dist}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

FULL="$(sed -n 's/^ *"version": *"\([0-9][0-9.]*\)".*/\1/p' "$ROOT/desktop/package.json" | head -1)"
[ -n "$FULL" ] || { echo "Не найден номер версии в desktop/package.json" >&2; exit 1; }
SHORT="${FULL%.0}"
MAJOR="${FULL%%.*}"; REST="${FULL#*.}"; MINOR="${REST%%.*}"

WINDRES="${WINDRES:-$(command -v x86_64-w64-mingw32-windres || command -v windres || true)}"
[ -n "$WINDRES" ] || { echo "Нет windres: apt-get install binutils-mingw-w64-x86-64" >&2; exit 1; }

cd "$HERE"
# веб-версия внутрь exe (go:embed берёт файлы только из своей папки)
rm -rf web && mkdir web
find "$ROOT/web" -maxdepth 1 -type f ! -name '.*' -exec cp {} web/ \;
for need in index.html app.js core.js nucdb.js; do [ -f "web/$need" ] || { echo "В web/ нет $need" >&2; exit 1; }; done

printf '#define VER_MAJOR %s\n#define VER_MINOR %s\n#define VER_STR "%s"\n' "$MAJOR" "$MINOR" "$SHORT" > version.h
"$WINDRES" --preprocessor=cpp -c 65001 -O coff -i app.rc -o rsrc_windows_amd64.syso

CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath \
  -ldflags "-s -w -H windowsgui -X main.version=$SHORT" -o "$OUT/halflife-calc.exe" .
echo "  exe: $OUT/halflife-calc.exe ($(( $(stat -c %s "$OUT/halflife-calc.exe" 2>/dev/null || wc -c < "$OUT/halflife-calc.exe") / 1024 )) КБ, версия $SHORT)"
