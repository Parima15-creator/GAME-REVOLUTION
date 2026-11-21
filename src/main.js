// ==========================================================================
// REFLEXRUN 3D - MAIN APPLICATION ENTRY POINT
// ==========================================================================

import { GameController } from './game/GameController.js';

window.addEventListener('DOMContentLoaded', async () => {
  console.log('⚡ Initializing ReflexRun 3D Workout Game...');
  const game = new GameController();
  // Expose for debugging / automated smoke tests
  window.__reflexRun = game;
  // Attempt menu music as soon as the scene is ready. Browsers that suspend
  // autoplay are resumed by the first gesture handler in GameController.
  game.sound.setMenuMode(true);
  game.sound.startMusic();
  game.syncHomeAudioButton();
  await game.init();
  game.update();
});
