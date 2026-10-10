// @vitest-environment node
/**
 * Mirror & Risk Engine — Comprehensive Test Suite
 * Tests: OSINT lookup, risk scoring, response templates
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { osintLookup, clearOsintCache, type OsintLookupResult } from '../osintLookup';
import { executeRiskAnalysis } from '../mirrorRiskOrchestrator';
import {
  calculateExposureScore,
  extractRiskMetrics,
  generateRiskSummary,
  getStateTransition,
} from '../riskScoring';
import {
  generateRiskResponse,
  generateRiskCard,
  validateRiskResponse,
  serializeRiskResponse,
  deserializeRiskResponse,
} from '../riskResponseTemplate';

describe('Mirror & Risk Engine - MPC-7252', () => {
  beforeEach(() => clearOsintCache());

  // ============ OSINT Lookup Tests ============

  describe('osintLookup: Email Validation', () => {
    it('should reject invalid email formats', async () => {
      const invalidEmails = [
        'not-an-email',
        '@example.com',
        'user@',
        'user @example.com',
        '',
      ];

      for (const email of invalidEmails) {
        await expect(osintLookup(email, 'email')).rejects.toThrow(
          'Invalid email format'
        );
      }
    });

    it('should not echo the raw value in validation errors', async () => {
      await expect(osintLookup('secret person@', 'email')).rejects.toThrow(/^Invalid email format$/);
    });
  });

  describe('osintLookup: Phone Validation', () => {
    it('should accept E.164 and common phone formats', () => {
      const validPhones = [
        '+1-555-0123',
        '+86 10 1234 5678',
        '555-123-4567',
        '(555) 123-4567',
      ];

      // Validate format
      const phoneRegex = /^[\d\s\-\+\(\)]{7,}$/;
      validPhones.forEach(phone => {
        expect(phoneRegex.test(phone.replace(/\s/g, ''))).toBe(true);
      });
    });

    it('should reject invalid phone numbers', () => {
      const invalidPhones = ['', '123', 'not-a-phone'];
      const phoneRegex = /^[\d\s\-\+\(\)]{7,}$/;

      invalidPhones.forEach(phone => {
        expect(phoneRegex.test(phone.replace(/\s/g, ''))).toBe(false);
      });
    });
  });

  describe('osintLookup: Handle Validation', () => {
    it('should accept valid handles', () => {
      const validHandles = ['john_doe', 'alice-smith', 'user123'];
      const handleRegex = /^[a-zA-Z0-9_\-]{3,50}$/;

      validHandles.forEach(handle => {
        expect(handleRegex.test(handle)).toBe(true);
      });
    });

    it('should reject invalid handles', () => {
      const invalidHandles = ['ab', 'user@domain', 'user.name'];
      const handleRegex = /^[a-zA-Z0-9_\-]{3,50}$/;

      invalidHandles.forEach(handle => {
        expect(handleRegex.test(handle)).toBe(false);
      });
    });
  });

  describe('osintLookup: Domain Validation', () => {
    it('should accept valid domains', () => {
      const validDomains = ['example.com', 'sub.example.co.uk', 'my-domain.org'];
      const domainRegex =
        /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

      validDomains.forEach(domain => {
        expect(domainRegex.test(domain)).toBe(true);
      });
    });

    it('should reject invalid domains', () => {
      const invalidDomains = ['', '.com', 'example.', 'example-', 'example .com'];
      const domainRegex =
        /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

      invalidDomains.forEach(domain => {
        expect(domainRegex.test(domain)).toBe(false);
      });
    });
  });

  // ============ Risk Scoring Tests ============

  describe('calculateExposureScore: Deterministic Formula', () => {
    const mockLookup = (
      breachCount: number,
      pasteCount: number
    ): OsintLookupResult => ({
      inputValue: 'test@example.com',
      inputType: 'email',
      status: 'checked',
      breaches: Array(breachCount).fill({
        name: 'TestBreach',
        date: '2024-01-01',
        dataClasses: ['Email Addresses'],
      }),
      pastes: Array(pasteCount).fill({
        id: '123',
        date: '2024-01-01',
        count: 100,
        source: 'Paste',
      }),
      breachCount,
      pasteCount,
      timestamp: new Date().toISOString(),
      cached: false,
      confidence: 'high',
    });

    it('should calculate medium risk (1-29)', () => {
      // 1 breach = 10, 0 pastes = 0, total = 10
      const result = calculateExposureScore(mockLookup(1, 0));
      expect(result.score).toBe(10);
      expect(result.riskLevel).toBe('medium');
    });

    it('should calculate high risk (30-59)', () => {
      // 3 breaches = 30, 2 pastes = 10, total = 40
      const result = calculateExposureScore(mockLookup(3, 2));
      expect(result.score).toBe(40);
      expect(result.riskLevel).toBe('high');
    });

    it('should calculate critical risk (60+)', () => {
      // 6 breaches = 60, 3 pastes = 15, total = 75
      const result = calculateExposureScore(mockLookup(6, 3));
      expect(result.score).toBe(75);
      expect(result.riskLevel).toBe('critical');
    });

    it('should calculate critical risk at the cap', () => {
      // 8 breaches = 80, 4 pastes = 20, total = 100 (capped)
      const result = calculateExposureScore(mockLookup(8, 4));
      expect(result.score).toBe(100);
      expect(result.riskLevel).toBe('critical');
    });

    it('should cap score at 100', () => {
      const result = calculateExposureScore(mockLookup(20, 20));
      expect(result.score).toEqual(100);
    });

    it('should return 0 for no breaches/pastes', () => {
      const result = calculateExposureScore(mockLookup(0, 0));
      expect(result.score).toBe(0);
      expect(result.riskLevel).toBe('low');
    });
  });

  describe('calculateExposureScore: Contributions', () => {
    it('should split contribution correctly', () => {
      const lookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: Array(5).fill({
          name: 'TestBreach',
          date: '2024-01-01',
          dataClasses: [],
        }),
        pastes: Array(3).fill({
          id: '123',
          date: '2024-01-01',
          count: 100,
          source: 'Paste',
        }),
        breachCount: 5,
        pasteCount: 3,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const result = calculateExposureScore(lookup);
      expect(result.breachContribution).toBe(50); // 5 * 10
      expect(result.pasteContribution).toBe(15); // 3 * 5
      expect(result.score).toBe(65);
    });
  });

  describe('extractRiskMetrics: Data Classification', () => {
    it('should extract common data classes', () => {
      const lookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: [
          {
            name: 'Breach1',
            date: '2024-01-01',
            dataClasses: ['Email Addresses', 'Passwords'],
          },
          {
            name: 'Breach2',
            date: '2024-01-01',
            dataClasses: ['Email Addresses', 'Names'],
          },
        ],
        pastes: [],
        breachCount: 2,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const metrics = extractRiskMetrics(lookup);
      expect(metrics.uniqueDataTypes).toBe(3);
      expect(metrics.commonDataClasses).toContain('Email Addresses');
    });

    it('should detect recent breaches', () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const lookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: [
          {
            name: 'RecentBreach',
            date: recentDate.toISOString().split('T')[0],
            dataClasses: ['Email Addresses'],
          },
        ],
        pastes: [],
        breachCount: 1,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const metrics = extractRiskMetrics(lookup);
      expect(metrics.temporalRisk).toBe('recent');
    });
  });

  // ============ Response Template Tests ============

  describe('generateRiskResponse: Complete Response', () => {
    it('should generate valid response structure', () => {
      const lookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: Array(2).fill({
          name: 'TestBreach',
          date: '2024-01-01',
          dataClasses: ['Email Addresses'],
        }),
        pastes: [],
        breachCount: 2,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const response = generateRiskResponse(lookup);

      expect(validateRiskResponse(response)).toBe(true);
      expect(response.score).toBe(20);
      expect(response.level).toBe('medium');
      expect(response.next_steps).toBeDefined();
      expect(response.next_steps.length).toBeGreaterThan(0);
    });

    it('should include all 29 localization keys', () => {
      const lookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: [],
        pastes: [],
        breachCount: 0,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const response = generateRiskResponse(lookup);
      expect(response.localization_keys.length).toBe(29);
    });
  });

  describe('generateRiskCard: UI Card Generation', () => {
    it('should generate correct card for critical risk', () => {
      const lookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: Array(10).fill({
          name: 'TestBreach',
          date: '2024-01-01',
          dataClasses: [],
        }),
        pastes: [],
        breachCount: 10,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const response = generateRiskResponse(lookup);
      const card = generateRiskCard(response);

      expect(card.level).toBe('critical');
      expect(card.primaryCTA).toBe('Act Now');
      expect(card.color).toBe('#7f1d1d');
      expect(card.icon).toBe('🔴');
    });

    it('should generate correct card for low risk', () => {
      const lookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: [],
        pastes: [],
        breachCount: 0,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const response = generateRiskResponse(lookup);
      const card = generateRiskCard(response);

      expect(card.level).toBe('low');
      expect(card.primaryCTA).toBe('Monitor');
      expect(card.color).toBe('#10b981');
      expect(card.secondaryCTA).toBeUndefined();
    });
  });

  // ============ Serialization Tests ============

  describe('Serialization & Deserialization', () => {
    it('should serialize and deserialize response', () => {
      const lookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: Array(1).fill({
          name: 'TestBreach',
          date: '2024-01-01',
          dataClasses: ['Email'],
        }),
        pastes: [],
        breachCount: 1,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const response = generateRiskResponse(lookup);
      const serialized = serializeRiskResponse(response);
      const deserialized = deserializeRiskResponse(serialized);

      expect(deserialized.score).toBe(response.score);
      expect(deserialized.level).toBe(response.level);
      expect(deserialized.exposure_count.breaches).toBe(1);
    });

    it('should reject invalid serialized response', () => {
      const invalidJson = '{"score": "not a number"}';
      expect(() => deserializeRiskResponse(invalidJson)).toThrow();
    });
  });

  // ============ State Transition Tests ============

  describe('getStateTransition: User State Logic', () => {
    it('should transition to at_risk for high/critical', () => {
      const lookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: Array(6).fill({
          name: 'TestBreach',
          date: '2024-01-01',
          dataClasses: [],
        }),
        pastes: [],
        breachCount: 6,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const score = calculateExposureScore(lookup);
      const transition = getStateTransition(score);

      expect(transition.currentState).toBe('at_risk');
      expect(transition.shouldEscalate).toBe(true);
      expect(transition.messageTone).toBe('urgent');
    });

    it('should transition to protected for low risk', () => {
      const lookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: [],
        pastes: [],
        breachCount: 0,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const score = calculateExposureScore(lookup);
      const transition = getStateTransition(score);

      expect(transition.currentState).toBe('protected');
      expect(transition.shouldReassure).toBe(true);
    });

    it('should detect recovery state', () => {
      const currentLookup: OsintLookupResult = {
        inputValue: 'test@example.com',
        inputType: 'email',
      status: 'checked',
        breaches: Array(2).fill({
          name: 'TestBreach',
          date: '2024-01-01',
          dataClasses: [],
        }),
        pastes: [],
        breachCount: 2,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'high',
      };

      const previousLookup: OsintLookupResult = {
        ...currentLookup,
        breachCount: 5,
      };

      const currentScore = calculateExposureScore(currentLookup);
      const previousScore = calculateExposureScore(previousLookup);
      const transition = getStateTransition(currentScore, previousScore);

      expect(transition.currentState).toBe('recovering');
      expect(transition.shouldReassure).toBe(true);
    });
  });
  // ============ Lookup behaviour (HIBP faked, no network) ============

  describe('osintLookup: HIBP behaviour', () => {
    const json = (status: number, body: unknown = []) => new Response(JSON.stringify(body), { status });

    it('sends the key in the hibp-api-key header, not the user-agent', async () => {
      const fetchImpl = vi.fn(async () => json(404)) as unknown as typeof fetch;
      await osintLookup('user@example.com', 'email', { apiKey: 'k3y', fetchImpl });
      const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];
      expect(calls).toHaveLength(2);
      for (const [, init] of calls) {
        const headers = init.headers as Record<string, string>;
        expect(headers['hibp-api-key']).toBe('k3y');
        expect(headers['user-agent']).not.toContain('k3y');
      }
    });

    it('treats 404 as checked with zero findings', async () => {
      const fetchImpl = (async () => json(404)) as unknown as typeof fetch;
      const r = await osintLookup('user@example.com', 'email', { apiKey: 'k', fetchImpl });
      expect(r.status).toBe('checked');
      expect(r.breachCount).toBe(0);
    });

    it('parses breaches and pastes', async () => {
      const fetchImpl = (async (url: string) =>
        url.includes('breachedaccount')
          ? json(200, [{ Name: 'Adobe', BreachDate: '2013-10-04', DataClasses: ['Passwords'] }])
          : json(200, [{ Id: 'p1', Date: '2020-01-01', EmailCount: 3, Source: 'Pastebin' }])) as unknown as typeof fetch;
      const r = await osintLookup('user@example.com', 'email', { apiKey: 'k', fetchImpl });
      expect(r.breachCount).toBe(1);
      expect(r.pasteCount).toBe(1);
      expect(r.breaches[0].name).toBe('Adobe');
    });

    it.each([429, 401, 500])('returns not_checked (never a clean result) on HTTP %i', async (status) => {
      const fetchImpl = (async () => json(status)) as unknown as typeof fetch;
      const r = await osintLookup('user@example.com', 'email', { apiKey: 'k', fetchImpl });
      expect(r.status).toBe('not_checked');
      expect(r.breachCount).toBe(0);
    });

    it('returns not_checked without a key and does not call HIBP', async () => {
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      const r = await osintLookup('user@example.com', 'email', { fetchImpl });
      expect(r.status).toBe('not_checked');
      expect(r.reason).toBe('no_api_key');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
      ['phone', '+1 555 123 4567'],
      ['handle', 'some_handle'],
      ['domain', 'example.com'],
    ] as const)('returns not_checked for %s (HIBP cannot answer it)', async (type, value) => {
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      const r = await osintLookup(value, type, { apiKey: 'k', fetchImpl });
      expect(r.status).toBe('not_checked');
      expect(r.reason).toBe('unsupported_type');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('caches checked results for 24h', async () => {
      const fetchImpl = vi.fn(async () => json(404)) as unknown as typeof fetch;
      await osintLookup('user@example.com', 'email', { apiKey: 'k', fetchImpl });
      const again = await osintLookup('user@example.com', 'email', { apiKey: 'k', fetchImpl });
      expect(again.cached).toBe(true);
      expect(again.inputValue).toBe('user@example.com');
      expect(fetchImpl).toHaveBeenCalledTimes(2); // 2 GETs for the first lookup only
    });

    it('does not cache failures', async () => {
      let status = 500;
      const fetchImpl = vi.fn(async () => json(status)) as unknown as typeof fetch;
      await osintLookup('user@example.com', 'email', { apiKey: 'k', fetchImpl });
      status = 404;
      const r = await osintLookup('user@example.com', 'email', { apiKey: 'k', fetchImpl });
      expect(r.status).toBe('checked');
    });
  });

  describe('not_checked responses carry no score', () => {
    it('template: null score, not_checked level, no reassurance', () => {
      const response = generateRiskResponse({
        inputValue: '+15551234567',
        inputType: 'phone',
        status: 'not_checked',
        reason: 'unsupported_type',
        breaches: [],
        pastes: [],
        breachCount: 0,
        pasteCount: 0,
        timestamp: new Date().toISOString(),
        cached: false,
        confidence: 'low',
      });
      expect(response.score).toBeNull();
      expect(response.level).toBe('not_checked');
      expect(response.state_transition.shouldReassure).toBe(false);
      expect(validateRiskResponse(response)).toBe(true);
      expect(generateRiskCard(response).title).toBe('Not checked');
    });

    it('orchestrator: phone lookup succeeds as not_checked, never "low"', async () => {
      const r = await executeRiskAnalysis({ value: '+1 555 123 4567', type: 'phone', apiKey: 'k' });
      expect(r.success).toBe(true);
      expect(r.data?.level).toBe('not_checked');
      expect(r.data?.score).toBeNull();
    });

    it('orchestrator: invalid input returns a coded error without echoing the value', async () => {
      const r = await executeRiskAnalysis({ value: 'not an email', type: 'email' });
      expect(r.success).toBe(false);
      expect(r.error?.code).toBe('INVALID_EMAIL');
      expect(JSON.stringify(r)).not.toContain('not an email');
    });
  });
});
