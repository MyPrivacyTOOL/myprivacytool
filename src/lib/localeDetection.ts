// Locale Detection Utilities for LocaleIntent

export interface LocaleData {
  languages: string[];
  primaryLanguage: string;
  timezone: string;
  timezoneOffset: number;
  locale: string;
  dateFormat: string;
  numberFormat: string;
  currency: string;
}

export interface LocaleHexagonData {
  id: string;
  label: string;
  value: string;
  icon: string;
  confidence: number;
  description: string;
  category: 'language' | 'timezone' | 'profile' | 'format';
  confirmed: boolean;
}

export interface PredictionResult {
  preferredLanguage: string;
  languageConfidence: number;
  userProfile: 'expatriate' | 'traveler' | 'multilingual' | 'local';
  profileConfidence: number;
  recommendedUILanguage: string;
  uiConfidence: number;
  reasoning: string[];
}

// Language code to name mapping
const languageNames: Record<string, string> = {
  'en': 'English',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'es': 'Spanish',
  'es-ES': 'Spanish (Spain)',
  'es-MX': 'Spanish (Mexico)',
  'fr': 'French',
  'fr-FR': 'French (France)',
  'de': 'German',
  'de-DE': 'German (Germany)',
  'it': 'Italian',
  'pt': 'Portuguese',
  'pt-BR': 'Portuguese (Brazil)',
  'zh': 'Chinese',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  'ja': 'Japanese',
  'ko': 'Korean',
  'ru': 'Russian',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'nl': 'Dutch',
  'pl': 'Polish',
  'tr': 'Turkish',
  'vi': 'Vietnamese',
  'th': 'Thai',
  'sv': 'Swedish',
  'da': 'Danish',
  'no': 'Norwegian',
  'fi': 'Finnish',
  'cs': 'Czech',
  'el': 'Greek',
  'he': 'Hebrew',
  'id': 'Indonesian',
  'ms': 'Malay',
  'uk': 'Ukrainian',
  'ro': 'Romanian',
  'hu': 'Hungarian',
  'sk': 'Slovak',
  'bg': 'Bulgarian',
  'hr': 'Croatian',
  'ca': 'Catalan',
};

// Timezone to region mapping
const timezoneRegions: Record<string, string> = {
  'America/New_York': 'US East Coast',
  'America/Los_Angeles': 'US West Coast',
  'America/Chicago': 'US Central',
  'America/Denver': 'US Mountain',
  'Europe/London': 'United Kingdom',
  'Europe/Paris': 'France',
  'Europe/Berlin': 'Germany',
  'Europe/Madrid': 'Spain',
  'Europe/Rome': 'Italy',
  'Europe/Amsterdam': 'Netherlands',
  'Europe/Moscow': 'Russia',
  'Asia/Tokyo': 'Japan',
  'Asia/Shanghai': 'China',
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Singapore': 'Singapore',
  'Asia/Seoul': 'South Korea',
  'Asia/Dubai': 'UAE',
  'Asia/Kolkata': 'India',
  'Asia/Bangkok': 'Thailand',
  'Australia/Sydney': 'Australia East',
  'Australia/Melbourne': 'Australia',
  'Pacific/Auckland': 'New Zealand',
  'America/Sao_Paulo': 'Brazil',
  'America/Mexico_City': 'Mexico',
  'America/Toronto': 'Canada',
};

export function getLanguageName(code: string): string {
  return languageNames[code] || languageNames[code.split('-')[0]] || code;
}

export function getTimezoneRegion(timezone: string): string {
  return timezoneRegions[timezone] || timezone.replace(/_/g, ' ').split('/').pop() || timezone;
}

export function detectLocaleData(): LocaleData {
  const languages = navigator.languages ? [...navigator.languages] : [navigator.language];
  const primaryLanguage = navigator.language;
  
  const dateTimeFormat = Intl.DateTimeFormat().resolvedOptions();
  const timezone = dateTimeFormat.timeZone;
  const locale = dateTimeFormat.locale;
  
  // Detect date format preference
  const testDate = new Date(2024, 0, 15);
  const dateFormat = new Intl.DateTimeFormat(locale).format(testDate);
  
  // Detect number format
  const numberFormat = new Intl.NumberFormat(locale).format(1234.56);
  
  // Detect currency
  let currency = 'USD';
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).formatToParts(100);
    currency = parts.find(p => p.type === 'currency')?.value || 'USD';
  } catch {
    currency = 'USD';
  }
  
  return {
    languages,
    primaryLanguage,
    timezone,
    timezoneOffset: new Date().getTimezoneOffset(),
    locale,
    dateFormat,
    numberFormat,
    currency,
  };
}

