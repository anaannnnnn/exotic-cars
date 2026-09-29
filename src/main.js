import '@fontsource-variable/jost/index.css';
import './styles/main.css';
import { boot } from './app.js';

boot().catch((err) => {
  console.error(err);
  const fatal = document.getElementById('fatal');
  document.getElementById('fatal-text').textContent = err?.message || 'Something went wrong while starting.';
  fatal.hidden = false;
});
