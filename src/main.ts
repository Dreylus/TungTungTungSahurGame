import './ui/styles.css';
import { audio } from './audio/audio.ts';
import { installNativeHooks, setHighRefresh } from './native/bridge.ts';
import { onSettings, settings } from './saves/store.ts';
import { openBuilder } from './ui/builder.ts';
import { openFighters } from './ui/fighters.ts';
import { openMatch } from './ui/match.ts';
import { menuScreen } from './ui/menu.ts';
import { nav } from './ui/nav.ts';
import { back, push } from './ui/router.ts';
import { openSaves } from './ui/saves.ts';
import { openSettings } from './ui/settings.ts';
import { openSetup } from './ui/setup.ts';

nav.setup = openSetup;
nav.match = openMatch;
nav.saves = openSaves;
nav.settings = openSettings;
nav.fighters = openFighters;
nav.builder = () => openBuilder(null);

const applyGlobal = () => {
  document.documentElement.classList.toggle('reduced-motion', settings.reducedMotion);
  setHighRefresh(settings.highRefresh);
  audio.apply();
};
applyGlobal();
onSettings(applyGlobal);

// On Android the shell asks __pwBack() first and closes the app when it returns false.
installNativeHooks(() => back(), () => audio.suspend());

// Audio can only start after a user gesture.
const unlock = () => {
  audio.ensure();
  audio.startAmbient(0.45);
  window.removeEventListener('pointerdown', unlock);
};
window.addEventListener('pointerdown', unlock);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audio.ctx) audio.ensure();
});
window.addEventListener('contextmenu', (e) => e.preventDefault());

push(menuScreen());
