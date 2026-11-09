// Hash routing (GitHub Pages serves one index.html): #/users, #/users/<id>, #/jobs?owner=<id>, …
import { useEffect, useState } from 'react';

export interface Route { path: string[]; params: URLSearchParams }

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, search] = raw.split('?');
  return { path: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(search ?? '') };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const navigate = (to: string) => { location.hash = to.startsWith('#') ? to : `#${to}`; };
export const href = (to: string) => `#${to}`;

// Filters and pages survive moving between sections (memory only, for this tab).
const memory = new Map<string, unknown>();
export function useRemembered<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial));
  return [value, (next: T) => { memory.set(key, next); setValue(next); }];
}
