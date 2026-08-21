# Fix: Web (y probablemente Android) rotos por `ServerStatusActivity.tsx` — Design

Bug urgente encontrado durante la verificación manual de OC-35 (atajos de teclado), documentado
en la fila de OC-35 de `docs/backlog.md` y confirmado por Matías para arreglar ahora.

## Causa raíz (ya confirmada por investigación, no requiere debugging adicional)

`src/features/status/ServerStatusActivity.tsx` (OC-47, Live Activity de iOS) hace, a nivel de
módulo:

```ts
import { Text, VStack } from '@expo/ui/swift-ui';
```

Ese import ejecuta código real al cargar el módulo — `@expo/ui/swift-ui`'s `Text` llama a
`requireNativeView('ExpoUI', 'TextView')` en su propio nivel de módulo
(`node_modules/@expo/ui/src/swift-ui/Text/index.tsx:68`), lo cual tira siempre fuera de iOS
(SwiftUI no existe en Web ni Android). Como `(tabs)/index.tsx` → `StatusScreen.tsx` →
`useServerStatusLiveActivity.ts` → `ServerStatusActivity.tsx` es el tab por defecto (`/`,
Status), Web lo carga inmediatamente (Expo Router construye su manifest eagerly) y Android
también lo cargaría en cuanto se abra la app (Status es la pantalla de inicio) — **este bug no
es solo de Web, probablemente también rompe Android hoy**, simplemente no se detectó porque la
verificación en vivo de OC-47 fue solo en Simulador iOS.

Importante: `expo-widgets` (el paquete que sí expone `createLiveActivity`/`.start()`/
`.getInstances()`/etc.) **ya resuelve esto correctamente** — tiene `ExpoWidgets.ios.js` (real,
nativo) y un `ExpoWidgets.js` genérico de fallback con clases stub no-operativas
(`LiveActivityFactoryStub`, `LiveActivityStub`) que Metro elige automáticamente en Web/Android.
El único problema es que `@expo/ui/swift-ui` no tiene ese mismo split, y el archivo del app lo
importa incondicionalmente.

`layout` (la función marcada `'widget'`) tampoco puede usarse tal cual fuera de iOS: por diseño,
esa función se extrae y recompila en un runtime nativo separado en tiempo de build (el plugin de
babel de `expo-widgets`), así que aunque se lograra evitar el crash del import, la función no
tiene ningún rol fuera de ese pipeline nativo.

## Fix: split por plataforma, patrón estándar de React Native/Metro

Metro resuelve `./ServerStatusActivity` (import sin extensión, ya usado tal cual en
`useServerStatusLiveActivity.ts:6`) a un archivo específico de plataforma si existe
(`.ios.tsx` en iOS), y cae al archivo genérico sin sufijo en cualquier otra plataforma (Android,
Web) — nunca resuelve ni evalúa el archivo `.ios.tsx` fuera de iOS, así que el import problemático
jamás se ejecuta en Web/Android.

### Archivos

1. **`src/features/status/ServerStatusActivityState.ts`** (nuevo) — extrae el tipo
   `ServerStatusActivityState` (hoy definido dentro de `ServerStatusActivity.tsx`) a su propio
   archivo, sin ninguna dependencia — evita duplicar la definición del tipo entre la versión iOS
   y el stub, que se desincronizarían con el tiempo si se copian a mano.

2. **`src/features/status/ServerStatusActivity.ios.tsx`** (renombrado desde
   `ServerStatusActivity.tsx`) — contenido idéntico al actual, solo cambia el import del tipo
   (`import type { ServerStatusActivityState } from './ServerStatusActivityState'` en vez de
   definirlo localmente) y ya no re-exporta el tipo (ahora vive en el archivo compartido).

3. **`src/features/status/ServerStatusActivity.ts`** (nuevo, sin sufijo — Android/Web lo reciben
   por default de Metro) — mismo `export const serverStatusActivity = createLiveActivity(...)`,
   pero con un `layout` trivial que no importa `@expo/ui/swift-ui` en absoluto (retorna `null` en
   los cuatro campos — `banner`/`compactLeading`/`compactTrailing`/`minimal`, todos tipados como
   aceptan `ReactNode`, así que `null` tipa bien sin necesitar `Text`/`VStack` reales). Como
   `expo-widgets`'s propio stub (`LiveActivityFactoryStub`) ignora el parámetro `layout` por
   completo fuera de iOS, este `layout` de relleno nunca se ejecuta — solo existe para satisfacer
   el tipo `LiveActivityComponent<ServerStatusActivityState>` que pide `createLiveActivity`.

`useServerStatusLiveActivity.ts` **no cambia** — sigue importando desde `./ServerStatusActivity`
(sin extensión), y Metro resuelve al archivo correcto por plataforma automáticamente; ambos
archivos exportan exactamente el mismo nombre (`serverStatusActivity`) con el mismo tipo.

## Fuera de alcance

- No se toca la lógica de `useServerStatusLiveActivity.ts` — su `toggle`, sus efectos de
  reconciliación (`getInstances()`), y el resto del hook ya delegan todo a `serverStatusActivity`,
  que en Web/Android ahora es el stub no-operativo correcto (mismo comportamiento que ya tenía
  `expo-widgets` en esas plataformas antes de este bug — la UI de Status en esas plataformas
  simplemente no ofrece Live Activity, que es justo lo esperado: es una feature de iOS).
- No se agrega ningún mensaje/UI explicando "Live Activity no disponible en esta plataforma" —
  fuera del alcance de este fix urgente, y `StatusScreen.tsx` ya trata `active`/`toggle` como
  datos opcionales sin asumir que siempre hacen algo visible (a confirmar en el task, pero no se
  espera tocar `StatusScreen.tsx` en absoluto).

## Verificación

- `npx tsc --noEmit`, `npm run lint`, `npm run format:check` limpios.
- **Web**: `npx expo start --web` debe cargar `/` (Status) sin el crash de
  `requireNativeViewManager`, verificado en navegador real.
- **iOS — regresión, no solo el fix**: esta es una feature ya shippeada y verificada en vivo
  (OC-47) sobre Simulador real. El split de archivo no debe cambiar ningún comportamiento en
  iOS — se requiere una verificación real (`expo prebuild -p ios --clean` + `expo run:ios` +
  Simulador), no solo lectura de código, confirmando que la Live Activity todavía arranca,
  actualiza y termina igual que antes del fix.
- **Android** (best-effort, si el tiempo lo permite): confirmar que la app al menos arranca y
  muestra Status sin crashear — no se espera tener que verificar contenido de Live Activity ahí
  (nunca existió en Android, el stub es lo esperado).
