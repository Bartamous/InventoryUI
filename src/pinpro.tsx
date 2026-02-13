import axios from 'axios';

const apiUrl = 'http://pinpro/';

async function getUser(id: number): Promise<User> {
  const response = await axios.get<User>(`${apiUrl}/users/${id}`);
  return response.data;
}
