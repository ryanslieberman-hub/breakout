import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { starterIds } from './league';

export interface Save {
  coins: number;
  owned: number[];
  lineup: number[];
  wins: number;
  losses: number;
}

const KEY = 'baseball:save:v1';
export const PACK_COST = 100;

const fresh = (): Save => {
  const start = starterIds();
  return { coins: 300, owned: [...start], lineup: [...start], wins: 0, losses: 0 };
};

let state: Save = fresh();
let loaded = false;
const listeners = new Set<() => void>();

function emit() { listeners.forEach((l) => l()); }

async function persist() {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

async function load() {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Save;
      if (Array.isArray(parsed.owned) && Array.isArray(parsed.lineup) && parsed.lineup.length === 9) state = parsed;
    }
  } catch {}
  loaded = true;
  emit();
}

export function update(fn: (s: Save) => Save) {
  state = fn(state);
  emit();
  persist();
}

export function getSave() { return state; }

/** Returns the live save and re-renders on change. */
export function useSave(): Save {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    load();
    return () => { listeners.delete(l); };
  }, []);
  return state;
}

/** Spends coins and adds cards. Duplicates are cashed out for coins. Returns the new cards. */
export function openPack(ids: number[]): { ids: number[]; dupes: boolean[] } {
  const dupes: boolean[] = [];
  const seen = new Set(state.owned);
  ids.forEach((id) => { dupes.push(seen.has(id)); seen.add(id); });
  update((s) => ({
    ...s,
    coins: s.coins - PACK_COST + dupes.filter(Boolean).length * 25,
    owned: Array.from(new Set([...s.owned, ...ids])),
  }));
  return { ids, dupes };
}

export const teamOvr = (ovrs: number[]) => Math.round(ovrs.reduce((t, n) => t + n, 0) / Math.max(1, ovrs.length));
