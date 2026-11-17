# Breakout native shell (Capacitor)

Wraps the same `index.html` the website serves into iOS and Android apps.
Nothing here is installed or built yet - this is the scaffold.

## First run (needs Node; iOS needs a Mac with Xcode, Android needs Android Studio)

```powershell
cd native
npm install
npx cap add android      # and on a Mac: npx cap add ios
npm run android          # builds www/, syncs, opens Android Studio
```

## Before this can ship to a store

1. **Push notifications.** Web push (`firebase-messaging-sw.js`) does not run in a
   native webview. Use `@capacitor/push-notifications` (APNs/FCM) and register the
   token the same place `enablePushNotifications()` stores web tokens.
2. **Sign-in.** Firebase popup/redirect auth is unreliable in webviews. Switch the
   native build to `@capacitor-firebase/authentication` (Apple + Google native sheets).
   Apple requires Sign in with Apple if any other social login is offered.
3. **Real-money contests.** Apple and Google treat paid, prize-based contests as
   gambling-adjacent: iOS needs the geo/age gating plus a licensed-where-required
   review, and entry fees cannot use in-app purchase. Ship the **coins-only** build
   first (hide paid challenges when `Capacitor.isNativePlatform()`), per handoff.md.
4. **App Review 4.2 (minimum functionality).** A bare website wrapper gets rejected.
   Native push, haptics (`@capacitor/haptics`), and the status-bar/splash polish are
   what get it approved.
5. Icons/splash: generate from `icon-512.png` with `@capacitor/assets`.
