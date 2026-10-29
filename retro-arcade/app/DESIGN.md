# Retro Arcade: design system

**World:** a 2013 phone home screen. Games are glossy app icons; games themselves look like the outlined, chunky casual hits of that era.

## Rules
- Everything gets a plum-black outline (`theme.ink` `#3b2a3f`). No outline-less flat shapes in game art or buttons.
- Display lettering is Lilita One with an 8-copy stroke and an optional hard drop (`StrokedText`). Small labels are Silkscreen (pixel).
- Buttons are `Button3D`: outline, colored lip, top shine, squash on press.
- Icons use `IconShell` (gradient squircle, outline, gloss, drop shadow). A game without a `Component` shows as a dimmed "soon" icon.
- Palette: sky `#2ba7d9 → #c9f0ee`, grass `#73bf2e`, sand `#ded895`, orange `#f7a21b`, yellow `#ffd23f`, red badge `#e8402e`.
- Shadows are offset and soft; no zero-offset glows. No gradient text.

## Files
- `src/ui/theme.ts`, `StrokedText.tsx`, `Button3D.tsx`, `icons.tsx`
- `src/games/flappy/Bird.tsx`, `Scenery.tsx` (pipes, parallax city and bushes, clouds, ground)
