# OC-36a: Verificación de plataforma Android — Design

Primera de 2 partes en las que se dividió OC-36 (acordado con Matías en el chat) — esta parte
cubre las 3 áreas del ticket original que la investigación encontró ya resueltas o con una
brecha chica (back-button, notification channels, edge-to-edge). La cuarta área, Material
ripple/press states, es un gap real y grande (~25 archivos) y queda como OC-36b, ticket separado.

## Investigación previa (ya confirmada, no requiere más research)

- **Back-button**: la navegación entre tabs/screens ya la maneja `expo-router` internamente
  (`useBackButton.native.js` engancha `BackHandler` sobre `navigation.goBack()`, cero código de
  la app necesario). El botón físico/gesto de Android en un `Modal` de React Native ya dispara
  `onRequestClose` de forma nativa — los 4 modales existentes (`ConfirmByTypingSheet.tsx`,
  `KeyboardShortcutsHelp.tsx`, `StepUpPrompt.tsx`, `AppLockScreen.tsx`) ya lo tienen. No hay
  ningún `BackHandler` manual en el código — no hace falta. Único punto real: `app.config.ts`
  tiene `android.predictiveBackGestureEnabled: false` sin ningún comentario ni razón documentada
  — es el default del scaffold original de Expo (OC-3), no una decisión deliberada de este app.
- **Notification channels**: ya implementado — `PushTokenServiceImpl.native.ts`'s
  `ensureAndroidChannel()` llama a `Notifications.setNotificationChannelAsync('default', {
  importance: MAX })`, gateado a `Platform.OS === 'android'`, antes de pedir el token. Un solo
  canal, que coincide con que la app hoy solo tiene un tipo de notificación ("server caído").
  Nada que construir — solo verificar en vivo que dispara correctamente en un emulador Android.
- **Edge-to-edge**: `react-native-safe-area-context` ya se usa de forma genuinamente
  cross-platform (no asume specifics de notch de iOS) en `Screen.tsx`, `EnvironmentBadge.tsx`,
  `SidebarLayout` — así que los insets de abajo (barra de gestos de Android) deberían respetarse
  ya. El gap real: `app.config.ts` no tiene `android.edgeToEdgeEnabled` explícito, y no hay
  configuración de color/estilo de la barra de sistema de Android en ningún lado (`StatusBar
  style="light"` en `app/_layout.tsx` es cross-platform pero no cubre el nav bar de Android).
  Android 15+ (API 35) hace obligatorio el edge-to-edge — hace falta declararlo explícito y
  verificar en vivo, no asumir que ya funciona.

## Alcance

1. **`app.config.ts`**: agregar `android.edgeToEdgeEnabled: true` explícito (Android 15+ lo exige
   igual, declararlo evita sorpresas al subir el `targetSdkVersion`) y re-habilitar
   `predictiveBackGestureEnabled: true` — no hay ninguna razón documentada para tenerlo
   deshabilitado, `onRequestClose` de los modales sigue funcionando igual (el gesto predictivo es
   solo una capa de animación/preview sobre el mismo evento de back, no cambia qué se dispara),
   y es el comportamiento moderno esperado por Android 13+.
2. **Verificación en vivo real en emulador Android** (no solo lectura de código) de las 3 áreas:
   back-button cerrando modales y navegando entre tabs, notificación de "server caído" mostrando
   el canal correcto, y que el contenido no queda debajo/detrás de la barra de sistema (status
   bar / nav bar) con edge-to-edge activo.
3. **Sin cambios de código en ningún componente de UI** — este ticket es config + verificación,
   no una pasada de refactor.

## Fuera de alcance

- Material ripple / press states — OC-36b, ticket separado.
- Cualquier cambio a como se generan/envían las notificaciones push en sí (eso es OC-45, ya
  hecho) — esto solo toca el canal de Android, que ya existe.
- Múltiples canales de notificación — no hace falta hoy, la app solo tiene un tipo de alerta.

## Verificación

- `npx tsc --noEmit`, `npm run lint`, `npm run format:check` limpios (cambio es solo config,
  no debería tocar TypeScript en absoluto).
- No hay test runner. Verificación manual real en emulador Android
  (`xindeler-ops-test` AVD, per `docs/skills/ops-run`): `npx expo run:android`, confirmar que el
  botón de back de Android cierra un modal de confirmación real igual que tocar "Cancelar", que
  navegar entre tabs con back funciona, que el contenido no se solapa con la barra de estado ni
  la barra de gestos/navegación con edge-to-edge activo, y (si es posible simular sin
  credenciales reales) que el canal de notificación "default" existe con importancia MAX.
