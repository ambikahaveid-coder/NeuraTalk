import { AppRegistry } from 'react-native';
import App from './App';
import { registerBackgroundIncomingCallHandler } from './src/services/push';

registerBackgroundIncomingCallHandler();

AppRegistry.registerComponent('NeuraTalk', () => App);
