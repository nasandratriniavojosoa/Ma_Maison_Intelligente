#!/data/data/com.termux/files/usr/bin/bash
# Sauvegarde horodatée de TOUT le projet (code, adresse de l'ESP32, infos développeur, photo).
#   bash sauvegarde.sh               -> crée  <projet>_AAAAMMJJ_HHMMSS.zip
#   bash sauvegarde.sh --garder 10   -> idem, et ne conserve que les 10 sauvegardes les plus récentes
# Emplacement : Téléchargements/MaMaisonIntelligente_Sauvegardes (visible dans le gestionnaire de fichiers)
set -e
cd "$(dirname "$0")"
PROJET="$(basename "$PWD")"
STAMP="$(date +%Y%m%d_%H%M%S)"
GARDER=""
if [ "$1" = "--garder" ]; then
    GARDER="$2"
    case "$GARDER" in ''|*[!0-9]*) echo "❌ Usage : bash sauvegarde.sh --garder 10"; exit 1;; esac
fi

if [ -d "$HOME/storage/downloads" ]; then
    DEST="$HOME/storage/downloads/MaMaisonIntelligente_Sauvegardes"
else
    DEST="$HOME/MaMaisonIntelligente_Sauvegardes"
    echo "ℹ️  Stockage partagé non autorisé (termux-setup-storage) : sauvegarde dans $DEST"
fi
mkdir -p "$DEST"

if ! command -v zip >/dev/null 2>&1 && command -v pkg >/dev/null 2>&1; then
    echo "📦 Installation de zip…"
    pkg install -y zip >/dev/null 2>&1 || true
fi

cd ..
if command -v zip >/dev/null 2>&1; then
    FICHIER="$DEST/${PROJET}_${STAMP}.zip"
    zip -rq "$FICHIER" "$PROJET"
else
    echo "ℹ️  zip indisponible : archive .tar.gz à la place."
    FICHIER="$DEST/${PROJET}_${STAMP}.tar.gz"
    tar -czf "$FICHIER" "$PROJET"
fi

echo "✅ Sauvegarde créée :"
echo "   $FICHIER"
du -h "$FICHIER" | cut -f1 | sed 's/^/   Taille : /'

if [ -n "$GARDER" ]; then
    N=0
    ls -1t "$DEST/${PROJET}_"*.zip "$DEST/${PROJET}_"*.tar.gz 2>/dev/null | while read -r F; do
        N=$((N+1))
        if [ "$N" -gt "$GARDER" ]; then rm -f "$F"; echo "🗑️  Ancienne sauvegarde supprimée : $(basename "$F")"; fi
    done
fi

echo ""
echo "Sauvegardes existantes :"
ls -1t "$DEST/${PROJET}_"* 2>/dev/null | head -10 | while read -r F; do echo "   $(basename "$F")"; done
echo ""
echo "Pour restaurer : cd ~ && unzip -o \"$FICHIER\""
