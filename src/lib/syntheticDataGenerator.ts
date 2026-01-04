// Synthetic Data Generator for Language Prediction Model Training

export interface SyntheticExample {
  id: string;
  languages: string[];
  timezone: string;
  labels: {
    local: number;
    expatriate: number;
    traveler: number;
    multilingual: number;
  };
  confidence: number;
  pattern: string;
}

// Realistic language patterns based on navigator.languages data
const languagePatterns = {
  local: [
    { languages: ['en-US'], regions: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'] },
    { languages: ['en-GB'], regions: ['Europe/London'] },
    { languages: ['es-ES', 'es'], regions: ['Europe/Madrid'] },
    { languages: ['es-MX', 'es'], regions: ['America/Mexico_City'] },
    { languages: ['fr-FR', 'fr'], regions: ['Europe/Paris'] },
    { languages: ['de-DE', 'de'], regions: ['Europe/Berlin'] },
    { languages: ['it-IT', 'it'], regions: ['Europe/Rome'] },
    { languages: ['pt-BR', 'pt'], regions: ['America/Sao_Paulo'] },
    { languages: ['pt-PT', 'pt'], regions: ['Europe/Lisbon'] },
    { languages: ['ja-JP', 'ja'], regions: ['Asia/Tokyo'] },
    { languages: ['ko-KR', 'ko'], regions: ['Asia/Seoul'] },
    { languages: ['zh-CN', 'zh'], regions: ['Asia/Shanghai'] },
    { languages: ['zh-TW', 'zh'], regions: ['Asia/Taipei'] },
    { languages: ['ru-RU', 'ru'], regions: ['Europe/Moscow'] },
    { languages: ['ar-SA', 'ar'], regions: ['Asia/Riyadh'] },
    { languages: ['hi-IN', 'hi'], regions: ['Asia/Kolkata'] },
    { languages: ['nl-NL', 'nl'], regions: ['Europe/Amsterdam'] },
    { languages: ['pl-PL', 'pl'], regions: ['Europe/Warsaw'] },
    { languages: ['tr-TR', 'tr'], regions: ['Europe/Istanbul'] },
    { languages: ['sv-SE', 'sv'], regions: ['Europe/Stockholm'] },
  ],
  expatriate: [
    { languages: ['es-ES', 'es', 'en-GB'], timezones: ['Europe/London'], home: 'Spain' },
    { languages: ['pl-PL', 'pl', 'en-GB'], timezones: ['Europe/London'], home: 'Poland' },
    { languages: ['fr-FR', 'fr', 'en-US'], timezones: ['America/New_York'], home: 'France' },
    { languages: ['de-DE', 'de', 'en-US'], timezones: ['America/Los_Angeles'], home: 'Germany' },
    { languages: ['zh-CN', 'zh', 'en-US'], timezones: ['America/Los_Angeles', 'America/New_York'], home: 'China' },
    { languages: ['hi-IN', 'hi', 'en-US'], timezones: ['America/New_York', 'America/Chicago'], home: 'India' },
    { languages: ['pt-BR', 'pt', 'en-US'], timezones: ['America/New_York', 'America/Miami'], home: 'Brazil' },
    { languages: ['it-IT', 'it', 'de-DE'], timezones: ['Europe/Berlin'], home: 'Italy' },
    { languages: ['ru-RU', 'ru', 'de-DE'], timezones: ['Europe/Berlin'], home: 'Russia' },
    { languages: ['tr-TR', 'tr', 'de-DE'], timezones: ['Europe/Berlin'], home: 'Turkey' },
    { languages: ['ar-EG', 'ar', 'en-GB'], timezones: ['Europe/London'], home: 'Egypt' },
    { languages: ['ko-KR', 'ko', 'en-US'], timezones: ['America/Los_Angeles'], home: 'Korea' },
    { languages: ['ja-JP', 'ja', 'en-US'], timezones: ['America/Los_Angeles', 'America/New_York'], home: 'Japan' },
    { languages: ['vi-VN', 'vi', 'en-US'], timezones: ['America/Los_Angeles'], home: 'Vietnam' },
    { languages: ['th-TH', 'th', 'en-SG'], timezones: ['Asia/Singapore'], home: 'Thailand' },
  ],
  traveler: [
    { languages: ['en-US', 'ja-JP'], timezone: 'Asia/Tokyo', origin: 'US' },
    { languages: ['en-US', 'fr-FR'], timezone: 'Europe/Paris', origin: 'US' },
    { languages: ['en-US', 'es-ES'], timezone: 'Europe/Madrid', origin: 'US' },
    { languages: ['en-US', 'it-IT'], timezone: 'Europe/Rome', origin: 'US' },
    { languages: ['en-GB', 'es-ES'], timezone: 'Europe/Madrid', origin: 'UK' },
    { languages: ['de-DE', 'en-US'], timezone: 'America/New_York', origin: 'Germany' },
    { languages: ['fr-FR', 'en-GB'], timezone: 'Europe/London', origin: 'France' },
    { languages: ['ja-JP', 'en-US'], timezone: 'America/Los_Angeles', origin: 'Japan' },
    { languages: ['ko-KR', 'en-US'], timezone: 'America/New_York', origin: 'Korea' },
    { languages: ['zh-CN', 'en-SG'], timezone: 'Asia/Singapore', origin: 'China' },
    { languages: ['en-AU', 'id-ID'], timezone: 'Asia/Jakarta', origin: 'Australia' },
    { languages: ['en-US', 'th-TH'], timezone: 'Asia/Bangkok', origin: 'US' },
    { languages: ['ru-RU', 'tr-TR'], timezone: 'Europe/Istanbul', origin: 'Russia' },
    { languages: ['en-US', 'pt-BR'], timezone: 'America/Sao_Paulo', origin: 'US' },
    { languages: ['de-DE', 'es-ES'], timezone: 'Europe/Madrid', origin: 'Germany' },
  ],
  multilingual: [
    { languages: ['en-US', 'zh-CN', 'ja-JP'], regions: ['America/Los_Angeles', 'Asia/Shanghai'] },
    { languages: ['en-US', 'es-MX', 'pt-BR'], regions: ['America/New_York', 'America/Mexico_City'] },
    { languages: ['fr-FR', 'en-GB', 'de-DE'], regions: ['Europe/Paris', 'Europe/London', 'Europe/Berlin'] },
    { languages: ['en-US', 'hi-IN', 'ta-IN'], regions: ['Asia/Kolkata', 'America/New_York'] },
    { languages: ['ar-SA', 'en-GB', 'fr-FR'], regions: ['Europe/Paris', 'Asia/Dubai'] },
    { languages: ['zh-CN', 'en-US', 'ko-KR'], regions: ['Asia/Seoul', 'Asia/Shanghai'] },
    { languages: ['es-ES', 'ca-ES', 'en-GB'], regions: ['Europe/Madrid'] },
    { languages: ['nl-NL', 'de-DE', 'en-GB', 'fr-FR'], regions: ['Europe/Amsterdam', 'Europe/Brussels'] },
    { languages: ['en-SG', 'zh-CN', 'ms-MY', 'ta-IN'], regions: ['Asia/Singapore'] },
    { languages: ['en-IN', 'hi-IN', 'te-IN', 'ta-IN'], regions: ['Asia/Kolkata'] },
    { languages: ['ru-RU', 'uk-UA', 'en-US'], regions: ['Europe/Kiev', 'Europe/Moscow'] },
    { languages: ['pt-BR', 'es-ES', 'en-US'], regions: ['America/Sao_Paulo'] },
    { languages: ['ja-JP', 'en-US', 'zh-CN'], regions: ['Asia/Tokyo'] },
    { languages: ['de-AT', 'de-DE', 'en-US', 'hu-HU'], regions: ['Europe/Vienna'] },
    { languages: ['sv-SE', 'no-NO', 'da-DK', 'en-US'], regions: ['Europe/Stockholm', 'Europe/Oslo'] },
  ],
};

// All available IANA timezones for variety
const allTimezones = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Toronto', 'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo',
  'America/Buenos_Aires', 'America/Lima', 'America/Bogota', 'America/Santiago',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Vienna', 'Europe/Warsaw',
  'Europe/Prague', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Helsinki',
  'Europe/Moscow', 'Europe/Istanbul', 'Europe/Athens', 'Europe/Lisbon',
  'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei',
  'Asia/Singapore', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Kolkata', 'Asia/Dubai',
  'Asia/Riyadh', 'Asia/Jerusalem', 'Asia/Manila', 'Asia/Kuala_Lumpur',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Brisbane',
  'Pacific/Auckland', 'Pacific/Honolulu', 'Pacific/Fiji',
  'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi',
];

