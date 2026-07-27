# CLAUDE.md

Guía para trabajar en este repo (Tu Cartera / Cartera Personal).

## Qué es esto

Una PWA de finanzas personales (cripto + acciones/ETFs/índices) en un único
`index.html`, sin backend. Ver `README.md` para la historia de usuario
(instalación en iPhone, deploy en Netlify/Vercel/GitHub Pages) y para el
detalle de las APIs de mercado usadas.

## Arquitectura: sin build, a propósito

- `index.html` contiene toda la app: estilos inline en `<style>`, y los
  componentes de React escritos con `React.createElement` (sin JSX, sin
  transpilación) en un `<script>` al final del `<body>`.
- React, ReactDOM, PropTypes y Recharts se cargan como UMD desde unpkg vía
  `<script>` tags — no hay `npm run build`, no hay bundler, no hay
  `node_modules` en producción.
- Esto es intencional: el proyecto se despliega arrastrando la carpeta a
  Netlify Drop / subiendo a GitHub Pages, sin paso de compilación. **No
  introducir un bundler, JSX o TypeScript sin discutirlo antes con el
  usuario** — es una decisión de arquitectura explícita, no un descuido.
- `js/portfolio-utils.js` es la única excepción: un módulo con lógica pura
  (ver abajo) que se cargó aparte únicamente para poder testearla con
  Vitest. Sigue siendo un `<script>` clásico sin build — usa un wrapper
  UMD-lite para poder usarse tanto como `window.PortfolioUtils` en el
  navegador como vía `require`/`import` en los tests.

## Testing

- `npm install && npm test` corre la suite de Vitest.
- `package.json` es **solo para testing** (Vitest como única
  devDependency) — no implica ni un dev server ni un paso de build para el
  sitio en sí.
- Solo se testea lógica pura, extraída a `js/portfolio-utils.js`:
  `formatCurrency`, `formatNumber`, `computeHoldingMetrics`,
  `computePortfolioTotals`, `isStale`, `mergePriceCache`,
  `deriveHoldingPosition`, `computeRealizedGain`, `migrateHoldingsV2ToV3`,
  `checkAlertTriggers`. Los componentes de React dentro de `index.html` no
  tienen tests automatizados (verificarlos sirviendo el archivo
  localmente, ej. `python3 -m http.server`, y probando a mano).
- Convención de tests: colocados junto al archivo que testean
  (`js/portfolio-utils.js` → `js/portfolio-utils.test.js`). Seguir ese
  patrón si se agregan más funciones puras.
- Al extraer nueva lógica pura de `index.html`, agregarla a
  `js/portfolio-utils.js` (no crear módulos nuevos sin necesidad) y
  actualizar el destructuring `const { ... } = PortfolioUtils;` en
  `index.html`.

## Convenciones de código

- Sin JSX: todo con `React.createElement(tag, props, ...children)`.
- Estilos como objetos JS inline (`style: {...}`), no CSS Modules ni
  styled-components. Clases CSS (`.mono`, `.serif`, `.grain`, etc.) solo
  para lo que no puede ser inline (animaciones, pseudo-elementos,
  scrollbars).
- Paleta: variables CSS definidas en `:root` (tema oscuro, default) y
  sobreescritas en `:root[data-theme="light"]` (ver "Modo claro/oscuro"
  abajo) — `--bg`, `--text`, `--text-secondary`, `--gold`, `--positive`,
  `--negative`, más sus variantes `-rgb` (terna `R, G, B` sin `rgba()`,
  para poder componer `rgba(var(--gold-rgb), 0.25)` con opacidades
  variables). Los `style: {...}` inline de React usan estos tokens como
  string (`background: 'var(--bg)'`), nunca los hex directamente, excepto
  en los pocos casos documentados en "Modo claro/oscuro" que quedan fijos
  a propósito. Tipografías: `Fraunces` (serif, clase `.serif`) para
  títulos/cifras grandes, `JetBrains Mono` (clase `.mono`) para
  datos/labels.
- Copy de UI en español (Argentina/neutro).
- Manejo de errores: las funciones que llaman a APIs externas atrapan
  errores y devuelven un valor vacío (`{}`/`[]`/`null`) en vez de
  propagar la excepción, para que un fallo de red no rompa el render.

## Modelo de datos y localStorage

- `cartera:holdings:v3` (key activa) — array de holdings del usuario.
  Forma actual de un holding:
  ```js
  {
    id, source /* 'coingecko' | 'yahoo' */, sourceId, symbol, name,
    assetType, addedAt,
    transactions: [
      { id, type /* 'buy' | 'sell' */, amount, price, date }
    ]
  }
  ```
  `amount`/`buyPrice` **ya no se guardan**: se derivan de `transactions`
  con `PortfolioUtils.deriveHoldingPosition` (costo promedio ponderado —
  una venta no cambia el costo promedio de lo que queda; no es FIFO/LIFO).
  El resultado se mezcla en el holding antes de pasarlo a
  `computeHoldingMetrics`, así que esa función no sabe ni le importa que
  por dentro hay transacciones.
- Validación de venta/borrado: tanto agregar una venta mayor a la cantidad
  actual como borrar una compra que dejaría una venta posterior sin stock
  quedan bloqueados en la UI (`TransactionsModal`), chequeando solo la
  posición derivada **final**, no cada paso intermedio de una secuencia
  con fechas retroactivas — limitación aceptada, no un bug a perseguir.
