# rollsuite-updater

Standalone Windows updater. Um binário Go (~2 MB, subsistema GUI, sem console)
que é chamado pelo app quando há update nativo. Ele espera o `RollsSuite.exe`
encerrar, extrai o zip baixado, substitui os arquivos da pasta de instalação
(com retry contra locks) e relança o app.

## Build

```
./build.sh
```

Gera `../electron/bin/updater.exe`. Esse arquivo é copiado ao lado de
`RollsSuite.exe` pelo `upload-native.cjs` antes de zipar o pacote nativo.

## CLI

```
updater.exe --pid <pid> --zip <zip> --install <dir> --exe RollsSuite.exe \
            [--version <v>] [--legacy old1.exe,old2.exe] [--log <path>]
```
