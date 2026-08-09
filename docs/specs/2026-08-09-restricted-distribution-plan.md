# Restricted distribution plan — App Store & Google Play

**Date:** 2026-08-09 · **Status:** PROPOSED — researched, not yet executed.
**Goal:** get the Ops Console onto the phones/tablets of a **specific, curated list of 2–15 people**
(Matías + a couple of moderators/friends) with **no public store listing** and no way for a stranger
to find or install it.

**Assets already in hand:** paid Apple Developer Program membership (individual), Google Play
Developer account, a Mac, an iPhone and an iPad for testing.

---

## 0. Recommendation

> **iOS → TestFlight *internal testing*. Android → Google Play *internal testing* track.**
> Both are free on top of the accounts already paid for, both are email-allowlisted, neither
> produces a public listing, and **the iOS internal track requires no App Review at all.**

Everything else — Ad Hoc, Apple Enterprise, Custom Apps / Apple Business Manager, Play unlisted
apps, Firebase App Distribution, EU alternative distribution — is either strictly worse, or
unobtainable for an individual developer in Argentina. §4 records why, so nobody re-litigates it.

**The one real cost of this path:** iOS internal testers must be users on your App Store Connect
account. See §1.3 for what that means and the escape hatch if it is unacceptable.

---

## 1. iOS — TestFlight internal testing

### 1.1 The rules (as of 2026-08)

| | |
|---|---|
| Tester limit | **100 internal testers** per app |
| App Review | **None.** Build is installable minutes after processing finishes |
| Beta App Review | Not applicable to internal testing |
| Public listing | None — the app never appears in the App Store |
| Build expiry | **90 days** from upload |
| Concurrent builds | up to 100 |
| Devices per tester | 30 |
| Privacy nutrition label | **Not required** for internal-only |
| Required setup | App record in App Store Connect + bundle ID + Test Information (beta description, feedback email) + export-compliance answers |

Sources: [Add internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers),
[Overview of TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/overview-of-testflight).

### 1.2 The concrete steps

1. Create an app record in App Store Connect with the bundle ID (`dev.xindeler.opsconsole`, pending
   the decision in the client spec §9.2). **Never submit it for App Review.** It can sit in
   "Prepare for Submission" forever.
2. Fill in only **Test Information** (beta description + feedback email) and answer **export
   compliance**. Set `ITSAppUsesNonExemptEncryption = false` in `Info.plist` (via the Expo config)
   so that question stops being asked on every upload — the app uses only standard HTTPS.
3. Invite each person as an **App Store Connect user** with the **Developer** role, scoped to this
   app only (App Manager / Developer / Marketing / Sales / Customer Support roles can all be limited
   to specific apps).
4. Create an **internal testing group**, add them, attach the build.
5. They install the TestFlight app from the App Store and the build appears there.
6. Calendar reminder every ~80 days to push a fresh build before the current one expires.

### 1.3 ⚠️ The tester-must-be-an-ASC-user problem, and the escape hatch

Internal testers are, by definition, people with a seat on your App Store Connect account. Scoped to
one app with the Developer role that is a narrow permission, but it is still a seat.

If that is not acceptable for the friends (as opposed to the moderators), the hybrid is:

- **Matías + moderators → internal testing** (no review, no ASC-access concerns since they are
  trusted).
- **Friends → external testing, private group, invited by email, public link disabled.** Up to
  10,000 testers, no ASC account needed. Cost: a **Beta App Review** on the first build of each
  version (subsequent builds in the same version usually pass without), turnaround historically
  ~24–48 h but reported at 2–7 days in 2026 (third-party reports; Apple publishes no SLA).

⚠️ **External testing carries a real rejection risk that internal does not.** Beta App Review
applies the App Review Guidelines, and **Guideline 4.2 (minimum functionality / apps for a limited
audience)** is exactly the shape of an internal ops tool for a private game server. Apple's own
position is that internal-use apps do not belong on the App Store. Internal testing sidesteps this
entirely — which is the strongest argument for keeping everyone on it.

