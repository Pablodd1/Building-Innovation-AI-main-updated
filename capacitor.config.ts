import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.buildinginnovation.app',
  appName: 'Building Innovation AI',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    buildOptions: {
      keystorePath: 'building-innovation.keystore',
      keystoreAlias: 'buildinginnovation',
    }
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a1628',
      androidScaleType: 'CENTER_CROP',
    }
  }
};

export default config;
