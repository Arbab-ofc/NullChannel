import axios from 'axios';
import { API_URL } from './constants';
import { ensureSession } from './session';
export const api = axios.create({ baseURL: `${API_URL}/api`, withCredentials: true, timeout: 120000 });
api.interceptors.response.use(response => response, async error => {
  const config = error.config;
  if (error.response?.status === 401 && config && !config.sessionRetried) {
    config.sessionRetried = true;
    await ensureSession();
    return api.request(config);
  }
  return Promise.reject(error);
});
