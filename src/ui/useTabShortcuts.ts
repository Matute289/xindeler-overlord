import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';

export function useTabShortcuts(
  destinations: { href: Href }[],
  onHelp: () => void,
  suppressed: boolean,
): void {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    function handleKeyDown(event: KeyboardEvent) {
      if (suppressed) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = document.activeElement;
      const isTyping =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTyping) return;

      if (event.key === '?') {
        onHelp();
        return;
      }

      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= destinations.length) {
        router.push(destinations[digit - 1].href);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [destinations, onHelp, router, suppressed]);
}
