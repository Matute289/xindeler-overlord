---
name: ops-release
description: Use when cutting a build, bumping a version, submitting to TestFlight or the Google Play internal track, or debugging a signing/store-upload failure for the Xindeler Ops Console
---

# Releasing the Ops Console

Distribution is **private on purpose**: TestFlight *internal* testing on iOS, Play *internal
testing* track on Android. There is no public listing on either store and there never will be.
Full reasoning and the rejected alternatives: `docs/specs/2026-08-09-restricted-distribution-plan.md`.

## Before you touch anything

1. `git status` must be clean and you must be on a merged `main`. Never build from a feature branch
   unless you are explicitly making a throwaway `preview` build.
2. Bump the version. `app.config.ts` `version` is the human-facing one; `ios.buildNumber` and
   `android.versionCode` must **increase monotonically** — the stores reject reuse of a build number
   forever, even for a deleted build.
3. Confirm which gateway the build points at. A `production` build that ships pointing at the mock
   gateway is a wasted 90-day slot.

## iOS — TestFlight internal

```bash
# Cloud build (works even without local Xcode)
eas build --platform ios --profile production

# Then submit
eas submit --platform ios --latest
```

Then in App Store Connect: the build appears under TestFlight after processing (minutes, not hours),
attach it to the **internal** group, done. **No App Review is involved.** Do not submit the app for
App Review — the app record stays in "Prepare for Submission" indefinitely by design.

**Facts that bite:**
- Builds **expire after 90 days.** Push a fresh one every ~80 days even if nothing changed.
- Internal testers must be **App Store Connect users** (Developer role, scoped to this app). Adding
  a tester is an ASC user invitation, not just an email in a list.
- Limit: 100 internal testers, 30 devices each.
- `ITSAppUsesNonExemptEncryption = false` must stay set in the Expo config — otherwise every upload
  re-asks the export-compliance question. The app uses only standard HTTPS, so this is correct.
- No privacy nutrition label is needed for internal-only distribution.
- If the Apple membership lapses: certs die, TestFlight stops serving, devices purge after 180 days.

## Android — Play internal testing

```bash
eas build --platform android --profile production
eas submit --platform android --latest --track internal
```

**Facts that bite:**
- Builds **never expire**. Zero distribution churn.
- Testers are added as plain **email addresses** (Google accounts). Google Groups only work on the
  *closed* track, not internal.
- A tester must install with the **same Google account** that is on the list, via the opt-in link.
- Limit: 100 testers.
- **Never request production access.** Staying on internal means the "12 testers / 14 continuous
  days" rule for new personal developer accounts never applies — it gates Production and
  Pre-registration only.
- Target API level: from 2026-08-31, updates must target **Android 16 (API 36)**. This is an annual
  bump; Expo SDK upgrades usually carry it.
- ⚠️ **The upload keystore must never be lost.** If EAS manages credentials, run
  `eas credentials` and export a backup to somewhere off-machine.

## Version/build-number discipline

| Field | Rule |
|---|---|
| `version` | semver-ish, human facing, bumped per meaningful release |
| `ios.buildNumber` | strictly increasing integer-ish string, **never reused** |
| `android.versionCode` | strictly increasing integer, **never reused** |

`eas build` can auto-increment these; prefer that over hand-editing, and commit the result.

## Web

The web target is a static export served from the ops host behind the gateway's own auth:

```bash
npx expo export --platform web
```

No store, no review. Under the WireGuard-only posture it is reachable only over the tunnel.

## When something fails

| Symptom | First thing to check |
|---|---|
| iOS upload rejected: duplicate build number | `ios.buildNumber` was reused — bump and rebuild |
| iOS: "missing compliance" blocks the build in TestFlight | `ITSAppUsesNonExemptEncryption` not set |
| Play: "Version code already used" | `android.versionCode` reused |
| Play: upload rejected for target SDK | annual API-level bump due; upgrade the Expo SDK |
| Tester cannot see the iOS build | they are not an ASC user, or not in the internal group |
| Tester cannot see the Android build | wrong Google account, or they never accepted the opt-in link |
| Signing errors on EAS | `eas credentials` — do not hand-manage certs unless you must |

## Hard rules for AI agents

- **Never run `eas submit` or push a build to a store without Matías explicitly asking for it in
  this session.** A build is a public-ish artifact with a name on it.
- Never modify, regenerate, or delete signing credentials or keystores.
- Never commit `.p8`, `.p12`, `.mobileprovision`, `.keystore`, `credentials.json`, or
  `google-services.json` / `GoogleService-Info.plist`.
- Never invite testers or change store metadata.
- Building locally (`eas build --local`, `expo run:ios`) is fine and needs no permission.
