# OC-36b: Material ripple / press states — Design

Segunda y última parte del split de OC-36 (la 1/2, verificación de plataforma Android, ya está
mergeada). Esta es la parte con trabajo real: hoy **ningún** `Pressable` de la app tiene feedback
visual al tocar, en ninguna plataforma — ni ripple de Material en Android, ni dimming de opacidad
al estilo iOS. Confirmado por grep: cero usos de `android_ripple`, cero usos de
`style={({pressed}) => ...}` en toda la app.

## Investigación previa (ya confirmada, no requiere más research)

- 24 archivos usan `Pressable` de `react-native` directamente (`src/ui/Button.tsx` es el más
  reusado, seguido de filas de lista como `OperatorRow.tsx`/`LogRow.tsx`/`ChatTurnRow.tsx`, chips
  como `ChipPicker.tsx`/`LevelFilter.tsx`/`EnvironmentSwitcher.tsx`, y varios links de texto tipo
  "Cancelar"/"Cerrar").
- Ninguno de los 24 usos pasa un prop `style` al `Pressable` en sí (solo a sus hijos `Text`, vía
  `style={{ fontFamily: ... }}`) — todos usan `className` de NativeWind exclusivamente para el
  propio `Pressable`. Esto simplifica el fix: no hay que fusionar con un `style` function
  pre-existente en ningún caso.
- `useTheme()` (`src/ui/theme.ts`) ya expone `colors.accent`/`colors.accentMuted` como valores JS
  reales — el color natural para el ripple de Android.

## Alcance

**Un componente nuevo, `src/ui/Pressable.tsx`**: wrapper delgado sobre el `Pressable` de
`react-native` que agrega, por default, feedback visual apropiado por plataforma:

- **Android**: `android_ripple={{ color: colors.accentMuted }}` — el ripple nativo de Material,
  a menos que el caller pase su propio `android_ripple` (se respeta el override).
- **iOS/Web**: un dimming de opacidad al estado `pressed` (`opacity: 0.6` mientras está presionado,
  vía la función `style={(state) => ...}` de RN — no vía `className`, ya que ningún consumidor usa
  `style` en el `Pressable` mismo, así que no hay nada con qué fusionar).

Cada uno de los 24 archivos cambia **solo su import**: `import { Pressable } from 'react-native'`
pasa a `import { Pressable } from '@/ui/Pressable'` (o ruta relativa según donde viva el archivo,
siguiendo la convención ya establecida en el repo — `src/ui/` usa imports relativos entre sí,
`src/auth/`/`src/features/`/`app/` usan el alias `@/`). Cero cambios de props/className/lógica en
ninguno de los 24 — el wrapper es un reemplazo drop-in.

## Fuera de alcance

- No se rediseña ningún componente visualmente más allá del feedback de press — colores,
  tamaños, layout quedan exactamente igual.
- No se agrega ninguna dependencia nueva — `android_ripple` y la función `style={(state)=>...}`
  son ambas API nativa de `Pressable` de React Native, ya instalado.
- No se toca ningún archivo que use `TouchableOpacity`/`TouchableHighlight` u otro primitivo de
  toque — el grep confirmó que `Pressable` es el único primitivo interactivo usado en esta app.

## Verificación

- `npx tsc --noEmit`, `npm run lint`, `npm run format:check` limpios.
- No hay test runner. Verificación manual real: en emulador/Simulador, tocar y mantener presionado
  varios `Pressable` representativos de distintos tipos (un botón completo vía `Button.tsx`, una
  fila de lista, un chip, un link de texto) en **Android** (confirmar el ripple de Material se ve)
  y en **iOS** (confirmar el dimming de opacidad se ve, sin ripple). Confirmar que ningún
  `Pressable` deshabilitado (`disabled`) muestra feedback de press (RN ya suprime `pressed` en
  elementos disabled por default, pero vale confirmarlo en vivo dado que `Button.tsx` en particular
  ya maneja su propio estado `disabled` con opacity reducida vía className).
