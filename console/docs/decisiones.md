# Decisiones de GameConsole

Las decisiones de GameStats para la consola (C01 a C04) están en [`docs/decisiones.md`](../../docs/decisiones.md) de la raíz.

| Fecha | Decisión | Motivo |
| --- | --- | --- |
| 2026-11-06 | La consola vive en `console/` dentro del repo de GameStats, sin submódulo: usa el GameStats de la misma rama. Las rutas del plan (`shared/`, `web/`, `server/`, `docs/`, `README.md`...) se leen relativas a `console/` | Decisión de Andrés: un solo repo. El tag `v2.0.0` y las fechas de los commits marcan lo entregado en el Proyecto 1, y `v2.1.0` lo que la consola necesita de GameStats |
| 2026-11-06 | La CI de la consola es un job más del `.github/workflows/ci.yml` de la raíz | Un solo repo, una sola CI que corre en cada push |
| 2026-11-06 | Node 20 como mínimo (`engines`); las imágenes y la CI usan Node 20 | Lo pide el plan; las versiones de cada paquete van fijas en `package.json` y `package-lock.json` |
| 2026-11-06 | Versiones: TypeScript 5.9, Vite 5.4, Vitest 2.1, ESLint 9 con `typescript-eslint` 8 (reglas `strict`) y Prettier 3 | Las últimas de cada versión mayor que pide el plan; Vitest 2 es la que corre sobre Vite 5 |
| 2026-11-06 | Fastify 5.12 en vez de Fastify 4 | `npm audit` marca en Fastify 4 vulnerabilidades altas que solo se corrigieron en la rama 5, y la 4 ya no tiene soporte. La API que usa la consola es la misma |
| 2026-11-06 | Se acepta el aviso moderado de esbuild que trae Vite 5 | Afecta solo al servidor de desarrollo (`npm run dev`), no a la imagen de producción; corregirlo obliga a Vite 6 y Vitest 3. `npm audit --omit=dev` da 0 |
| 2026-11-06 | `npm run dev` usa un script propio (`scripts/dev.mjs`) para levantar servidor y Vite juntos | Evita una dependencia más y funciona igual en Windows |
| 2026-11-06 | `e2e/` queda como workspace vacío hasta C20 | Playwright descarga navegadores; se instala cuando hay pruebas que lo usen |
