# OC-37 closure + bottom-sheet safe-area inset — Design

## Investigación (ya confirmada, no requiere más research)

De las 4 áreas listadas en OC-37 ("Safe areas incl. Dynamic Island, swipe-back gesture vs custom
headers, background/foreground stream resume, Face ID gate"), 3 ya están resueltas o no aplican:

- **Safe areas / Dynamic Island**: ya bien manejado — `expo-router` envuelve toda la app en
  `SafeAreaProvider` automáticamente, `EnvironmentBadge.tsx` absorbe el inset de arriba una sola
  vez de forma global (`edges={['top']}`), y `Screen.tsx`/`SidebarLayout` excluyen `top`
  deliberadamente para no duplicar el padding — documentado inline en ambos. Sin valores de
  píxeles hardcodeados en ningún lado.
- **Swipe-back gesture vs custom headers**: no existe el conflicto — toda la navegación
  (`app/_layout.tsx`, `app/(auth)/_layout.tsx`, `app/(tabs)/_layout.tsx`) usa `headerShown: false`,
  cero headers nativos o custom en toda la app, `gestureEnabled` nunca se pone en `false`. El
  "Volver" de `app/(auth)/totp.tsx` es un link en contenido, no un botón de header — coexiste bien
  con el gesto nativo de swipe (ambos simplemente hacen pop del stack).
- **Background/foreground stream resume**: ya implementado — `StreamContext.tsx` ya tiene un
  listener de `AppState` que llama `client.reconnectNow()` al volver a `'active'`.
- **Face ID gate**: ya shippeado completo como **OC-46** (`✅ Done 2026-08-15`,
  `src/auth/AppLockGate.tsx`/`AppLockScreen.tsx`, con dos rondas de fix documentadas).

**Único detalle real encontrado**: `ConfirmByTypingSheet.tsx` (un bottom sheet genuino, anclado al
borde inferior de la pantalla) y `StepUpPrompt.tsx` (un modal centrado, pero puede acercarse al
borde inferior si su contenido crece) no usan `useSafeAreaInsets`/`SafeAreaView` — podrían quedar
pegados al home indicator en iPhones sin botón físico (todo iPhone desde el X en adelante).

## Alcance

1. **`ConfirmByTypingSheet.tsx`**: envolver el contenido scrolleable en un `SafeAreaView
   edges={['bottom']}` (mismo patrón ya establecido en `Screen.tsx`), dentro de la `View` con
   `max-h-[85%]` y por fuera del `ScrollView` — así el inset de abajo se agrega como espacio extra
   fuera del padding existente (`p-6`), sin duplicar ni reemplazar ese padding.
2. **`StepUpPrompt.tsx`**: mismo tratamiento, por consistencia con el sheet hermano (mismo patrón
   ya usado para el `ScrollView` en el ticket de orientación, aplicado a los dos por igual aunque
   uno lo necesite más que el otro).
3. **Cerrar OC-37 en el backlog** documentando las 3 áreas ya resueltas (con referencias a dónde
   se puede confirmar cada una) y este fix chico como la única pieza de código real.

## Fuera de alcance

- No se toca `KeyboardShortcutsHelp.tsx` — es un modal centrado sin campo de texto, sin riesgo real
  de acercarse al borde inferior dado su contenido corto y fijo.
- No se reabre ni se toca nada de OC-46 (Face ID) — ya está shippeado y no forma parte de este fix.
- No se agrega ninguna dependencia — `react-native-safe-area-context` ya está instalado y en uso.

## Verificación

- `npx tsc --noEmit`, `npm run lint`, `npm run format:check` limpios.
- No hay test runner. Verificación manual real en Simulador iOS (un iPhone con home indicator,
  ej. iPhone 17): abrir un `ConfirmByTypingSheet` real y un `StepUpPrompt` real, confirmar que el
  contenido (especialmente el botón "Cancelar") no queda pegado al home indicator, con espacio
  visible entre el contenido y el borde inferior de la pantalla.
