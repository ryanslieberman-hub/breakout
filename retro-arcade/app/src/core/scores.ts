import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (gameId: string) => `highscore:${gameId}`;

export async function getHighScore(gameId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(key(gameId));
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Saves the score if it beats the stored best. Resolves to the best score. */
export async function submitScore(gameId: string, score: number): Promise<number> {
  const best = await getHighScore(gameId);
  if (score <= best) return best;
  try {
    await AsyncStorage.setItem(key(gameId), String(score));
  } catch {}
  return score;
}
