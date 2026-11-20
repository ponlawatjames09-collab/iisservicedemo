import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
