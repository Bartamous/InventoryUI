import axios from 'axios';

export type LocationCheckResult = {
  status: 'green' | 'yellow' | 'red';
  items: Array<{ tag: number; itemType: string; vstockNo: string }>;
};

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
    const response = await axios.get(`${serverUrl}/pinpro/locations/parts`, {
      params: {
        siteid: 1,
        [paramName]: location,
        country: 'US',
        language: 'en',
      },
    });

    const items: Array<{ tag: number; itemType: string; vstockNo: string }> = response.data;
    const hasDoor = items.some(item => item.itemType.includes('DOOR'));

    return {
      status: hasDoor ? 'red' : 'green',
      items,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return { status: 'yellow', items: [] };
    }
    return { status: 'yellow', items: [] };
  }
}
