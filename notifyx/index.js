'use strict';

/**
 * Root entry point.
 *
 * Hosting panels (Pterodactyl, NexCloud-style panels, ...) start `node index.js`
 * by default, so this file simply hands over to the real bootstrap in src/.
 * No custom startup command is ever required.
 */
require('./src/index.js')
  .main()
  .catch((err) => {
    // The logger may not be initialised yet, so use console here.
    // eslint-disable-next-line no-console
    console.error('[fatal] NotifyX failed to start:', err);
    process.exit(1);
  });
