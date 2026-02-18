import axios from 'axios';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export type LocationCheckResult = {
  status: 'green' | 'yellow' | 'red';
  items: Array<{ tag: number; itemType: string; vstockNo: string }>;
};

export type SiteCheckResult = {
  siteId: number;
  shortCode: string;
  yardName: string;
};

/* True when running inside the Tauri webview (production build). */
const isTauri = '__TAURI_INTERNALS__' in window;

export async function checkSite(
  serverUrl: string,
): Promise<SiteCheckResult[]> {
  try {
    console.log(`[pinpro] Fetching sites`);

    const targetUrl = new URL(`${serverUrl}/pinpro/sites`);

    let xml: string;

    if (isTauri) {
      const res = await tauriFetch(targetUrl.toString());
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      xml = await res.text();
    } else {
      const response = await axios.get('/api/proxy', {
        headers: { 'x-target-url': targetUrl.toString() },
        responseType: 'text',
      });
      xml = response.data;
    }

    // Parse XML response:
    // <sites><site><siteId>1</siteId><shortCode>MA</shortCode><yardName>My Yard</yardName></site></sites>
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    const siteEls = doc.querySelectorAll('site');
    if (siteEls.length === 0) {
      console.warn('[pinpro] No <site> elements found in response');
      return [];
    }

    const sites: SiteCheckResult[] = [];
    siteEls.forEach(el => {
      const siteId = Number(el.querySelector('siteId')?.textContent ?? '0');
      const shortCode = el.querySelector('shortCode')?.textContent ?? '';
      const yardName = el.querySelector('yardName')?.textContent ?? '';
      sites.push({ siteId, shortCode, yardName });
      console.log(`[pinpro] Site: id=${siteId}, code=${shortCode}, yard=${yardName}`);
    });

    return sites;
  } catch (error) {
    console.error(`[pinpro] Error fetching sites`, error);
    return [];
  }
}

/**
 * Check a location against the server.
 *  - Any items present = red
 *  - No items          = green
 *  - 404 / error       = yellow
 */
export async function checkLocation(
  serverUrl: string,
  location: string,
  siteId: number,
  username: string,
  password: string,
): Promise<LocationCheckResult> {
  try {
    console.log(`[pinpro] Checking location: ${location}`);

    // Build the real target URL with query params
    const targetUrl = new URL(`${serverUrl}/pinpro/locations/parts`);
    targetUrl.searchParams.set('siteid', String(siteId));
    targetUrl.searchParams.set('locationtag', location);
    targetUrl.searchParams.set('country', 'US');
    targetUrl.searchParams.set('language', 'en');

    const basicAuth = 'Basic ' + btoa(`${username}:${password}`);

    const authHeaders = {
      'Accept-Encoding': 'gzip',
      'Authorization': basicAuth,
      'Connection': 'Keep-Alive',
      'User-Agent': 'okhttp/3.10.0',
    };

    let data: unknown;

    if (isTauri) {
      // In Tauri, use the plugin's fetch which goes through Rust, avoiding CORS issues
      const res = await tauriFetch(targetUrl.toString(), {
        method: 'GET',
        headers: authHeaders,
      });
      if (!res.ok) {
        if (res.status === 404) {
          console.warn(`[pinpro] ${location} → yellow (404 not found)`);
          return { status: 'yellow', items: [] };
        }
        throw new Error(`HTTP ${res.status}`);
      }
      data = await res.json();
    } else {
      // In dev (Vite), route through the local CORS proxy
      const response = await axios.get('/api/proxy', {
        headers: {
          'x-target-url': targetUrl.toString(),
          'x-auth': basicAuth,
        },
      });
      data = response.data;
    }

    const items: Array<{ tag: number; itemType: string; vstockNo: string }> = data as any;
    const status = items.length > 0 ? 'red' : 'green';

    console.log(`[pinpro] ${location} → ${status} (${items.length} item${items.length !== 1 ? 's' : ''})`);
    items.forEach(item => {
      console.log(`[pinpro]   tag=${item.tag}, type=${item.itemType}, stockNo=${item.vstockNo}`);
    });

    return { status, items };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.warn(`[pinpro] ${location} → yellow (404 not found)`);
      return { status: 'yellow', items: [] };
    }
    console.error(`[pinpro] ${location} → yellow (error)`, error);
    return { status: 'yellow', items: [] };
  }
}
