/* kolaba — точка входа.

   Модули импортируются в том же порядке, в каком раньше подключались три
   <script>, поэтому порядок выполнения не изменился. Роутер стартует последним,
   когда все экраны уже собраны. */

import { startViewport } from './ui/viewport.js';
import { startKeyboard } from './ui/keyboard.js';
import { startMockup } from './ui/mockup.js';
import { startRouter } from './core/router.js';

/* Экраны — порядок важен, он повторяет старый app.js → settings.js → messenger.js */
import './data/photos.js';
import './screens/start.js';
import './screens/auth.js';
import './ui/picker.js';
import './screens/setup.js';
import './screens/profile.js';
import './data/catalog.js';
import './ui/photo-viewer.js';
import './screens/profile-tabs.js';
import './screens/projects.js';
import './screens/notifications.js';
import './screens/feed.js';
import './screens/settings.js';
import './screens/messenger.js';

startViewport();
startKeyboard();
startMockup();
startRouter();
