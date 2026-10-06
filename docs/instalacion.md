# Instalación

GameStats se instala en cualquier computadora que tenga Docker. No hace falta instalar Go, Java ni sbt: el instalador compila todo desde el código fuente dentro de contenedores y deja los servicios corriendo.

## Requisitos

- Docker con Docker Compose v2 (el comando `docker compose`, con espacio).
  - Windows y macOS: Docker Desktop. En Windows necesita WSL2, que Docker Desktop ofrece activar al instalarse.
  - Linux: Docker Engine y el paquete `docker-compose-plugin`.
- Los puertos 8080 y 8081 libres.
- Unos 2 GB de disco para las imágenes y la compilación.
- Internet durante la primera instalación, para descargar las imágenes base y las dependencias de Go y Scala.

## Instalación rápida

Primero se clona el repositorio:

```bash
git clone https://github.com/AndresZum/gamestats.git
cd gamestats
```

En Linux o macOS:

```bash
./install.sh
```

En Windows, desde PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

El instalador pregunta dónde guardar los datos. Por defecto usa `./gamestats-data`, dentro del repositorio. Para no responder nada se agrega `--yes` (o `-Yes` en Windows), y para elegir otra carpeta, `--data /ruta` (o `-DataDir C:\ruta`).

La primera vez tarda entre 3 y 6 minutos, casi todo en compilar el analyzer de Scala. Las siguientes son mucho más rápidas porque Docker guarda la caché.

Al terminar, el instalador muestra las direcciones:

| Qué | Dónde |
| --- | --- |
| Tablero | http://localhost:8081/dashboard |
| API del analyzer | http://localhost:8081/api/v1/matches |
| API del ingestor | http://localhost:8080/api/v1/stats |
| Carpeta de eventos | `gamestats-data/events/` |
| Resultados en JSON | `gamestats-data/results/` |

## Qué hace el instalador

1. Verifica que Docker y Docker Compose v2 estén instalados y respondiendo. Si no, explica cómo instalarlos y se detiene.
2. Verifica que los puertos 8080 y 8081 estén libres. Si los ocupa una instalación anterior de GameStats, sigue y la actualiza; si los ocupa otro programa, se detiene y dice cuál.
3. Crea la carpeta de datos con `events/racing-pro`, `events/arena-clash`, `events/chess-lite`, `results`, `rejected`, `outbox` y `state`.
4. Escribe el archivo `.env` con la ruta de esa carpeta. En Linux y macOS también guarda el uid del usuario, para que los contenedores puedan escribir en la carpeta.
5. Corre `docker compose build`, que compila Go y Scala desde el código fuente.
6. Corre `docker compose up -d` y espera hasta 5 minutos a que los dos servicios estén sanos.

## Probar que funciona

Hay dos formas de meter partidas.

La primera es correr el simulador, que hace de consola de juegos y escribe partidas nuevas en la carpeta de eventos:

```bash
docker compose --profile demo run --rm simulator
```

Tarda unos 20 segundos. Mientras corre, el tablero muestra las partidas a medida que terminan. Cada corrida genera partidas distintas; con `SIM_SEED=42` se obtienen siempre las mismas.

La segunda es copiar un archivo de eventos a la carpeta compartida, que es lo que hará la consola de juegos de la segunda parte del curso:

```bash
cp data/samples/demo-small.jsonl gamestats-data/events/
```

En Windows:

```powershell
Copy-Item data\samples\demo-small.jsonl gamestats-data\events\
```

`demo-small.jsonl` trae 12 partidas, entre ellas los 6 escenarios que fuerzan los patrones P1 a P6. `demo-full.jsonl` trae 30. Los dos incluyen eventos inválidos a propósito, que aparecen como rechazados en `gamestats-data/rejected/rejected.jsonl` y en http://localhost:8080/api/v1/rejected.

Para revisar todo de una vez está la prueba de humo, que necesita `bash` y `curl` (en Windows sirve Git Bash):

