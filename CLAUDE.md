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
  `computePortfolioTotals`. Los componentes de React dentro de
  `index.html` no tienen tests automatizados (verificarlos sirviendo el
  archivo localmente, ej. `python3 -m http.server`, y probando a mano).
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
- Paleta: fondo `#0F0E0C`, acento dorado `#D4A574`, texto `#E8DFD3`,
  texto secundario `#8B7E6E`, positivo `#7FB069`, negativo `#D67B6A`.
  Tipografías: `Fraunces` (serif, clase `.serif`) para títulos/cifras
  grandes, `JetBrains Mono` (clase `.mono`) para datos/labels.
- Copy de UI en español (Argentina/neutro).
- Manejo de errores: las funciones que llaman a APIs externas atrapan
  errores y devuelven un valor vacío (`{}`/`[]`/`null`) en vez de
  propagar la excepción, para que un fallo de red no rompa el render.

## Modelo de datos y localStorage

- `cartera:holdings:v2` — array de holdings del usuario. Forma actual de
  un holding:
  ```js
  {
    id, source /* 'coingecko' | 'yahoo' */, sourceId, symbol, name,
    assetType, amount, buyPrice, addedAt
  }
  ```
  `amount`/`buyPrice` representan cantidad total y precio de compra
  **promedio** — no hay historial de transacciones individuales (queda
  como mejora futura, ver Notas de secuenciación en el plan de esta
  ronda).
- Historial de `STORAGE_KEY`: solo existió `v2` hasta ahora. Si se cambia
  la forma del dato guardado, **bumpear la versión de la key y escribir
  una migración que no borre la key vieja** (los usuarios ya tienen datos
  reales en `localStorage`).

## Capa de APIs

- CoinGecko (cripto): API pública, se llama directo desde el browser, sin
  proxy.
- Yahoo Finance (acciones/ETFs/índices): no tiene API pública con CORS
  habilitado, así que se llama a través de un proxy CORS público. Ver el
  código para el mecanismo de fallback vigente (si ya se implementó la
  Fase 2 de robustez) y `README.md` → "Sobre las APIs" para el detalle.
