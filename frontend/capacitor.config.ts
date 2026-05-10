import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jackwei.cloudai',
  appName: 'OpenClaw',
  webDir: 'dist',

  // 生产环境：指向你的后端服务器
  // 开发环境：使用本地地址
  server: {
    // 开发时取消下面注释，使用热更新
    // url: 'http://192.168.1.x:5173',
    // cleartext: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: '#1e293b',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#1e293b',
      overlaysWebView: false,
    },
  },

  android: {
    allowMixedContent: true,
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },

  ios: {
    contentInset: 'always',
  },
};

export default config;
