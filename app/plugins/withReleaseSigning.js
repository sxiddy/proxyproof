// Signs release builds with the real keystore when CI provides one
// (PP_KEYSTORE + PP_KEYSTORE_PASSWORD), otherwise falls back to the debug key
// so local builds still work.
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;
    if (g.includes('PP_KEYSTORE')) return c;
    g = g.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        release {
            if (System.getenv("PP_KEYSTORE")) {
                storeFile file(System.getenv("PP_KEYSTORE"))
                storePassword System.getenv("PP_KEYSTORE_PASSWORD")
                keyAlias "proxyproof"
                keyPassword System.getenv("PP_KEYSTORE_PASSWORD")
                storeType "pkcs12"
            }
        }`,
    );
    g = g.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig System.getenv("PP_KEYSTORE") ? signingConfigs.release : signingConfigs.debug',
    );
    c.modResults.contents = g;
    return c;
  });
};
