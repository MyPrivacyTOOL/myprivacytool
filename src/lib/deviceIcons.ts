// Device type to icon mapping
// Update these icons as needed - they can be emojis, image paths, or icon names
export const DEVICE_ICONS: Record<string, string> = {
  'Smartphone': '📱',
  'Mobile': '📱',
  'Tablet': '📲',
  'Desktop': '🖥️',
  'Laptop': '💻',
  'Smart TV': '📺',
  'Gaming Console': '🎮',
  'Smart Watch': '⌚',
};

// Default icon when device type is not recognized
export const DEFAULT_DEVICE_ICON = '📱';

// Helper function to get device icon
export function getDeviceIcon(deviceType: string): string {
  return DEVICE_ICONS[deviceType] || DEFAULT_DEVICE_ICON;
}
