import axios from 'axios';

const apiUrl = 'http://pinpro/';

async function getPinpro() {
  const response = await axios.get(apiUrl);
  return response.data;
}

getPinpro().then((data) => {
  console.log(data);
});