// Generate unique ID
const generateId = (): string => {
  return `syn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Normalize probabilities to sum to 1.0
const normalizeProbabilities = (labels: SyntheticExample['labels']): SyntheticExample['labels'] => {
  const sum = labels.local + labels.expatriate + labels.traveler + labels.multilingual;
  if (sum === 0) return { local: 0.25, expatriate: 0.25, traveler: 0.25, multilingual: 0.25 };
  return {
    local: labels.local / sum,
    expatriate: labels.expatriate / sum,
    traveler: labels.traveler / sum,
    multilingual: labels.multilingual / sum,
  };
};

// Add noise to probabilities for realism
const addNoise = (value: number, range: number = 0.1): number => {
  const noise = (Math.random() - 0.5) * 2 * range;
  return Math.max(0, Math.min(1, value + noise));
};

// Generate local examples
const generateLocalExamples = (count: number): SyntheticExample[] => {
  const examples: SyntheticExample[] = [];
  
  for (let i = 0; i < count; i++) {
    const pattern = languagePatterns.local[Math.floor(Math.random() * languagePatterns.local.length)];
    const timezone = pattern.regions[Math.floor(Math.random() * pattern.regions.length)];
    
    // Sometimes include just the primary language, sometimes include secondary
    const languages = Math.random() > 0.3 
      ? pattern.languages 
      : [pattern.languages[0]];
    
    const baseConfidence = 0.85 + Math.random() * 0.15;
    
    examples.push({
      id: generateId(),
      languages,
      timezone,
      labels: normalizeProbabilities({
        local: addNoise(0.85, 0.1),
        expatriate: addNoise(0.05, 0.05),
        traveler: addNoise(0.05, 0.05),
        multilingual: addNoise(0.05, 0.05),
      }),
      confidence: baseConfidence,
      pattern: 'local',
    });
  }
  
  return examples;
};

// Generate expatriate examples
const generateExpatriateExamples = (count: number): SyntheticExample[] => {
  const examples: SyntheticExample[] = [];
  
  for (let i = 0; i < count; i++) {
    const pattern = languagePatterns.expatriate[Math.floor(Math.random() * languagePatterns.expatriate.length)];
    const timezone = pattern.timezones[Math.floor(Math.random() * pattern.timezones.length)];
    
    // Vary language list length
    const langCount = 2 + Math.floor(Math.random() * (pattern.languages.length - 1));
    const languages = pattern.languages.slice(0, langCount);
    
    const baseConfidence = 0.75 + Math.random() * 0.2;
    
    examples.push({
      id: generateId(),
      languages,
      timezone,
      labels: normalizeProbabilities({
        local: addNoise(0.1, 0.08),
        expatriate: addNoise(0.75, 0.12),
        traveler: addNoise(0.1, 0.08),
        multilingual: addNoise(0.05, 0.05),
      }),
      confidence: baseConfidence,
      pattern: 'expatriate',
    });
  }
  
  return examples;
};

// Generate traveler examples
const generateTravelerExamples = (count: number): SyntheticExample[] => {
  const examples: SyntheticExample[] = [];
  
  for (let i = 0; i < count; i++) {
    const pattern = languagePatterns.traveler[Math.floor(Math.random() * languagePatterns.traveler.length)];
    
    const baseConfidence = 0.65 + Math.random() * 0.25;
    
    examples.push({
      id: generateId(),
      languages: pattern.languages,
      timezone: pattern.timezone,
      labels: normalizeProbabilities({
        local: addNoise(0.1, 0.08),
        expatriate: addNoise(0.15, 0.1),
        traveler: addNoise(0.65, 0.15),
        multilingual: addNoise(0.1, 0.08),
      }),
      confidence: baseConfidence,
      pattern: 'traveler',
    });
  }
  
  return examples;
};

// Generate multilingual examples
const generateMultilingualExamples = (count: number): SyntheticExample[] => {
  const examples: SyntheticExample[] = [];
  
  for (let i = 0; i < count; i++) {
    const pattern = languagePatterns.multilingual[Math.floor(Math.random() * languagePatterns.multilingual.length)];
    const timezone = pattern.regions[Math.floor(Math.random() * pattern.regions.length)];
    
    const baseConfidence = 0.7 + Math.random() * 0.25;
    
    examples.push({
      id: generateId(),
      languages: pattern.languages,
      timezone,
      labels: normalizeProbabilities({
        local: addNoise(0.1, 0.08),
        expatriate: addNoise(0.1, 0.08),
        traveler: addNoise(0.1, 0.08),
        multilingual: addNoise(0.7, 0.15),
      }),
      confidence: baseConfidence,
      pattern: 'multilingual',
    });
  }
  
  return examples;
};

// Generate edge cases and ambiguous examples
const generateEdgeCases = (count: number): SyntheticExample[] => {
  const examples: SyntheticExample[] = [];
  
  for (let i = 0; i < count; i++) {
    // Random timezone that doesn't match
    const randomTimezone = allTimezones[Math.floor(Math.random() * allTimezones.length)];
    const localPattern = languagePatterns.local[Math.floor(Math.random() * languagePatterns.local.length)];
    
    // Mixed signals - language doesn't match timezone
    examples.push({
      id: generateId(),
      languages: localPattern.languages,
      timezone: randomTimezone,
      labels: normalizeProbabilities({
        local: addNoise(0.25, 0.15),
        expatriate: addNoise(0.35, 0.15),
        traveler: addNoise(0.25, 0.15),
        multilingual: addNoise(0.15, 0.1),
      }),
      confidence: 0.4 + Math.random() * 0.3,
      pattern: 'edge_case',
    });
  }
  
  return examples;
};

// Main function to generate synthetic data
export const generateSyntheticData = (count: number = 1000): SyntheticExample[] => {
  // Distribution: 35% local, 25% expatriate, 20% traveler, 15% multilingual, 5% edge cases
  const localCount = Math.floor(count * 0.35);
  const expatriateCount = Math.floor(count * 0.25);
  const travelerCount = Math.floor(count * 0.20);
  const multilingualCount = Math.floor(count * 0.15);
  const edgeCaseCount = count - localCount - expatriateCount - travelerCount - multilingualCount;
  
  const examples = [
    ...generateLocalExamples(localCount),
    ...generateExpatriateExamples(expatriateCount),
    ...generateTravelerExamples(travelerCount),
    ...generateMultilingualExamples(multilingualCount),
    ...generateEdgeCases(edgeCaseCount),
  ];
  
  // Shuffle the array
  for (let i = examples.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [examples[i], examples[j]] = [examples[j], examples[i]];
  }
  
  // Remove duplicates based on language+timezone combination
  const seen = new Set<string>();
  const unique = examples.filter(ex => {
    const key = `${ex.languages.join(',')}|${ex.timezone}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  return unique;
};

