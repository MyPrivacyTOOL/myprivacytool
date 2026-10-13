// MPC-7651: OpenAPI 3.0 description of the partner API, served at GET /v1/openapi.json. api.test.ts checks every path here is routed.
const err = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const typeEnum = ['email', 'phone', 'handle', 'domain'];

export const OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'MyPrivacyTOOL Partner API',
    version: '1.0.0',
    description:
      'Server-to-server API for businesses that embed MyPrivacyTOOL exposure checks. $0.10 per checked scan with volume discounts (GET /v1/usage). ' +
      'A lookup that could not be checked (status "not_checked") is never billed and never scored. Never call this API from a browser: keys are secret and requests carrying an Origin header are refused.',
  },
  servers: [{ url: 'https://api.myprivacytool.io', description: 'Production (domain to be confirmed at deploy)' }],
  security: [{ ApiKey: [] }],
  paths: {
    '/v1/health': { get: { summary: 'Liveness', security: [], responses: { '200': { description: 'ok' } } } },
    '/v1/scan': {
      post: {
        summary: 'Run an exposure check on one identifier',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ScanRequest' } } } },
        responses: { '200': { description: 'Scan result', content: { 'application/json': { schema: { $ref: '#/components/schemas/ScanResponse' } } } }, '400': err, '401': err, '403': err, '429': err },
      },
    },
    '/v1/report/{id}': {
      get: {
        summary: 'Fetch a stored scan result (kept 30 days)',
        parameters: [idParam],
        responses: { '200': { description: 'Scan result', content: { 'application/json': { schema: { $ref: '#/components/schemas/ScanResponse' } } } }, '401': err, '404': err, '410': err },
      },
    },
    '/v1/monitors': {
      post: {
        summary: 'Register an identifier for monitoring (re-check runner not live yet)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MonitorRequest' } } } },
        responses: { '201': { description: 'Monitor created' }, '400': err, '401': err, '429': err },
      },
      get: { summary: 'List active monitors', responses: { '200': { description: 'Monitors' }, '401': err } },
    },
    '/v1/monitors/{id}': {
      delete: { summary: 'Stop monitoring and erase the stored identifier', parameters: [idParam], responses: { '204': { description: 'Deleted' }, '401': err, '404': err } },
    },
    '/v1/usage': {
      get: {
        summary: 'Billable scans and amount for a UTC month',
        parameters: [{ name: 'month', in: 'query', required: false, schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } }],
        responses: { '200': { description: 'Usage' }, '400': err, '401': err },
      },
    },
  },
  components: {
    securitySchemes: { ApiKey: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer mpt_live_...' } },
    schemas: {
      Error: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } } },
      ScanRequest: {
        type: 'object', required: ['value', 'type'],
        properties: { value: { type: 'string', maxLength: 320 }, type: { type: 'string', enum: typeEnum }, reference: { type: 'string', maxLength: 128, description: 'Your own id for the person or case. Do not put personal data here.' } },
      },
      ScanResponse: {
        type: 'object',
        properties: {
          scan_id: { type: 'string', format: 'uuid' }, created_at: { type: 'string', format: 'date-time' }, type: { type: 'string', enum: typeEnum },
          reference: { type: 'string', nullable: true }, status: { type: 'string', enum: ['checked', 'not_checked'] }, billable: { type: 'boolean' },
          result: { type: 'object', description: 'Risk summary (score, level, breach_names, next_steps, ...)' },
        },
      },
      MonitorRequest: {
        type: 'object', required: ['value', 'type', 'webhook_url', 'subject_consent'],
        properties: {
          value: { type: 'string', maxLength: 320 }, type: { type: 'string', enum: typeEnum }, webhook_url: { type: 'string', format: 'uri', description: 'https only' },
          subject_consent: { type: 'boolean', description: 'Must be true: you attest the person agreed to be monitored.' }, reference: { type: 'string', maxLength: 128 },
        },
      },
    },
  },
} as const;
