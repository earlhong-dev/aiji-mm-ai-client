process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
process.env.WIN_CSC_LINK = '';

require('electron-builder').build({
  targets: require('electron-builder').Platform.WINDOWS.createTarget(),
  config: {
    appId: 'com.aiji.app',
    productName: 'Aiji',
    directories: { output: 'release', buildResources: 'build' },
    files: ['dist/**/*', 'electron-main.js', 'electron-preload.js', 'package.json'],
    win: {
      target: ['nsis', 'portable'],
      icon: 'build/icon.ico',
    },
    nsis: { 
      oneClick: false, 
      allowToChangeInstallationDirectory: true, 
      createDesktopShortcut: true, 
      shortcutName: 'Aiji',
      deleteAppDataOnUninstall: true,
      artifactName: '${productName} ${version} Setup.${ext}'
    },
    portable: {
      artifactName: '${productName} ${version} Portable.${ext}'
    },
    compression: 'maximum',
    removePackageScripts: true,
    nodeGypRebuild: false,
    buildDependenciesFromSource: false,
  },
}).then(() => {
  console.log('\n✓ Build complete! Check the release/ folder.');
}).catch(e => { console.error('✗ Build failed:', e.message); process.exit(1); });