// Validate synthetic examples
export const validateExamples = (examples: SyntheticExample[]): { valid: number; invalid: number; issues: string[] } => {
  const issues: string[] = [];
  let valid = 0;
  let invalid = 0;
  
  examples.forEach((ex, idx) => {
    const sum = ex.labels.local + ex.labels.expatriate + ex.labels.traveler + ex.labels.multilingual;
    
    if (Math.abs(sum - 1.0) > 0.01) {
      issues.push(`Example ${idx}: Probabilities sum to ${sum.toFixed(3)} instead of 1.0`);
      invalid++;
    } else if (ex.languages.length === 0) {
      issues.push(`Example ${idx}: Empty languages array`);
      invalid++;
    } else if (!ex.timezone) {
      issues.push(`Example ${idx}: Missing timezone`);
      invalid++;
    } else {
      valid++;
    }
  });
  
  return { valid, invalid, issues };
};

// Export to JSON file
export const exportToJSON = (examples?: SyntheticExample[]): void => {
  const data = examples || generateSyntheticData(1000);
  const validation = validateExamples(data);
  
  const exportData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalExamples: data.length,
      validation: {
        valid: validation.valid,
        invalid: validation.invalid,
      },
      distribution: {
        local: data.filter(e => e.pattern === 'local').length,
        expatriate: data.filter(e => e.pattern === 'expatriate').length,
        traveler: data.filter(e => e.pattern === 'traveler').length,
        multilingual: data.filter(e => e.pattern === 'multilingual').length,
        edge_case: data.filter(e => e.pattern === 'edge_case').length,
      },
    },
    examples: data,
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `training_data_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Get statistics about generated data
export const getDataStats = (examples: SyntheticExample[]) => {
  const byPattern = {
    local: examples.filter(e => e.pattern === 'local'),
    expatriate: examples.filter(e => e.pattern === 'expatriate'),
    traveler: examples.filter(e => e.pattern === 'traveler'),
    multilingual: examples.filter(e => e.pattern === 'multilingual'),
    edge_case: examples.filter(e => e.pattern === 'edge_case'),
  };
  
  const avgConfidence = (arr: SyntheticExample[]) => 
    arr.length > 0 ? arr.reduce((sum, e) => sum + e.confidence, 0) / arr.length : 0;
  
  return {
    total: examples.length,
    byPattern: {
      local: { count: byPattern.local.length, avgConfidence: avgConfidence(byPattern.local) },
      expatriate: { count: byPattern.expatriate.length, avgConfidence: avgConfidence(byPattern.expatriate) },
      traveler: { count: byPattern.traveler.length, avgConfidence: avgConfidence(byPattern.traveler) },
      multilingual: { count: byPattern.multilingual.length, avgConfidence: avgConfidence(byPattern.multilingual) },
      edge_case: { count: byPattern.edge_case.length, avgConfidence: avgConfidence(byPattern.edge_case) },
    },
    uniqueTimezones: new Set(examples.map(e => e.timezone)).size,
    uniqueLanguageCombos: new Set(examples.map(e => e.languages.join(','))).size,
  };
};
