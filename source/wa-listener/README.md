# WA Listener — Build Windows

## Pré-requisitos
- Node.js 20+ instalado (https://nodejs.org)
- Windows 10/11 x64

## Passos (PowerShell na pasta do projeto)

```powershell
npm install
npm run package:win
```

A primeira vez demora ~3-5 min (baixa Electron + Chromium do puppeteer).
O `.exe` final fica em `release\WAListener-win32-x64\WAListener.exe`.

## Usar
1. Abre `WAListener.exe`
2. Aba **Config**: cola Webhook URL + Token, lista grupos e palavras-chave, **Salvar**
3. Aba **Conexão**: **Iniciar** → escaneia o QR no WhatsApp (Aparelhos conectados)
4. Aba **Log**: vê mensagens capturadas + status do POST em tempo real

Os dados ficam em `wa-listener-data\` ao lado do .exe (config + sessão WhatsApp).
Fechar a janela minimiza pra bandeja — clique no ícone pra reabrir, ou "Sair" pelo menu da tray.

## Configuração esperada
- **Webhook URL**: `https://<seu-projeto>.supabase.co/functions/v1/whatsapp-webhook`
- **Token**: o mesmo da tabela `wa_tokens` (gerado no painel web)
- **Grupos**: um por linha, match por substring no nome do grupo (case-insensitive)
- **Palavras-chave**: uma por linha. Vazio = envia toda mensagem dos grupos selecionados.

## Avisos
- Use número secundário no WhatsApp (bibliotecas não oficiais têm risco de ban)
- Sessão fica salva — só escaneia o QR uma vez
