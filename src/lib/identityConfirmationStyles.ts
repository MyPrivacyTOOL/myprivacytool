import type { FindingStatus } from './identityConfirmation';

export interface FindingVisuals {
  className: string;
  icon: string;
  tooltip: string;
}

// `guess` pulses on purpose: it is the one state that asks the person to do something.
export function getFindingVisuals(status: FindingStatus): FindingVisuals {
  switch (status) {
    case 'guess':
      return { className: 'bg-purple-100 border-purple-500 text-purple-800 animate-pulse', icon: '?', tooltip: 'We think this is you. Tap to confirm.' };
    case 'confirmed':
      return { className: 'bg-green-500 border-green-700 text-white', icon: '✓', tooltip: 'Confirmed by you.' };
    case 'false_positive':
      return { className: 'bg-gray-200 border-gray-400 text-gray-500 line-through', icon: '✕', tooltip: 'You said this is not you.' };
    case 'disputed':
      return { className: 'bg-orange-100 border-orange-500 text-orange-800', icon: '!', tooltip: 'You disputed this finding. It is excluded from your score and flagged for review.' };
    case 'checked':
      return { className: 'bg-green-100 border-green-600 text-green-900', icon: '✓', tooltip: 'Found and checked.' };
    case 'given':
      return { className: 'bg-blue-100 border-blue-500 text-blue-900', icon: '•', tooltip: 'You gave us this.' };
    case 'not_checked':
    default:
      return { className: 'bg-gray-100 border-gray-300 border-dashed text-gray-600', icon: '–', tooltip: 'Not checked.' };
  }
}
