import { useEffect, useState, type SetStateAction } from 'react';

export const averages = [
  { key: 'ma60', label: 'MA60', color: '#d97706' },
  { key: 'ma100', label: 'MA100', color: '#2563eb' },
  { key: 'ma200', label: 'MA200', color: '#9333ea' },
  { key: 'ma250', label: 'MA250', color: '#db2777' },
] as const;
export type AverageKey = typeof averages[number]['key'];
export const defaultColors = Object.fromEntries(averages.map(item => [item.key, item.color])) as Record<AverageKey, string>;
export const colorStorageKey = 'pickinggeek_indicator_colors';

export function readColors(): Record<AverageKey, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(colorStorageKey) || '{}');
    return Object.fromEntries(averages.map(item => [item.key,
      typeof saved?.[item.key] === 'string' && /^#[0-9a-f]{6}$/i.test(saved[item.key]) ? saved[item.key] : item.color,
    ])) as Record<AverageKey, string>;
  } catch { return { ...defaultColors }; }
}

export function useAverageColors() {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const sync = () => setColors(readColors());
    const storage = (event: StorageEvent) => { if (event.key === colorStorageKey) sync(); };
    window.addEventListener('pickinggeek:indicator-colors', sync);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('pickinggeek:indicator-colors', sync);
      window.removeEventListener('storage', storage);
    };
  }, []);
  function updateColors(update: SetStateAction<Record<AverageKey, string>>) {
    const next = typeof update === 'function' ? update(colors) : update;
    setColors(next);
    try {
      localStorage.setItem(colorStorageKey, JSON.stringify(next));
      window.dispatchEvent(new Event('pickinggeek:indicator-colors'));
    } catch { /* Keep the current selection when storage is disabled. */ }
  }
  return [colors, updateColors] as const;
}
