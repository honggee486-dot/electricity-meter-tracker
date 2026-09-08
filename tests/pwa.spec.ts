import { expect, test, type APIRequestContext } from '@playwright/test';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface AppManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  prefer_related_applications: boolean;
  icons: ManifestIcon[];
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

async function expectPng(request: APIRequestContext, path: string, size: number): Promise<void> {
  const response = await request.get(path);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('image/png');
  expect(pngDimensions(await response.body())).toEqual({ width: size, height: size });
}

test('built app shell exposes the installable manifest and first-party icon contract', async ({ request }) => {
  const indexResponse = await request.get('/');
  expect(indexResponse.ok()).toBe(true);
  const html = await indexResponse.text();

  expect(html).toContain('<title>전기 기록</title>');
  expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
  expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png"');
  expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  expect(html).not.toContain('UI 데모');
  expect(html).not.toContain('샘플 데이터 기반');
  expect(html).not.toContain('실제 데이터는 저장하지 않습니다');

  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as AppManifest;
  expect(manifest).toMatchObject({
    id: '/',
    name: '전기 기록',
    short_name: '전기 기록',
    lang: 'ko',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f5ef',
    theme_color: '#f6f5ef',
    prefer_related_applications: false,
  });
  expect(manifest.description.length).toBeGreaterThan(0);
  expect(manifest.icons).toEqual(expect.arrayContaining([
    {
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ]));

  await expectPng(request, '/icons/icon-192.png', 192);
  await expectPng(request, '/icons/icon-512.png', 512);
  await expectPng(request, '/icons/maskable-512.png', 512);
  await expectPng(request, '/icons/apple-touch-icon.png', 180);
});
