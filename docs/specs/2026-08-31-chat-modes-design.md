# Chat: General / Big Screen / Mensajes Directos — Design

Pedido de Matías (2026-08-31): separar la pantalla de Chat en tres modalidades — **General**
(broadcast a todos, lo que ya existe hoy), **Big Screen** (mensajes de lectura obligatoria que
interrumpen la pantalla del juego) y **Mensajes Directos** (1 a 1 o a grupos).

Este documento cubre **solo la pieza "General"** — la reorganización de la pantalla de Chat
existente bajo un selector de tres opciones, con Big Screen y Mensajes Directos como
"próximamente". Las otras dos piezas no tienen contrato de API todavía: necesitan diseño nuevo del
lado de `xindeler-zuul` (canal/tipo de mensaje distinto para Big Screen; concepto de destinatario/
grupo para Mensajes Directos), y Big Screen además necesita que alguien construya el renderizado
del lado del cliente del juego (`xindeler-new-horizon`) — ninguna de las dos cosas es algo que este
repo pueda resolver solo. Zuul ya está al tanto y coordinando directamente con la sesión de
`xindeler-new-horizon-b0` para esas dos piezas; cuando tengan contrato, esas dos pestañas se
completan en un ciclo de diseño propio.

## Alcance confirmado

- Un selector de tres opciones arriba de la pantalla de Chat: **General** / **Big Screen** /
  **Mensajes Directos**.
- **General**: el chat de broadcast que ya existe hoy (`ChatScreen`, `useChatQuery`,
  `BroadcastComposer`, SSE), sin ningún cambio de comportamiento ni de datos — solo pasa a vivir
  bajo esta pestaña en vez de ser toda la pantalla.
- **Big Screen** y **Mensajes Directos**: pantalla "próximamente", sin ninguna llamada a la API
  todavía (no hay contrato que llamar).
- Explícitamente fuera de alcance de este documento: cualquier lógica real de Big Screen o
  Mensajes Directos (eso espera al contrato de Zuul).

## Investigación previa (ya confirmada en la sesión)

- El patrón de selector de dos-o-más-secciones-con-pills ya existe en este repo:
  `AiSystemScreen.tsx` (pantalla "Sistema IA") arma un `SECTIONS` array de `{value, label}`, un
  `useState<Section>` para la sección activa, y un `View className="flex-row gap-2 px-6 pt-4"`
  con un `Pressable` por opción (`bg-accent-cyan` activo, `bg-bg-surface` inactivo). Este diseño
  reusa exactamente ese patrón — mismo componente `Pressable`, mismas clases, mismo shape de
  estado — en vez de inventar un componente de tabs nuevo.
- El patrón de placeholder "todavía no implementado" también ya existe:
  `AuroraPlaceholderScreen.tsx` — título, texto explicativo, y un bloque con un `Button disabled`
  a modo de vista previa de lo que va a hacer el control real cuando exista. Big Screen y
  Mensajes Directos reusan esta misma forma (contenido de texto propio para cada uno).
- `ChatScreen.tsx` (`src/features/chat/ChatScreen.tsx`) hoy es standalone — lo renderiza
  directamente `app/(tabs)/chat.tsx`. No tiene ningún concepto de "modo" ni de pestañas internas.

## Arquitectura

### 1. `src/features/chat/ChatModesScreen.tsx` (nuevo)

```ts
type ChatMode = 'general' | 'big_screen' | 'direct';

const MODES: { value: ChatMode; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'big_screen', label: 'Big Screen' },
  { value: 'direct', label: 'Mensajes Directos' },
];
```

- Mismo shape que `AiSystemScreen.tsx`: `useState<ChatMode>('general')`, selector de pills
  arriba, contenido condicional debajo.
- `general` → `<ChatScreen />` (sin cambios, se sigue exportando desde `ChatScreen.tsx` igual que
  hoy).
- `big_screen` → `<BigScreenPlaceholderScreen />` (nuevo).
- `direct` → `<DirectMessagesPlaceholderScreen />` (nuevo).

### 2. `src/features/chat/BigScreenPlaceholderScreen.tsx` (nuevo)

- Mismo shape que `AuroraPlaceholderScreen.tsx`. Copy exacto:
  - Título: `Big Screen`
  - Texto explicativo: `Mensajes de lectura obligatoria que interrumpen la pantalla del jugador —
    para avisos que sí o sí tienen que ver. Todavía no existe el canal para este tipo de mensaje
    del lado de Zuul, ni el renderizado del lado del cliente del juego: no hay nada que mandar
    todavía.`
  - Bloque con `Button label="Enviar" disabled` + nota: `Este control queda listo para cuando
    Zuul y el cliente del juego soporten Big Screen — hoy no hace nada.`

### 3. `src/features/chat/DirectMessagesPlaceholderScreen.tsx` (nuevo)

- Mismo shape. Copy exacto:
  - Título: `Mensajes Directos`
  - Texto explicativo: `Mensajes a un jugador específico o a un grupo armado por el operador.
    Todavía no existe el concepto de destinatario ni de grupo del lado de Zuul: no hay nada que
    mandar todavía.`
  - Bloque con `Button label="Enviar" disabled` + nota: `Este control queda listo para cuando
    Zuul soporte destinatarios/grupos — hoy no hace nada.`

### 4. `app/(tabs)/chat.tsx` (modificado)

- Cambia de renderizar `<ChatScreen />` directo a renderizar `<ChatModesScreen />`.

## Fuera de alcance / decisiones explícitas

- Sin persistencia de qué pestaña quedó seleccionada — cada vez que se entra a Chat, arranca en
  "General" (mismo default que `AiSystemScreen` usa para "ORACLE").
- Sin ningún cambio a `useChatQuery`/`BroadcastComposer`/el evento SSE `chat` — General sigue
  exactamente igual por dentro, solo cambia dónde vive en el árbol de componentes.
- No se agrega ninguna ruta ni schema nuevo a `src/api/` — no hay nada que llamar todavía para las
  otras dos pestañas.

## Testing / verificación

No hay test runner en este repo — verificación es `npx tsc --noEmit`, `npm run lint`,
`npm run format:check`, y verificación manual: el chat de "General" sigue funcionando
exactamente igual que antes (probado contra `mock-gateway` y, si es posible, contra producción
real), las pestañas "Big Screen"/"Mensajes Directos" muestran el placeholder sin ningún error de
consola, y el cambio de pestaña no rompe el scroll/follow-tail de "General" al volver a ella.
Probado en al menos dos plataformas (iPhone/iPad simulador + navegador), por la convención
establecida de este repo.
