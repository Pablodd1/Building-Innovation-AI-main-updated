import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.buildinginnovation.app',
  appName: 'Building Innovation AI',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    cleartext: false,
    hostname: 'buildingapp.us',
    allowNavigation: ['buildingapp.us', '*.buildingapp.us']
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    buildOptions: {
      keystorePath: 'building-innovation.keystore',
      keystoreAlias: 'buildinginnovation',
    }
  },
  ios: {
    contentInset: 'always',
    allowsLinkPreview: true,
    scrollEnabled: true,
    scheme: 'BuildingInnovation'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0a1628',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    CapacitorHttp: {
      enabled: true,
    }
  }
};

export default config;
