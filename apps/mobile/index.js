/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './src/app/App';
import { registerBackgroundPushHandler } from './src/services/push/pushService';
import { installGlobalErrorHandler } from './src/utils/globalErrorHandler';
import { name as appName } from './app.json';

installGlobalErrorHandler();
// Must be registered outside React, before the app component (FCM requirement).
registerBackgroundPushHandler();

AppRegistry.registerComponent(appName, () => App);
