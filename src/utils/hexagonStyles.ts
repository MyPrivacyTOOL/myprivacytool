import type { ObservationStatus } from '@/types/hexagon';

export interface HexagonVisuals {
  className: string;
  icon: string;
  tooltip: string;
}

export function getHexagonVisuals(status: ObservationStatus): HexagonVisuals {
  switch (status) {
    case 'guess':
      return {
        // Pulsing prompts the user to act; motion-reduce keeps it still for people who ask for that.
        className: 'bg-purple-100 border-purple-500 text-purple-800 animate-pulse motion-reduce:animate-none',
        icon: '?',
        tooltip: 'We think this is you. Tap to confirm.',
      };
    case 'confirmed':
      return { className: 'bg-green-500 border-green-700 text-white', icon: '✓', tooltip: 'Confirmed by you.' };
    case 'false_positive':
      return {
        className: 'bg-gray-200 border-gray-400 text-gray-500 line-through',
        icon: '✕',
        tooltip: 'You said this is not you.',
      };
    case 'disputed':
      return {
        className: 'bg-orange-100 border-orange-500 text-orange-800',
        icon: '!',
        tooltip: 'You disputed this high-confidence finding. Logged for review.',
      };
    case 'checked':
      return { className: 'bg-green-100 border-green-600 text-green-800', icon: '✓', tooltip: 'Checked.' };
    case 'given':
      return { className: 'bg-blue-100 border-blue-500 text-blue-800', icon: '•', tooltip: 'You gave us this.' };
    case 'not_checked':
    default:
      return { className: 'bg-gray-100 border-gray-300 text-gray-500', icon: '–', tooltip: 'Not checked.' };
  }
}
