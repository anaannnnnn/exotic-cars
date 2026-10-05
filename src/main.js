import '@fontsource-variable/jost/index.css';
import '@fontsource/michroma/400.css';
import '@fontsource-variable/inter-tight/index.css';
import './styles/main.css';
import './styles/configurator.css';
import './styles/pro.css';
import './styles/hub.css';
import './styles/pages.css';
import './styles/shop.css';
import './styles/mobile.css';
import './styles/landing.css';
import './styles/finish.css';
import './styles/dock.css';
import { boot } from './app.js';

boot().catch((err) => {
  console.error(err);
  const fatal = document.getElementById('fatal');
  document.getElementById('fatal-text').textContent = err?.message || 'Something went wrong while starting.';
  fatal.hidden = false;
});
