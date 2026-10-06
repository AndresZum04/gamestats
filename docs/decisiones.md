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
