# Cartera Personal — PWA

App de finanzas personales con datos en tiempo real de cripto (CoinGecko) y acciones, ETFs e índices (Yahoo Finance). Instalable en iPhone como app nativa.

## Archivos

- `index.html` — App completa (React + búsqueda dinámica + gráficos)
- `manifest.json` — Manifiesto PWA
- `sw.js` — Service Worker (offline shell)
- `icon-180.png` `icon-192.png` `icon-512.png` `icon-512-maskable.png` — Iconos

---

## Cómo ponerla en el iPhone como app

Una PWA en iOS necesita servirse desde **HTTPS**. Tres opciones rápidas:

### Opción 1 — Netlify Drop (más fácil, gratis, 30 segundos)

1. Andá a [app.netlify.com/drop](https://app.netlify.com/drop)
2. Arrastrá la carpeta `finanzas-pwa` completa a la página
3. Te dará una URL del estilo `https://nombre-aleatorio.netlify.app`
4. En el iPhone abrí esa URL en **Safari** (no Chrome)
5. Tocá el botón **Compartir** (cuadrado con flecha hacia arriba)
6. Bajá y elegí **"Añadir a pantalla de inicio"**
7. Listo: la app aparece en tu home con el icono "C" cobre

### Opción 2 — Vercel

1. Crear cuenta en [vercel.com](https://vercel.com)
2. `vercel deploy` desde la carpeta, o subir por la web
3. Mismo paso 4-7 que arriba

### Opción 3 — GitHub Pages

1. Subir la carpeta a un repo público
2. Activar Pages en Settings → Pages → branch main
3. Acceder a `https://tuusuario.github.io/repo/`
4. Mismo paso 4-7

---

## Sobre las APIs

- **CoinGecko**: API pública gratuita, ~17.000 criptos. Sin clave necesaria. Hay un límite suave de ~30 llamadas/min.
- **Yahoo Finance**: no tiene API oficial; usamos su endpoint público de búsqueda y cotizaciones a través de un proxy CORS porque el navegador no permite llamarlos directo. Para no depender de un único proxy, se prueba una cadena de proxies públicos en orden (`corsproxy.io`, luego `api.allorigins.win`) y se usa el primero que responde.
- **Caché de precios**: el último precio conocido de cada activo se guarda en `localStorage` (`cartera:prices:v1`). Si falla la red o todos los proxies están caídos, la app sigue mostrando esos últimos precios en vez de quedar en blanco, marcados como "precio desactualizado" en cada posición.

**En producción real**, conviene reemplazar los proxies públicos por un backend propio (un Worker de Cloudflare hace este trabajo en 20 líneas y es gratis) para evitar depender de servicios de terceros que pueden caerse o limitarse.

---

## Actualizar dependencias del CDN

React, ReactDOM, PropTypes y Recharts se cargan desde unpkg.com con versión
exacta pineada (no rangos como `@18`) y [Subresource Integrity](https://developer.mozilla.org/es/docs/Web/Security/Subresource_Integrity)
(`integrity="sha384-..."`), para que el navegador rechace el script si
unpkg sirviera contenido distinto al esperado. Para subir de versión:

1. Bajar el paquete exacto desde el registro de npm (no desde unpkg
   directo, para no depender de la misma CDN que se está pineando):
   `npm pack react@X.Y.Z` (o el paquete que corresponda).
2. Extraer el archivo UMD que usa `index.html` (ej. `umd/react.production.min.js`).
3. Calcular el hash: `openssl dgst -sha384 -binary umd/react.production.min.js | openssl base64 -A`
4. Actualizar la versión en la URL del `<script>` y pegar el hash en
   `integrity="sha384-<hash>"`.

---

## Características

- Búsqueda en vivo de cualquier cripto, acción, ETF o índice
- Resumen claro: plata invertida + interés ganado = total actual
- Gráfico de evolución temporal (24H, 7D, 1M, 3M, 1A)
- Gráfico de torta con distribución por activo
- Cambio 24h ponderado de toda la cartera
- Auto-refresh cada 60 segundos
- Persistencia local (localStorage) — los datos viven en tu dispositivo
- Funciona offline (cuando hay datos cacheados)
- Diseño optimizado para iPhone con safe areas

---

## Privacidad

La app no envía tus posiciones a ningún servidor. Todo se guarda en `localStorage` del navegador. Solo se hacen llamadas a las APIs de mercado para obtener precios públicos.
