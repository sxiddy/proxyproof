// Adds the Bluetooth permissions ProxyProof needs, with the right flags for
// old and new Android versions (app.json can't express the attributes).
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withBle(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const perms = (manifest['uses-permission'] = manifest['uses-permission'] || []);
    const add = (name, extra = {}) => {
      const existing = perms.find((p) => p.$['android:name'] === name);
      if (existing) Object.assign(existing.$, extra);
      else perms.push({ $: { 'android:name': name, ...extra } });
    };
    // Android 12+
    add('android.permission.BLUETOOTH_SCAN', { 'android:usesPermissionFlags': 'neverForLocation', 'tools:targetApi': 's' });
    add('android.permission.BLUETOOTH_ADVERTISE');
    add('android.permission.BLUETOOTH_CONNECT');
    // Android 11 and below
    add('android.permission.BLUETOOTH', { 'android:maxSdkVersion': '30' });
    add('android.permission.BLUETOOTH_ADMIN', { 'android:maxSdkVersion': '30' });
    add('android.permission.ACCESS_FINE_LOCATION', { 'android:maxSdkVersion': '30' });

    const features = (manifest['uses-feature'] = manifest['uses-feature'] || []);
    if (!features.some((f) => f.$['android:name'] === 'android.hardware.bluetooth_le')) {
      features.push({ $: { 'android:name': 'android.hardware.bluetooth_le', 'android:required': 'true' } });
    }
    // Lets the app talk to a server on the local network during testing.
    const app = manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return c;
  });
};
