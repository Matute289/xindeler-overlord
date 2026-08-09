---
name: ops-ui
description: Use when building or changing any screen, component, or platform-specific behaviour in the Ops Console — the design language, the destructive-action rules, and the iOS/Android/web differences that must be handled explicitly
---

# UI conventions — Xindeler Ops Console

## What this app is, aesthetically

An **instrument panel**, not a consumer app. It is opened at 2 a.m., on a phone, in bed, usually
because something is wrong. Design for: legibility in the dark, one-handed reach, unambiguous state,
and a very high cost for an accidental tap.

- **Dark first.** Light mode is a courtesy; dark is the design.
- **Status is colour + text + shape, never colour alone.** "Running" reads as running to someone
  who cannot distinguish green from amber, and to someone glancing for half a second.
- **No decorative animation.** Motion is reserved for conveying state transitions
  (`draining → stopped`), where it carries information.
- **Density on tablet/desktop, generosity on phone.** Two-pane at ≥768 pt, single column below.
- **Tap targets ≥ 44 pt.** No exceptions on destructive controls.

## Stack rules

- **NativeWind** for styling. No component kit (NativeBase / Tamagui / gluestack) — this app has
  ~8 screens with a specific look; a kit will fight it and become a migration liability.
- ~15 hand-written primitives in `src/ui/`: `Screen`, `Card`, `StatRow`, `StatusPill`, `Button`,
  `DangerButton`, `ConfirmSheet`, `Field`, `Picker`, `LogLine`, `Banner`, `Spinner`, `Empty`,
  `Sheet`, `Tabs`. Everything else composes these.
- `src/ui/` imports **nothing** except the theme. If a primitive needs API types, it is not a
  primitive.
- Lists that can grow unbounded (logs, chat) are virtualized. A log flood must not drop frames.

## Destructive actions — the rules

Stopping the game server and firing an ORACLE event are the two things that can ruin someone's
evening. Both follow the same pattern:

1. The control is visually distinct (`DangerButton`), never adjacent to a common action.
2. Tapping opens a `ConfirmSheet` that requires **typing the verb** (`RESTART`, `STOP`, `FIRE`) —
   not a second tap. Phones in pockets press buttons.
3. The sheet states, in plain language, what will happen to players *right now* — "12 players will
   be disconnected in 60 seconds".
4. TOTP step-up is requested at this point, not earlier.
5. After confirming, the UI shows the **real** state from the SSE stream, never an optimistic one.
6. **Cancel stays reachable** for the entire draining window.
7. For ORACLE: the fire button carries the literal text *"there is no undo"*.

## Never lie about capability

Straight from NH-75 §9.10, and it is a UI rule, not a backend one:

- `atmosphere` / `dimension_config` fields render with a **"stored, not applied to the live world"**
  badge. The engine ignores them.
- "Adventures" are labelled as **ordered folders of presets with operator notes** — there is no
  quest system, no stages, no completion tracking, no rewards.
- There is no undo for a spawn. Say it where the decision is made.
- A stale stream shows a "not live" banner rather than a confident-looking old value.

## Platform differences that must be handled, not discovered

~10–20% of this app is platform-conditional and that is expected. Tools, in order of preference:
`Platform.select` → `.ios.tsx` / `.android.tsx` / `.web.tsx` files → Expo UI native components.

| Concern | iOS | Android | Web |
|---|---|---|---|
| Back | edge-swipe; no hardware back | **hardware/gesture back must be handled explicitly**, incl. confirm on destructive screens | browser history |
| Safe areas | notch / Dynamic Island / home indicator | edge-to-edge + display cutouts | none |
| Navigation shell | bottom tabs | bottom tabs | wide sidebar |
| Press feedback | opacity / scale | Material ripple | hover + focus rings |
| Keyboard | avoidance differs | differs again | n/a |
| Secure storage | Keychain | Keystore | `HttpOnly` cookie (SecureStore has no web support) |
| Biometrics | Face ID (`NSFaceIDUsageDescription`) | BiometricPrompt | WebAuthn / passkeys |
| Push | APNs | FCM + **channels** | **not supported by `expo-notifications`** — separate SW + VAPID |
| Background | suspends aggressively | Doze / OEM variance | tab throttling |

**A UI change is not verified until it has run on at least two targets.** "Looks right on web" is
not a review.

## Accessibility floor

Every interactive element has an accessible label. Status is never colour-only. Dynamic Type /
font-scaling does not break layouts. On web, tab order is sane and focus is visible — the web build
is the desktop client, and it will be driven by keyboard.

## Copy

UI strings in **Spanish** (Matías is the user), code and comments in **English**. Error text from the
gateway is rendered verbatim — do not translate or reword it in the client.
