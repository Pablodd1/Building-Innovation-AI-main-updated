import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.buildinginnovation.app',
  appName: 'Building Innovation AI',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
