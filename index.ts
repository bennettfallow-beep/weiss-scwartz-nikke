import { registerRootComponent } from 'expo';

import App from './src/ui/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and sets the app up the same way in Expo Go, native builds and the web.
registerRootComponent(App);