⚠️ Apple's documentation lists **Marketing** as an eligible internal-tester role while several
third-party guides claim it has no TestFlight access. Verify with one tester before inviting
fifteen.

### 1.4 Churn over two years

Upload a build at least every 90 days; renew the USD 99 membership on time (if it lapses,
certificates and provisioning profiles die, TestFlight stops serving builds, and registered devices
are purged after 180 days). Signing certificates renew automatically with Xcode/EAS managed signing.
**That is the entire recurring cost.**

---

## 2. Android — Play internal testing track

### 2.1 The rules (as of 2026-08)

| | |
|---|---|
| Tester limit | **100 testers** per app |
| How testers are added | **Email lists only** (Google Groups are a *closed*-track feature) |
| Review | **None** |
| Time to availability | Minutes |
| Public listing | None — access is via an opt-in link |
| Opt-in | Tester opens the link, accepts, installs from Play with the **same Google account** that is on the list |
| Build expiry | **None** |

Source: [Set up an open, closed, or internal test](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).

### 2.2 The concrete steps

1. Create the app in Play Console. Upload the AAB to the **internal testing** track.
2. Add the testers' Google-account emails to the internal tester list.
3. Send them the opt-in link. They accept and install from Play.
4. **Never request production access.** See §2.3.

### 2.3 ⚠️ The "12 testers / 14 days" rule — precisely what it does and does not block

Personal Play developer accounts created **after 2023-11-13** must run a closed test with **12
opt-in testers for 14 continuous days** before they can access **Production** and
**Pre-registration**.

**It does not gate internal testing.** Google's own requirements table lists internal-testing access
requirements as *"None"*, and closed testing only requires finishing app setup. Staying on the
internal track indefinitely means this rule never applies. (Organization accounts and pre-2023
accounts are exempt regardless.)

Source: [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).

### 2.4 Churn over two years

Builds never expire, so distribution churn is zero. The only recurring tax is the **target API
level**: from **2026-08-31**, new apps and updates must target **Android 16 (API 36)** to publish on
Play. That is an annual bump.

⚠️ **Keep the upload keystore forever.** Generate it with 25+ years of validity and back it up
off-machine. Losing it means never being able to update the app again. (Play App Signing mitigates
this, but the upload key still matters.)

---

## 3. The web build

The Expo web target is a static export served from the ops host, behind the same gateway session +
TOTP auth. Nothing to publish, nothing to review, and it is the fallback whenever a phone build is
stale or a store pipeline is broken. In practice it will also be the primary desktop client.

Under NH-75's Posture A (WireGuard-only) the web build is reachable only over the tunnel too — which
is a feature, not a limitation.

---

## 4. Rejected options, and why (so this is not re-researched)

| Option | Verdict |
|---|---|
| **Apple Developer Enterprise Program** (USD 299/yr) | **Ineligible, unambiguously.** Requires 100+ employees, a legal entity, a D-U-N-S number, an organization-owned public website, and a verification interview — *and* Apple explicitly prohibits it when the case is solvable with TestFlight/Ad Hoc/Custom Apps, which this is. |
| **Ad Hoc distribution** | Works, but 100 devices *per product family per membership year*, manual UDID registration, disabling a device mid-year does **not** free the slot, and every new device means re-signing and redistributing the `.ipa` to everyone, plus self-hosting an HTTPS manifest plist. Strictly more churn than TestFlight for zero benefit. |
| **Custom Apps / Apple Business Manager** | The nearest thing Apple has to an unlisted app, but it targets an **Organization ID** enrolled in Apple Business Manager (needs D-U-N-S + a real org) and still goes through full App Review. Not available to an individual with no recipient org. |
| **A normal App Store listing kept "effectively private"** | There is no unlisted/hidden mode. The closest is limiting availability to one country — while paying the full price (metadata, screenshots, privacy nutrition label, content rating, demo account, full guideline compliance, re-review on every update) **and** taking on Guideline 4.2 rejection risk for being a limited-audience tool. Don't. |
| **EU alternative distribution / Web Distribution** | EU-only: requires an Apple Account registered in an EU country *and* physical presence in the EU. Apple has also opened alternative distribution in Brazil — **not Argentina**. Irrelevant here. (Note: as of 2026-01-01 the EU Core Technology Fee became the Core Technology Commission.) |
| **Play unlisted apps** | Still exists in 2026 (app is on Play but unsearchable, link-only), requested via Play Console support rather than a toggle — but it goes through **full review** and all Play policies. No advantage over the internal track. ⚠️ Google's public documentation on this is thin; verify before relying on it. |
| **Firebase App Distribution** | Alive and supported in 2026 (the survivor after App Center shut down in March 2025), one dashboard for both platforms, invites by email. But **on iOS it is still Ad Hoc/UDID-bound** — it automates *collecting* the UDID, then you still add it to the provisioning profile, re-sign, and redistribute. Adds nothing over TestFlight + Play internal, and makes iOS worse. |
| **Plain sideloaded APK** | See §5 — still viable, but changing. |