- Historial de `STORAGE_KEY`: `cartera:holdings:v2` (legado, `amount`/
  `buyPrice` planos, sin transacciones) → `cartera:holdings:v3` (agrega
  `transactions[]`). La migración (`migrateHoldingsV2ToV3`, pura, en
  `js/portfolio-utils.js` + `migrateHoldingsIfNeeded`, impura, en
  `index.html`) corre una sola vez, es idempotente, y **nunca borra ni
  reescribe `v2`** — queda como backup de solo lectura para siempre. Si se
  cambia la forma del dato guardado de nuevo, seguir el mismo patrón:
  bumpear la versión de la key y escribir una migración que no borre la
  key vieja (los usuarios ya tienen datos reales en `localStorage`).
- `cartera:alerts:v1` (key activa, greenfield — sin migración) — array de
  alertas de precio. Forma:
  ```js
  {
    id, source, sourceId, symbol,
    direction /* 'above' | 'below' */, threshold,
    createdAt, enabled, active, triggeredAt, bannerDismissedAt
  }
  ```
  Las alertas se referencian por `source`+`sourceId` (igual clave
  compuesta que usa `cartera:prices:v1`), **no** por `holdingId` — así
  sobreviven a borrar y volver a agregar el mismo activo: `handleRemove`
  deja las alertas de ese activo con `enabled: false` (nunca las borra) si
  ningún otro holding remanente comparte esa fuente, y `handleAdd` las
  reactiva (`enabled: true`) si se vuelve a agregar. Semántica de disparo:
  histéresis con auto-rearme — `active` pasa a `false` al dispararse y
  solo vuelve a `true` cuando el precio cruza de nuevo al lado no
  disparado, sin volver a notificar en ese rearme (evita spam sin
  necesitar un reset manual). `checkAlertTriggers` (pura, en
  `js/portfolio-utils.js`) implementa esta máquina de estados.

## Notificaciones (Notification API)

- Las alertas de precio usan la API `Notification` del navegador para
  notificaciones locales — **no hay push real de servidor** (el proyecto
  no tiene backend). El chequeo corre en el `useEffect` sobre `[prices]`
  (que se dispara con la carga inicial, el intervalo de 60s existente, y
  "Actualizar" manual), así que no llegan notificaciones si la app está
  completamente cerrada.
- El permiso se pide **solo** con un gesto directo del usuario (click en
  "Crear alerta" en `AlertModal`), nunca al cargar la página.
- Siempre se muestra vía `ServiceWorkerRegistration.showNotification()`
  (nunca `new Notification()` directo) porque Safari en Mac/iOS solo
  soporta esa forma — `sw.js` ya se registra al cargar la página, no hace
  falta tocarlo para esto.
- En iOS hace falta 16.4+ y la PWA instalada ("Agregar a inicio"); en una
  pestaña normal de Safari, `Notification` puede no existir o no
  funcionar — siempre se chequea con feature-detection, nunca se asume
  disponible.
- El banner in-app (`bannerAlerts`/`alertsBanner` en `index.html`)
  funciona siempre, sin importar el estado del permiso
  (`granted`/`denied`/`default`/no soportado) — la notificación del
  navegador es aditiva, nunca una dependencia dura.

## Modo claro/oscuro

- `THEME_KEY = 'cartera:theme:v1'` en `localStorage` (`'dark'` por
  defecto). El `<html>` lleva `data-theme="dark"|"light"`, seteado
  sincrónicamente por un script chico en el `<head>` (antes de que cargue
  React, para no mostrar un flash del tema equivocado) y luego mantenido
  por el estado `theme` de `App` (toggle: ícono sol/luna junto a "En
  vivo").
- Los valores hex de la paleta viven **solo** en las definiciones
  `:root`/`:root[data-theme="light"]` del `<style>` de `index.html`; todo
  lo demás en el archivo referencia `var(--token)`. Si se agrega un color
  nuevo a la paleta, agregarlo ahí (con su variante `-rgb` si se necesita
  con opacidad) y usar `var(--token)` en el JS, nunca un hex suelto.
- Simplificaciones aceptadas, no deuda a resolver: el array `COLORS` de la
  torta de distribución (colores categóricos) y el fondo del ticker de
  cabecera (`#000`) quedan fijos en ambos temas; el overlay de fondo de
  los modales (`rgba(0, 0, 0, 0.85)`) también, porque funciona como scrim
  sobre el contenido sin importar el tema de la página.
- El color "texto sobre dorado" (botones/toggles activos) queda
  hardcodeado a `#0F0E0C` en vez de usar una variable — es intencional:
  necesita quedar oscuro tanto en el dorado del tema oscuro como en el
  dorado (más oscuro) del tema claro.

## Capa de APIs

- CoinGecko (cripto): API pública, se llama directo desde el browser, sin
  proxy.
- Yahoo Finance (acciones/ETFs/índices): no tiene API pública con CORS
  habilitado, así que se llama a través de una cadena de proxies CORS
  públicos (`CORS_PROXIES` + `fetchWithProxyFallback`, prueba cada uno en
  orden). Los precios se cachean en `localStorage` (`cartera:prices:v1`)
  para poder mostrar el último precio conocido con un aviso de
  "desactualizado" por activo si todas las fuentes fallan, en vez de dejar
  la UI en blanco. Ver `README.md` → "Sobre las APIs" para el detalle.
