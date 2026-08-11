import { useWindowDimensions } from 'react-native';

const WIDE_BREAKPOINT = 768;

export type Breakpoint = 'phone' | 'wide';

export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT ? 'wide' : 'phone';
}
