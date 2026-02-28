import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export async function getPublicIp(): Promise<string | null> {
  try {
    const res = await tauriFetch('https://api.ipify.org?format=json');
    if (!res.ok) {
      console.error('[ipCheck] Failed to fetch IP, status:', res.status);
      return null;
    }

    const data = await res.json() as { ip?: string };
    if (!data || typeof data.ip !== 'string') {
      console.error('[ipCheck] Unexpected IP response:', data);
      return null;
    }

    return data.ip;
  } catch (err) {
    console.error('[ipCheck] Error fetching IP:', err);
    return null;
  }
}

