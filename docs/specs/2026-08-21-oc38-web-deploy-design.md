# OC-38: Web deploy — Design

Cierra el ciclo cross-repo: `xindeler-zuul`'s ZG-58 ya está mergeado (sirve el export estático de
esta app vía `tower-http::ServeDir`, mismo origen `zuul.xindeler.com`). Esta ticket es la mitad
que falta del lado del cliente: producir el export y subirlo, más el fix del CSP que Matías eligió
resolver acá en vez de aflojar la política de Zuul.

## 1. Fix del CSP — `public/index.html` custom

**Confirmado contra la fuente real instalada de Expo, no supuesto**: el mecanismo real para
overridear el `index.html` que genera `expo export --platform web` es un archivo
`public/index.html` en la raíz del proyecto (`EXPO_PUBLIC_FOLDER`, default `"public"`,
`getTemplateIndexHtmlAsync` lo busca ahí primero, cae al template embebido de Expo si no existe).
No es `web/index.html` — esa era una suposición equivocada de ZG-58's propio design doc, corregida
acá tras verificar el código fuente real.

El template por defecto de Expo trae un `<style id="expo-reset">` inline (el reset de layout que
React Native Web necesita — `html,body{height:100%}`, `body{overflow:hidden}`,
`#root{display:flex;height:100%;flex:1}`). La CSP de Zuul (`style-src 'self'`, sin
`unsafe-inline`) lo bloquearía.

**Fix**: crear `public/index.html` (copia del template real de Expo, verbatim, con el único
cambio de mover el contenido de `#expo-reset` a un archivo separado) y `public/expo-reset.css`
(el mismo CSS, ahora en un archivo real), linkeado con `<link rel="stylesheet" href="/expo-reset.css">`
en vez de `<style>` inline. `public/` se copia tal cual al output de `expo export`, así que
`expo-reset.css` termina sirviéndose desde el mismo origen — cumple `style-src 'self'` sin aflojar
nada.

## 2. Nuevo perfil de entorno `public`

`src/config/environments.ts` hoy solo tiene `mock`/`wireguard` (`EnvironmentId` es un union de 2
valores) — confirmado en la investigación previa de esta ticket, el perfil `public` nunca se
agregó en código pese a que `zuul.xindeler.com` ya existe y está en producción real. Se agrega:

```ts
export type EnvironmentId = 'mock' | 'wireguard' | 'public';

export const ENVIRONMENTS: Record<EnvironmentId, Environment> = {
  mock: { ... },      // sin cambios
  wireguard: { ... }, // sin cambios
  public: {
    id: 'public',
    label: 'Público',
    baseUrl: 'https://zuul.xindeler.com',
  },
};
```

`DEFAULT_ENVIRONMENT_ID` se queda en `'mock'` — no se toca. El build Web desplegado en producción
sigue arrancando en `mock` por default como cualquier otro build, y el operador cambia a `public`
manualmente vía `EnvironmentSwitcher`, mismo patrón ya establecido en toda la app: el entorno
activo nunca se asume, siempre es una elección visible y explícita (`docs/skills/ops-run`: "you
should never be one tap from stopping a live server you thought was the mock").

## 3. CI de deploy — GitHub Actions

Nuevo workflow, `.github/workflows/deploy-web.yml`, separado del `ci.yml` existente (que solo
hace typecheck/lint/format en cada push/PR):

- **Trigger**: push a `development` (la rama principal real de este repo) — no en PRs, no en
  `main`. Se agrega también `workflow_dispatch` para poder disparar un deploy manual sin esperar
  un push, útil para el primer deploy real una vez que los secrets estén configurados.
- **Pasos**: checkout, `npm ci`, `npx expo export --platform web`, subir el directorio de salida
  (`dist/`) al VPS vía `rsync` sobre SSH a `WEB_DIST_DIR=/opt/xindeler-zuul/web` (el path que
  ZG-58 ya espera), con `--safe-links` (hardening pedido explícitamente por la revisión final de
  ZG-58, finding M-1: `tower-http::ServeDir` sigue symlinks sin guard contra que apunten fuera del
  directorio servido — `--safe-links` hace que `rsync` nunca escriba un symlink que apunte afuera
  del árbol sincronizado).
- **Secrets necesarios, a agregar por Matías en la configuración de GitHub del repo** (no algo que
  esta sesión pueda hacer — son credenciales, y agregar secrets a un repo real es una acción que
  le corresponde a él): `VPS_SSH_HOST` (o hardcodeado si no es sensible — el host ya es público,
  `zuul.xindeler.com`, pero el usuario/puerto SSH del VPS sí son operativos), `VPS_SSH_USER`,
  `VPS_SSH_KEY` (clave privada, con acceso de escritura únicamente al directorio
  `/opt/xindeler-zuul/web` — idealmente una clave dedicada, no la de `mgrinberg` general, aunque
  la decisión final de qué usuario/clave usar queda en manos de Matías dado que es su VPS).
  **El workflow queda commiteado pero inerte hasta que esos secrets existan** — no rompe nada, el
  job simplemente fallaría si se dispara sin ellos configurados.

## Fuera de alcance

- No se toca `ci.yml` — el deploy es un workflow separado, con su propio trigger.
- No se agrega ningún paso de rollback/versionado del lado del cliente — `deploy.sh` de Zuul ya
  tiene su propio sistema de rollback basado en tags para el binario Rust; el web build no
  comparte ese mecanismo (decisión ya tomada en el diseño de ZG-58: deploys independientes,
  desacoplados). Si hace falta rollback del build Web en el futuro, es un ticket aparte.
- No se cachea/comprime nada especial en el paso de `rsync` más allá de lo que Expo ya produce por
  default — optimización de performance queda para después si hace falta.

## Verificación

- `npx tsc --noEmit`, `npm run lint`, `npm run format:check` limpios (el único código TS que
  cambia es `environments.ts`).
- Verificación manual real: `npx expo export --platform web` local, confirmar que
  `dist/index.html` usa el `public/index.html` custom (no el template default de Expo) y que
  `expo-reset.css` aparece linkeado, no inline. Servir el `dist/` resultante con un servidor
  estático simple localmente y confirmar que la app carga sin errores de consola (sin poder
  probar la CSP real de Zuul sin deployar, pero sí confirmar que el HTML generado tiene la forma
  correcta).
- El workflow de deploy en sí no se puede probar end-to-end sin los secrets de Matías — se deja
  documentado explícitamente en la PR que el primer disparo real requiere que él los configure.
