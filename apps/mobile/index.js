/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './src/app/App';
import { installGlobalErrorHandler } from './src/utils/globalErrorHandler';
import { name as appName } from './app.json';

installGlobalErrorHandler();

AppRegistry.registerComponent(appName, () => App);