export function generateLocaleHexagons(data: LocaleData): LocaleHexagonData[] {
  const hexagons: LocaleHexagonData[] = [];
  
  // Primary language
  hexagons.push({
    id: 'primary-lang',
    label: 'Primary Language',
    value: getLanguageName(data.primaryLanguage),
    icon: '🌐',
    confidence: 95,
    description: `Your browser reports ${data.primaryLanguage} as your preferred language`,
    category: 'language',
    confirmed: false,
  });
  
  // Fallback languages
  if (data.languages.length > 1) {
    hexagons.push({
      id: 'fallback-langs',
      label: 'Fallback Languages',
      value: data.languages.slice(1, 3).map(l => getLanguageName(l)).join(', '),
      icon: '🔄',
      confidence: 88,
      description: `You have ${data.languages.length - 1} additional language preferences configured`,
      category: 'language',
      confirmed: false,
    });
  }
  
  // Timezone
  hexagons.push({
    id: 'timezone',
    label: 'Timezone',
    value: getTimezoneRegion(data.timezone),
    icon: '🕐',
    confidence: 99,
    description: `Detected from your system: ${data.timezone}`,
    category: 'timezone',
    confirmed: false,
  });
  
  // Locale
  hexagons.push({
    id: 'locale',
    label: 'Locale Format',
    value: data.locale,
    icon: '📍',
    confidence: 92,
    description: 'Your regional formatting preferences',
    category: 'format',
    confirmed: false,
  });
  
  // Date format
  hexagons.push({
    id: 'date-format',
    label: 'Date Format',
    value: data.dateFormat,
    icon: '📅',
    confidence: 90,
    description: 'How dates are displayed on your system',
    category: 'format',
    confirmed: false,
  });
  
  // Number format
  hexagons.push({
    id: 'number-format',
    label: 'Number Format',
    value: data.numberFormat,
    icon: '🔢',
    confidence: 90,
    description: 'Your number formatting preference',
    category: 'format',
    confirmed: false,
  });
  
  return hexagons;
}

// Placeholder prediction function (will be replaced with TensorFlow.js model)
export function predictLanguagePreference(data: LocaleData): PredictionResult {
  const reasoning: string[] = [];
  
  // Analyze language diversity
  const uniqueLanguageFamilies = new Set(data.languages.map(l => l.split('-')[0]));
  const isMultilingual = uniqueLanguageFamilies.size > 1;
  
  // Check for timezone/language mismatch
  const timezoneLanguage = getTimezoneLanguage(data.timezone);
  const primaryLang = data.primaryLanguage.split('-')[0];
  const isMismatch = timezoneLanguage && timezoneLanguage !== primaryLang;
  
  // Determine user profile
  let userProfile: 'expatriate' | 'traveler' | 'multilingual' | 'local' = 'local';
  let profileConfidence = 70;
  
  if (isMismatch) {
    userProfile = 'expatriate';
    profileConfidence = 85;
    reasoning.push(`Language (${primaryLang}) doesn't match timezone region (${timezoneLanguage})`);
  } else if (isMultilingual && data.languages.length >= 3) {
    userProfile = 'multilingual';
    profileConfidence = 80;
    reasoning.push(`${data.languages.length} languages configured suggests multilingual user`);
  } else if (isMultilingual) {
    userProfile = 'traveler';
    profileConfidence = 65;
    reasoning.push('Multiple language families detected');
  } else {
    reasoning.push('Language and timezone align with local user pattern');
  }
  
  // Predict preferred language
  const preferredLanguage = getLanguageName(data.primaryLanguage);
  const languageConfidence = 90 + Math.floor(Math.random() * 8);
  reasoning.push(`Primary browser language: ${data.primaryLanguage}`);
  
  // Recommended UI language
  const recommendedUILanguage = data.primaryLanguage.split('-')[0];
  const uiConfidence = languageConfidence - 5;
  
  return {
    preferredLanguage,
    languageConfidence,
    userProfile,
    profileConfidence,
    recommendedUILanguage: getLanguageName(recommendedUILanguage),
    uiConfidence,
    reasoning,
  };
}

function getTimezoneLanguage(timezone: string): string | null {
  const tzToLang: Record<string, string> = {
    'America/New_York': 'en',
    'America/Los_Angeles': 'en',
    'America/Chicago': 'en',
    'Europe/London': 'en',
    'Europe/Paris': 'fr',
    'Europe/Berlin': 'de',
    'Europe/Madrid': 'es',
    'Europe/Rome': 'it',
    'Asia/Tokyo': 'ja',
    'Asia/Shanghai': 'zh',
    'Asia/Seoul': 'ko',
    'America/Sao_Paulo': 'pt',
    'America/Mexico_City': 'es',
  };
  
  return tzToLang[timezone] || null;
}
