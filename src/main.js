import '@fontsource/michroma/400.css';
import '@fontsource-variable/instrument-sans/wdth.css';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/bodoni-moda/wght.css';
import '@fontsource-variable/jost/wght.css';
import '@fontsource-variable/inter-tight/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
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
import './styles/voice.css';
import './styles/after.css';
import './styles/atmosphere.css';
import './styles/home.css';
import './styles/noir.css';
import './styles/noir-minimal.css';
import { boot } from './app.js';
import { initMotion } from './ui/motion.js';

initMotion();

boot().catch((err) => {
  console.error(err);
  const fatal = document.getElementById('fatal');
  document.getElementById('fatal-text').textContent = err?.message || 'Something went wrong while starting.';
  fatal.hidden = false;
});