---

## 5. ⚠️ Android developer verification — the one thing that changes over the plan's lifetime

Google is rolling out a device-side **Android Developer Verifier** for sideloaded apps
([Android Developers Blog, March 2026](https://android-developers.googleblog.com/2026/03/android-developer-verification-rolling-out-to-all-developers.html)):

| When | What |
|---|---|
| Apr 2026 | Verifier service ships to devices |
| Jun 2026 | Early access for **limited distribution accounts** |
| Aug 2026 | Global launch of limited distribution accounts + the sideloading "advanced flow" |
| 2026-09-30 | Enforcement in Brazil, Indonesia, Singapore, Thailand |
| 2027 | Global expansion (expected to include Argentina) |

**This does not affect the recommended path** (Play internal track is unaffected), but it matters for
the plan-B channel. The relevant mitigation is free and worth doing:

> **Register a Limited Distribution Account** — free, email-only signup, **no government ID**,
> unlimited apps, **up to 20 devices**. Google describes it as being for *"students and hobbyists
> with closed groups of users"*, which is precisely this project.

ADB installs remain exempt, and advanced users can still install unregistered apps by accepting a
warning — so direct APKs do not break, they just gain friction in enforced regions from 2027.

---

## 6. Costs

| Item | Cost | Gotcha |
|---|---|---|
| Apple Developer Program (individual) | **USD 99/year** | Lapse = dead certs, TestFlight stops serving, devices purged after 180 days |
| Google Play Console | **USD 25 one-time** | Non-refundable; personal accounts need government ID + 2FA |
| Firebase App Distribution | free | not used |
| Android Limited Distribution Account | free | 20-device cap |
| EAS Build | free tier, then paid | see the client spec §8 — decide after the first few builds |

---

## 7. Where these findings may age

- **Beta App Review turnaround in 2026** (2–7 days) comes from third-party reports; Apple publishes
  no SLA.
- **Play unlisted apps** — no current official documentation found; based on Play Developer
  Community threads.
- **EU Web Distribution eligibility thresholds** (2 continuous years of membership + 1M annual EU
  first installs) could not be confirmed on Apple's official page. Moot for Argentina.
- **"Marketing" as an eligible internal-tester role** — Apple's docs say yes, third-party guides say
  no. Test with one person first.
- **Developer-verification enforcement dates for Argentina** — Google says "2027, global" without a
  country list.

---

## 8. Checklist for the implementing session

- [ ] Fix the bundle ID / package name **before** creating either store record (renaming later means
      a new App Store Connect record).
- [ ] iOS: app record → Test Information → export compliance → internal group → invite testers.
- [ ] iOS: `ITSAppUsesNonExemptEncryption = false` in the Expo config.
- [ ] Android: create app → upload AAB to internal track → tester email list → send opt-in link.
- [ ] Android: generate and **back up** the upload keystore (25+ year validity).
- [ ] Android: never request production access.
- [ ] Calendar reminder: fresh iOS build every ~80 days; membership renewal every year.
- [ ] Do a full round-trip (build → store → installed on Matías's own iPhone) **in Phase 0**, before
      any real feature exists. This is backlog item OC-9 and it exists because store pipelines are
      where the multi-day surprises live.
