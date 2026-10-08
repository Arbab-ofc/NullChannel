import axios from 'axios';
import ImageKit from 'imagekit';
import { env } from './env.js';

// The existing SDK uses Axios for its requests; bound remote upload/deletion latency.
axios.defaults.timeout = env.IMAGEKIT_TIMEOUT_MS;

export const imagekit = new ImageKit({
  publicKey: env.IMAGEKIT_PUBLIC_KEY,
  privateKey: env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: env.IMAGEKIT_URL_ENDPOINT
});
