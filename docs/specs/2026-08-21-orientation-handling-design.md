# Manejo de orientación — Design

Tercer y último sub-ticket de OC-35 (los otros dos: atajos de teclado en Web, ✅; master-detail
de jugador, parked en tickets cross-repo). Alcance: que rotar el dispositivo no deje pantallas
mal aprovechadas o rotas, sin necesitar `orientation` bloqueado en `app.config.ts` (que ya está
en `'default'`, deliberadamente, desde OC-10/11).

## Investigación previa (confirmada, no requiere más research)

- Ningún screen usa layouts de grilla/columnas — todo es una columna vertical con `FlatList`. Nada
  se "rompe" visualmente al rotar hoy, simplemente se desaprovecha el ancho extra en apaisado
  (landscape) — coincide con lo que el diseño original de OC-10/11 ya predijo.
- `useWindowDimensions()` (usado por `useBreakpoint.ts`) ya es reactivo a rotación out-of-the-box
  (confirmado leyendo el código fuente de React Native) — cero gap ahí, cero dependencia nueva
  necesaria para detectar orientación (`width > height` alcanza).
- El safe-area (vía el `SafeAreaProvider` que `expo-router` ya envuelve automáticamente) ya es
  reactivo y correcto para landscape (el notch/Dynamic Island se mueve a un borde lateral, y
  `SidebarLayout` ya declara `edges={['left','bottom']}`).
- **El gap real**: `useBreakpoint.ts`'s regla de `WIDE_BREAKPOINT = 768` solo mira ancho. Un
  celular en landscape (ej. ~700-850px de ancho × ~350-430px de alto) puede caer de cualquier lado
  de ese umbral mientras sigue siendo "corto" — y ese es justo el peor caso hoy: el `<Tabs>` de
  abajo (bottom tab bar), sumado a `EnvironmentBadge` + `StreamStatusBanner` arriba, se come una
  fracción grande de una pantalla de ~375-430px de alto.
- Los dos modales de confirmación (`ConfirmByTypingSheet.tsx`, `StepUpPrompt.tsx`) no envuelven su
  contenido en un `ScrollView` — en una pantalla muy corta (landscape de celular chico), el
  teclado abierto (`KeyboardAvoidingView`) podría no dejar espacio suficiente para ver el
  botón "Confirmar".

## Alcance propuesto

1. **`useBreakpoint` pasa a considerar orientación, no solo ancho.** Regla: `SidebarLayout` se usa
   cuando `width >= 768` **O** cuando `width > height` (landscape) — un celular en landscape se
   beneficia del mismo tratamiento de sidebar que una tablet/desktop, en vez de forzar una bottom
   tab bar en una pantalla corta. Portrait sigue exactamente igual que hoy (sin cambios visibles
   en el caso más común).
2. **Los dos modales de confirmación pasan a ser scrolleables.** Envolver su contenido interno en
   un `ScrollView` (no el backdrop, solo la tarjeta) para que en una pantalla muy corta con el
   teclado abierto, el operador pueda scrollear hasta el botón en vez de quedar con contenido
   cortado. Cambio mínimo, mismo patrón visual, sin tocar la lógica de confirmación.
3. **`KeyboardShortcutsHelp.tsx`** (agregado en el sub-ticket anterior) recibe el mismo tratamiento
   de `ScrollView` que los otros dos, por consistencia — aunque su contenido es más corto y es
   menos probable que se corte, es el mismo patrón y toca el mismo archivo en el mismo commit
   lógico si hace falta.

## Fuera de alcance

- No se bloquea `orientation` en `app.config.ts` — sigue en `'default'`, sin cambios.
- No se rediseña ningún screen de contenido (`StatusScreen`, `PlayersScreen`, etc.) — ya son una
  columna vertical con scroll, que es exactamente lo correcto para landscape también (más ancho
  usado por el texto, sin necesidad de una grilla nueva). Agregar layouts de 2 columnas para
  aprovechar el ancho extra en landscape sería una feature nueva, no "manejo de orientación" —
  no pedida, no se inventa.
- El rail fijo de `SidebarLayout` (`w-[220px]`) no cambia — sigue siendo una fracción razonable
  del ancho incluso en el landscape más angosto considerado (~700px), y no se transforma en
  bug real.
- No se agrega `expo-screen-orientation` como dependencia — no hace falta, `useWindowDimensions()`
  ya es reactivo y suficiente para todo lo que este ticket necesita.

## Verificación

- `npx tsc --noEmit`, `npm run lint`, `npm run format:check` limpios.
- No hay test runner. Verificación manual real en Simulador iOS, rotando (`xcrun simctl` no tiene
  un comando directo de rotación, pero el Simulador de Xcode sí vía `Cmd+←`/`Cmd+→`, o
  rotando la ventana desde la app Simulator): confirmar que un celular en landscape (ej. iPhone,
  no iPad) muestra `SidebarLayout` en vez de bottom tabs, que el rail de navegación se ve bien, y
  que abrir un modal de confirmación con el teclado arriba en landscape permite scrollear hasta el
  botón "Confirmar". También confirmar que portrait normal (el caso de todos los días) no cambió
  en absoluto.
