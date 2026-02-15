import axios from 'axios';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export type LocationCheckResult = {
  status: 'green' | 'yellow' | 'red';
  items: Array<{ tag: number; itemType: string; vstockNo: string }>;
};

/** True when running inside the Tauri webview (production build). */
const isTauri = '__TAURI_INTERNALS__' in window;

/**
 * Check a location against the server.
 *  - Door found  = red
 *  - Items but no door = green
 *  - No items    = green
 *  - 404 / error = yellow
 */
export async function checkLocation(
  serverUrl: string,
  location: string,
  paramName: string,
): Promise<LocationCheckResult> {
  try {
    console.log(`[pinpro] Checking location: ${location}`);

    // Build the real target URL with query params
    const targetUrl = new URL(`${serverUrl}/pinpro/locations/parts`);
    targetUrl.searchParams.set('siteid', '1');
    targetUrl.searchParams.set(paramName, location);
    targetUrl.searchParams.set('country', 'US');
    targetUrl.searchParams.set('language', 'en');

    let data: unknown;

    if (isTauri) {
      // In Tauri, use the plugin's fetch — goes through Rust, no CORS issues
      const res = await tauriFetch(targetUrl.toString());
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
        headers: { 'x-target-url': targetUrl.toString() },
      });
      data = response.data;
    }

    const items: Array<{ tag: number; itemType: string; vstockNo: string }> = data as any;
    const hasDoor = items.some(item => item.itemType.includes('DOOR'));
    const status = hasDoor ? 'red' : 'green';

    console.log(`[pinpro] ${location} → ${status} (${items.length} item${items.length !== 1 ? 's' : ''}${hasDoor ? ', DOOR found' : ''})`);
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
