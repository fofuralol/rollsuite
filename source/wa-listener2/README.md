# Zapo2 — Standalone

Versão independente do Zapo. **Não precisa do site**: as notificações de mensagem e o envio (templates PIX) acontecem dentro do próprio app.

## Pré-requisitos
- Node.js 20+ (https://nodejs.org)
- Windows 10/11 x64

## Build (PowerShell na pasta)
```powershell
npm install
npm run package:win
```
`.exe` final em `release\Zapo2-win32-x64\Zapo2.exe`.

## Como funciona
- **Aba Conexão**: escaneia o QR uma vez.
- **Aba Mensagens**: feed local — toda mensagem que casa com palavras-chave dos grupos monitorados aparece aqui, com notificação nativa do Windows.
- **Aba Enviar PIX**: salva templates (nome / chave / banco / texto). Escolhe o grupo de destino e envia direto.
- **Aba Config**: lista grupos monitorados, palavras-chave, som/notificação.

Dados em `wa-listener2-data\` ao lado do `.exe` (sessão WhatsApp, config, histórico, templates PIX).

> Use número secundário no WhatsApp (bibliotecas não oficiais têm risco de ban).
