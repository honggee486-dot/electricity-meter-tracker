export type BillingClose = { kind: 'day'; day: number } | { kind: 'month-end' };
export type MeterRole = 'owner' | 'viewer';
export type UtilityKind = 'electricity' | 'gas';

export interface SessionResponse {
  authenticated: true;
  userId: string;
}

export interface AuthConfigResponse {
  googleClientId: string;
}

export interface MeterResource {
  meterId: string;
  name: string;
  timezone: string;
  utilityKind: UtilityKind;
  billingClose: BillingClose;
  role: MeterRole;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ReadingResource {
  readingId: string;
  meterId: string;
  measuredAtMs: number;
  // Non-negative fixed-point counter in 1/1000 steps of the meter's immutable
  // base unit: electricity 1 = 1 Wh, gas 1 = 0.001 m³.
  cumulativeMilliUnit: number;
  createdAtMs: number;
}

export interface MeterSettingsInput {
  name: string;
  timezone: string;
  billingClose: BillingClose;
}

export interface MeterCreateInput extends MeterSettingsInput {
  utilityKind: UtilityKind;
}

export interface ReadingInput {
  measuredAtMs: number;
  // Decimal string in the meter's base unit (electricity kWh, gas m³) with at
  // most three fraction digits; the server owns the fixed-point conversion.
  cumulativeValue: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
    throw new ApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'HTTP_ERROR',
      typeof error?.message === 'string' ? error.message : `Request failed with HTTP ${response.status}.`,
    );
  }
  return body as T;
}

const jsonBody = (value: unknown): string => JSON.stringify(value);
const meterPath = (meterId: string): string => `/api/meters/${encodeURIComponent(meterId)}`;

export const api = {
  session: () => apiJson<SessionResponse>('/api/auth/session'),
  authConfig: () => apiJson<AuthConfigResponse>('/api/auth/config'),
  googleLogin: (credential: string, csrfToken: string) => apiJson<SessionResponse>('/api/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ credential, g_csrf_token: csrfToken }).toString(),
  }),
  logout: () => apiJson<{ authenticated: false }>('/api/auth/logout', { method: 'POST' }),
  meters: async () => (await apiJson<{ meters: MeterResource[] }>('/api/meters')).meters,
  createMeter: async (input: MeterCreateInput) => (
    await apiJson<{ meter: MeterResource }>('/api/meters', { method: 'POST', body: jsonBody(input) })
  ).meter,
  updateMeter: async (meterId: string, input: MeterSettingsInput) => (
    await apiJson<{ meter: MeterResource }>(meterPath(meterId), { method: 'PUT', body: jsonBody(input) })
  ).meter,
  readings: async (meterId: string) => (
    await apiJson<{ readings: ReadingResource[] }>(`${meterPath(meterId)}/readings`)
  ).readings,
  createReading: async (meterId: string, input: ReadingInput) => (
    await apiJson<{ reading: ReadingResource }>(`${meterPath(meterId)}/readings`, {
      method: 'POST',
      body: jsonBody(input),
    })
  ).reading,
};
