# Registro de decisiones

Decisiones tomadas durante la implementación que no estaban cubiertas por el plan.

| Fecha | Decisión | Motivo |
| --- | --- | --- |
| 2026-10-05 | Módulos Go con ruta `github.com/AndresZum/gamestats/...` | El plan dejaba `USUARIO` sin definir; se usa el usuario de Git del equipo |
| 2026-10-05 | El repositorio vive en la raíz de `proyecto1Lenguajes/`, sin subcarpeta `gamestats/` | Opción más simple; la estructura interna es la del plan |
| 2026-10-05 | Se agrega `simulator/internal/chess/` | T09 pide un generador de ajedrez que no aparecía en el árbol del repositorio |
| 2026-10-05 | `.gitattributes` fuerza LF (CRLF solo en `.ps1`) | En Windows, Git convierte a CRLF y los scripts `.sh` fallan dentro de contenedores Linux |
| 2026-10-05 | Una sola `.scalafmt.conf` en la raíz; `build.sbt` apunta a ella con `scalafmtConfig` | Evita duplicar la configuración de formato |
| 2026-10-05 | `make` acepta `SBT=...` para compilar Scala con la imagen `sbtscala/scala-sbt` | No todos los equipos tienen sbt instalado; con Docker alcanza |
| 2026-10-05 | La entrada por archivos usa `data/events/`, no `inbox/` | El checklist mencionaba `inbox/`, pero la especificación define `data/events/<gameId>/` |
| 2026-10-05 | Se agrega `configs/games/chess-lite.json` (T02 pedía tres configs) | Sin él, los eventos de ajedrez se rechazarían como `UNKNOWN_GAME` |
| 2026-10-05 | `playerId` puede faltar cuando el tipo no lo exige; se trata igual que `null` | Es la opción más tolerante para quien produce eventos |
| 2026-10-05 | Los campos del sobre que no están en la especificación se ignoran | Permite agregar campos en una versión futura sin romper la actual; no hay código de rechazo para ellos |
| 2026-10-05 | `matchId` solo admite letras, dígitos, `-` y `_` (máx. 128); `gameId` es minúsculas con guiones | Ambos se usan como nombres de archivo o carpeta; así se evita salir de la carpeta con `../` |
| 2026-10-05 | Go valida solo el tipo JSON de las claves de `data`, no los valores permitidos (`tire`, `itemType`, `severity`) | El formato de configuración del plan solo describe tipos; Scala ignora valores desconocidos |
| 2026-10-05 | Un juego no puede redefinir un tipo de `_common.json`; si lo hace, el `ingestor` no arranca | Cumple "sin tipos repetidos" y evita reglas ambiguas |
| 2026-10-05 | El patrón de `timestamp` usa `[.]` en vez de `\.` | Evita errores de escape al editar el JSON |