```bash
EXPECTED_MATCHES=12 scripts/smoke-test.sh
```

## Instalación manual

Para quien prefiera hacerlo paso a paso, esto es lo mismo que hace el instalador.

```bash
mkdir -p gamestats-data/events gamestats-data/results
cat > .env <<EOF
GAMESTATS_DATA="$(pwd)/gamestats-data"
GAMESTATS_UID=$(id -u)
GAMESTATS_GID=$(id -g)
EOF
docker compose --profile demo build
docker compose up -d --wait
```

En Windows basta con que `.env` tenga la línea `GAMESTATS_DATA="C:/ruta/a/gamestats-data"`, con barras normales. Si `.env` no existe, compose usa `./gamestats-data`.

Sin Docker también se puede correr, con Go 1.22, Java 21 y sbt instalados:

```bash
cd analyzer && sbt run                         # puerto 8081
cd ingestor && go run ./cmd/ingestor           # puerto 8080, usa ../data
cd simulator && go run ./cmd/simulator --events-dir ../data/events
```

## Desinstalar

```bash
./uninstall.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Baja los contenedores, borra las imágenes de GameStats y pregunta antes de borrar la carpeta de datos. Con `--yes` conserva los datos; para borrarlos sin preguntar se agrega `--delete-data` (`-Yes -DeleteData` en Windows).

## Problemas comunes

### "Docker está instalado pero no responde"

Docker Desktop está cerrado o todavía arrancando. Hay que abrirlo y esperar a que diga "Engine running". En Linux: `sudo systemctl start docker`.

### "permission denied while trying to connect to the Docker daemon" (Linux)

El usuario no está en el grupo `docker`. Se arregla con `sudo usermod -aG docker $USER` y cerrando la sesión.

### "El puerto 8080 está ocupado por otro programa"

Suele ser otro servidor de desarrollo. Para ver cuál es: `lsof -i :8080` en Linux y macOS, o `Get-NetTCPConnection -LocalPort 8080` en PowerShell. Hay que cerrarlo y volver a correr el instalador.

### WSL2 en Windows

Docker Desktop necesita WSL2. Si al abrirlo pide actualizar el kernel de WSL, se hace desde una consola de administrador con `wsl --update` y después se reinicia Docker Desktop.

### "No se puede cargar el archivo install.ps1 porque la ejecución de scripts está deshabilitada"

Es la política de ejecución de Windows. Hay que usar el comando completo: `powershell -ExecutionPolicy Bypass -File .\install.ps1`. No cambia la configuración del sistema.

### Los servicios no quedan sanos

`docker compose logs analyzer` y `docker compose logs ingestor` muestran el motivo. En Linux, si la carpeta de datos la creó otro usuario (por ejemplo root), los contenedores no pueden escribir en ella; se arregla con `sudo chown -R $(id -u):$(id -g) gamestats-data`.

### La primera compilación falla descargando dependencias

Es un corte de red. Volver a correr el instalador sigue desde donde quedó.

### El tablero no muestra gráficos

El gráfico usa Chart.js desde internet. Sin conexión el resto del tablero funciona igual y aparece un aviso donde iría el gráfico.

## Prueba en una máquina de terceros

El instalador se prueba automáticamente en cada cambio con el job `install-test` de la CI. Ese job clona el repositorio en una máquina Ubuntu que solo tiene Docker, instala, carga `demo-small.jsonl`, corre el simulador, ejecuta la prueba de humo y desinstala.

Además, durante el desarrollo se probó en Windows 11 con Docker Desktop (`install.ps1` e `install.sh` desde Git Bash). Se verificaron:

- la instalación sin preguntas;
- la reinstalación con el sistema corriendo;
- el rechazo cuando otro programa ocupa un puerto;
- la carga de un dataset copiando el archivo;
- la desinstalación.

Pendiente: la prueba en la computadora de otra persona con capturas de pantalla, que pide el plan (T21a, punto 5).
