#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Build e deploy automático para o container n8n
#
# Uso:
#   ./deploy.sh              → build + deploy + restart
#   ./deploy.sh --no-restart → build + deploy (sem reiniciar o n8n)
# ─────────────────────────────────────────────────────────────────────────────

set -e

PACKAGE_NAME="@welsonviana/n8n-nodes-generic-rest-chat-model-AI"
CONTAINER="n8n"
TGZ="welsonviana-n8n-nodes-generic-rest-chat-model-AI-0.1.0.tgz"
NO_RESTART=false

# Processar argumentos
for arg in "$@"; do
  case $arg in
    --no-restart) NO_RESTART=true ;;
    *) echo "Argumento desconhecido: $arg"; exit 1 ;;
  esac
done

# ── 1. Verificar container ──────────────────────────────────────────────────
echo "▶ Verificando container '$CONTAINER'..."
if ! docker ps --filter "name=^${CONTAINER}$" --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
  echo "✗ Container '$CONTAINER' não está rodando. Inicie com: docker start $CONTAINER"
  exit 1
fi
echo "  ✓ Container rodando"

# ── 2. Build ────────────────────────────────────────────────────────────────
echo ""
echo "▶ Build..."
npm run build
echo "  ✓ Build concluído"

# ── 3. Pack ─────────────────────────────────────────────────────────────────
echo ""
echo "▶ Empacotando..."
npm pack --silent
echo "  ✓ Pacote criado: $TGZ"

# ── 4. Copiar para container ────────────────────────────────────────────────
echo ""
echo "▶ Copiando para container..."
docker cp "$TGZ" "$CONTAINER:/tmp/"
echo "  ✓ Arquivo copiado para /tmp/$TGZ"

# ── 5. Remover versão anterior e instalar nova ──────────────────────────────
echo ""
echo "▶ Instalando no container..."
docker exec "$CONTAINER" sh -c "
  cd /home/node/.n8n/nodes
  npm remove $PACKAGE_NAME 2>/dev/null || true
  npm install /tmp/$TGZ
" | tail -3
echo "  ✓ Pacote instalado"

# ── 6. Reiniciar n8n ────────────────────────────────────────────────────────
if [ "$NO_RESTART" = false ]; then
  echo ""
  echo "▶ Reiniciando n8n..."
  docker restart "$CONTAINER"

  echo "  Aguardando inicialização..."
  for i in $(seq 1 20); do
    sleep 2
    if docker logs "$CONTAINER" --tail 5 2>&1 | grep -q "Editor is now accessible"; then
      echo "  ✓ n8n pronto em http://localhost:5678"
      break
    fi
    if [ $i -eq 20 ]; then
      echo "  ⚠ Timeout aguardando n8n. Verifique: docker logs $CONTAINER"
    fi
  done
else
  echo ""
  echo "  ℹ Restart pulado (--no-restart). Reinicie manualmente: docker restart $CONTAINER"
fi

# ── 7. Limpeza ───────────────────────────────────────────────────────────────
rm -f "$TGZ"

echo ""
echo "✓ Deploy concluído!"
echo "  Recarregue o browser com Ctrl+Shift+R para limpar cache do ícone."
