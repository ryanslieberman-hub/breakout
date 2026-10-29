# Retro Arcade: Roadmap

A React Native (Expo) hub app of original games inspired by 2010s mobile hits.
Working name: **Retro Arcade** (placeholder).

## Ground rules (IP)
- Build **original** games with similar mechanics. No copied names, logos, art, sounds, or licensed rosters/leagues.
- Fake teams and players (e.g. "Tampa Rays" becomes "Gulf City Rays"), original pixel/vector art, original audio.
- "Inspired by" is fine in the description. Don't use trademarked names in the app name, store listing, or keywords.

## Tech stack
| Concern | Choice | Why |
|---|---|---|
| App shell | Expo (SDK latest) + TypeScript + Expo Router | One codebase for iOS and Android, fast iteration with Expo Go |
| Arcade games (2D action) | `@shopify/react-native-skia` + `react-native-reanimated` + `react-native-gesture-handler` | 60fps canvas, UI-thread game loop |
| Menu-heavy games (baseball, cards) | Plain React Native components + Zustand | These are UI/state games, not frame-loop games |
| Local data | `expo-sqlite` or MMKV | Saves, scores, collections |
| Backend (phase 4) | Firebase (Auth + Firestore), as in Breakout | Leaderboards, cloud saves |
| Audio | `expo-audio` | SFX and music |
| Builds | EAS Build / EAS Submit | Store builds without local Xcode or Android Studio |

Each game is a self-contained module behind one interface:

```ts
interface GameModule {
  id: string; title: string; icon: ImageSourcePropType;
  Component: React.FC<{ onExit(): void; onScore(n: number): void }>;
}
```

The hub only knows this interface, so adding a game never touches the hub.

## Architecture
```
retro-arcade/
  app/                 # Expo Router screens (hub, settings, game host)
  src/
    core/              # game loop hook, input, audio, haptics, save store
    games/
      flappy/  jumper/  runner/  stack/  ...
      baseball/        # the big one
    ui/                # shared buttons, score popups, theme
  assets/
```

Shared `core/` pieces, built once:
- `useGameLoop` (fixed timestep, pause on background)
- Score and high-score store, per game
- Haptics and SFX wrapper
- Pause, game-over, and restart overlay

## Game list, ranked by effort

**Tier 1: arcade (days each, reuse the core)**
1. Flappy-style tapper: gravity, pipe gaps, score
2. Doodle Jump-style jumper: tilt or drag, platforms, springs
3. Endless runner (Temple Run/Subway Surfers lanes): swipe lanes, jump, slide, coins
4. Stack tower: tap to drop blocks
5. Crossy Road-style hopper
6. Fruit Ninja-style slicer: swipe trails, particles

**Tier 2: casual and puzzle (about a week each)**
7. 2048-style merge
8. Match-3 (Candy Crush-style)
9. Angry Birds-style slingshot physics (needs `matter-js`)
10. Cut-the-rope-style physics puzzle

**Tier 3: sports and card (the 9 Innings / TSBaseball / Madden Mobile family)**
11. **Baseball (9 Innings-style)**
    - Pitch/swing minigame: timing-based batting, tap-to-select pitch type and location
    - Fictional league, about 120 fake players with stats, rarity tiers (common to legend)
    - Card packs (earned with in-game coins, no real money at first), lineup builder, player upgrades
    - Season mode with AI opponents, then PvP via Firebase later
12. **Football (Madden Mobile-style)**: simplified play-calling, a drive simulator with a text/animation result, then an optional controllable play
13. Basketball shootout (Basketball Stars-style)

## Phases
| Phase | Deliverable | Done when |
|---|---|---|
| 0. Setup | Expo + TS project, nav, theme, `GameModule` interface, hub screen | App runs on your phone via Expo Go |
| 1. Core | Game loop, input, audio, high scores, pause/game-over overlays | Reusable by any game |
| 2. First 3 arcade games | Flappy, Jumper, Runner | Each is playable, scored, and saved |
| 3. More arcade/casual | Stack, 2048, Fruit-slicer, and more as desired | Hub has 6+ games |
| 4. Baseball | Fictional league, pack opening, lineup, batting minigame, season mode | One full season is playable |
| 5. Accounts and social | Firebase auth, global leaderboards, cloud saves | Scores persist across devices |
| 6. Polish and ship | Icons, splash, onboarding, ads or IAP decision, privacy policy, store listings | TestFlight and Play internal testing |
| 7. Football and more | Madden-style game, other sports | Ongoing |

## Decisions to make later
- Monetization: free with rewarded ads, a one-time unlock, or IAP for card packs. Real-money loot boxes need extra care for store rules and age gating.
- App name, branding, and look. A shared "2010s nostalgia" theme (chunky buttons, bright gradients) will tie the games together.
- Do you want an Apple Developer account ($99/yr) and Google Play ($25 one-time) now, or only after the prototypes? Expo Go is enough until Phase 6.

## Suggested next step
Do **Phase 0 and 1 and the Flappy-style game** as a single milestone. It's the smallest slice that proves the hub, game loop, scoring, and Expo toolchain on your actual phone.

## Prerequisites on your machine
- Node.js LTS
- The **Expo Go** app on your phone
- A Wi-Fi network shared by your PC and phone
