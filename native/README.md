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

## What the app code already does (index.html)

- `IS_NATIVE` / `STORE_COINS_ONLY`: inside the app, challenges with an entry fee are
  hidden and cannot be joined. Paid contests stay on the website.
- Sign-in uses the native Google sheet, plus **Sign in with Apple on iOS**
  (`@capacitor-firebase/authentication`, `skipNativeAuth` so the session is the web SDK's).
- Notifications use `@capacitor-firebase/messaging` (FCM token on iOS and Android),
  stored in the same `pushTokens` collection; tapping an alert opens that player.

## Setup you still have to do by hand

1. **Firebase console:** add an Android app (`com.breakoutmarket.app`) and an iOS app
   (same bundle id). Download `google-services.json` into `android/app/` and
   `GoogleService-Info.plist` into `ios/App/App/`. Add your SHA-1/SHA-256 for Android.
2. **Apple:** enable Sign in with Apple capability in Xcode and the Apple provider in
   Firebase Auth. Upload an APNs key to Firebase (Project settings -> Cloud Messaging).
3. **Google sign-in:** the Google provider must be enabled in Firebase Auth (it is).
4. **Server push payload:** pushes are data-only (`worker-pricing-engine/src/lib/push.js`).
   Android delivers those in the background; iOS only wakes the app for data-only
   messages when sent with `apns-push-type: background` + `content-available`, and
   will not show a banner. For iOS banners, add a `notification` block for tokens whose
   doc has `platform: "ios"` (web tokens must stay data-only to avoid double display).
5. **App Review 4.2:** native sign-in, push, and haptics are what keep this from being
   rejected as a website wrapper. Add `@capacitor/haptics` calls if reviewers push back.
6. Icons/splash: generate from `icon-512.png` with `@capacitor/assets`.
