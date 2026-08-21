# Atajos de teclado en Web — Design

Sub-ticket de OC-35 (el tercio "básico" que Matías confirmó en el chat: "Básico: navegación
entre tabs + Escape"). Los otros dos tercios de OC-35 (master-detail de jugador, bloqueado en
las tickets cross-repo O-01/BL-84/ZG-56; manejo de orientación) quedan fuera de este documento.

## Alcance confirmado

- Teclas numéricas para saltar entre los 6 destinos principales (Status, Jugadores, Logs, Chat,
  Sistema IA, Más).
- `Escape` cierra cualquier modal/sheet de confirmación abierto.
- `?` abre un overlay de ayuda que lista los atajos disponibles.
- Explícitamente fuera de alcance: ningún atajo dispara una acción destructiva — esas siguen
  requiriendo un tap explícito, sin excepción.
- Solo Web (`Platform.OS === 'web'`). iOS/Android no tienen manejo de teclado hoy y no es parte
  de este ticket (un iPad con teclado físico queda para una iteración futura si se pide).

## Investigación previa (ya confirmada en la sesión)

- `useBreakpoint`/`SidebarLayout` (`app/(tabs)/_layout.tsx`) no tienen ningún manejo de teclado
  hoy — cero infraestructura existente para esto, es 100% nuevo.
- Precedente ya establecido en el repo para código condicional a Web:
  `Platform.OS === 'web'` guards puntuales dentro del componente/hook que lo necesita (ver
  `src/auth/AppLockGate.tsx`), no un módulo aparte por plataforma. Este ticket sigue el mismo
  patrón.
- Los dos modales de confirmación existentes, `src/ui/ConfirmByTypingSheet.tsx` y
  `src/auth/StepUpPrompt.tsx`, comparten la misma forma: prop `visible`, prop `onCancel`, y una
  función interna `handleCancel` que ya limpia el estado local antes de llamar a `onCancel`. Esa
  función interna es el punto de enganche correcto para `Escape` — cerrar por `Escape` debe
  producir exactamente el mismo efecto que tocar "Cancelar".
- Ambos modales hacen `autoFocus` en su `TextField` al abrirse. Esto importa para el diseño de
  la navegación por número: mientras un modal está abierto, el foco del documento está dentro de
  un `<input>`, así que el guard "no interceptar si se está escribiendo en un campo de texto" ya
  alcanza para que las teclas numéricas no compitan con escribir el código TOTP o la palabra de
  confirmación — no hace falta un registro global de "hay un modal abierto".

## Arquitectura

### 1. `src/ui/useEscapeToClose.ts` (nuevo hook, compartido)

```ts
export function useEscapeToClose(visible: boolean, onClose: () => void): void
```

- No-op en `Platform.OS !== 'web'` o cuando `visible` es `false`.
- En web y `visible === true`, agrega un listener de `keydown` en `document` que llama a
  `onClose` cuando `event.key === 'Escape'`, y lo remueve al cerrar/desmontar.
- Se usa dentro de `ConfirmByTypingSheet` y `StepUpPrompt`, llamando a su propio `handleCancel`
  interno (no directamente al prop `onCancel`) para preservar la limpieza de estado local que
  cada uno ya hace. Cualquier sheet futuro con la misma forma (`visible`/`onCancel`) puede
  reusar este hook.

### 2. `src/ui/useTabShortcuts.ts` (nuevo hook)

```ts
export function useTabShortcuts(
  destinations: { href: Href }[],
  onHelp: () => void,
): void
```

- No-op en `Platform.OS !== 'web'`.
- Un solo listener de `keydown` en `document`. Ignora el evento si `document.activeElement` es
  un `<input>`, `<textarea>`, o tiene `isContentEditable`.
- Si `event.key` es un dígito `'1'`..`String(destinations.length)`, navega con
  `router.push(destinations[digit - 1].href)` (usa `useRouter()` de `expo-router` internamente).
- Si `event.key === '?'`, llama a `onHelp()`.
- El orden de `destinations` es el mismo array `DESTINATIONS` que ya existe en
  `app/(tabs)/_layout.tsx` — el número de cada atajo es simplemente su posición + 1, no hace
  falta un mapeo separado que se pueda desincronizar.

### 3. `src/ui/KeyboardShortcutsHelp.tsx` (nuevo componente)

- Modal con la misma estética que `ConfirmByTypingSheet`/`StepUpPrompt` (fondo `bg-black/60`,
  tarjeta `bg-bg-surface dark:bg-night-bg-surface`, `fonts.bold` para el título).
- Lista fija: una fila por destino (`"1 — Status"`, `"2 — Jugadores"`, ... `"6 — Más"`), más dos
  filas fijas: `"Escape — Cerrar diálogo"` y `"? — Esta ayuda"`.
- Usa `useEscapeToClose(visible, onClose)` para poder cerrarse a sí mismo con `Escape` también.
- Se cierra tocando fuera (mismo `Pressable` full-bleed que los otros dos modales) o el botón
  "Cerrar".

### 4. `app/(tabs)/_layout.tsx` (modificado)

- `TabsLayout` gana un `useState` para `helpVisible`.
- Llama a `useTabShortcuts(DESTINATIONS, () => setHelpVisible(true))`.
- Renderiza `<KeyboardShortcutsHelp visible={helpVisible} onClose={() => setHelpVisible(false)} />`
  al final del árbol, junto a `EnvironmentBadge`/`StreamStatusBanner` (mismo nivel, fuera del
  `Tabs`/`SidebarLayout` condicional, para que funcione en ambos breakpoints).

## Fuera de alcance / decisiones explícitas

- No se acopla a `useBreakpoint()` — los atajos están activos en cualquier ancho de ventana en
  Web, no solo en `wide`. Un teclado físico es igual de real en una ventana angosta.
- No hay registro global de "modal abierto" — el guard de `activeElement` alcanza para los dos
  modales existentes gracias a su `autoFocus`. Si en el futuro aparece un modal sin campo de
  texto enfocado, este guard no lo cubre; se documenta como limitación conocida, no se
  sobre-diseña para un caso que no existe hoy.
- Ningún atajo dispara una acción destructiva ni un submit — solo navegación y abrir/cerrar UI
  no destructiva.

## Testing / verificación

- No hay test runner en este repo (confirmado en sesiones anteriores) — verificación es
  `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, y verificación manual en
  `npx expo start --web`: probar cada tecla 1-6 navega al destino correcto, `?` abre/cierra la
  ayuda, `Escape` cierra `ConfirmByTypingSheet` y `StepUpPrompt` reales (ej. abrir el sheet de
  confirmación en Status y confirmar que `Escape` cancela igual que tocar "Cancelar"), y que
  escribir un dígito dentro del campo TOTP/palabra de confirmación NO navega.
