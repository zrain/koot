const fs = require('fs-extra');
const path = require('path');
const semver = require('semver');
const { InjectManifest } = require('workbox-webpack-plugin');

const {
    keyKootBaseVersion,
    keyConfigClientServiceWorkerPathname
} = require('koot/defaults/before-build');
const defaults = require('koot/defaults/service-worker');
const {
    publicPathPrefix: devPublicPathPrefix,
    serviceWorkerFilename
} = require('koot/defaults/webpack-dev-server');
const getSWFilename = require('koot/utils/get-sw-filename');

// ============================================================================

module.exports = async (kootConfigForThisBuild, localeId) => {
    if (!kootConfigForThisBuild) throw new Error('NO_KOOT_BUILD_CONFIG');

    let { serviceWorker } = kootConfigForThisBuild;

    if (serviceWorker === true) serviceWorker = {};
    if (serviceWorker === false) return;

    const { distClientAssetsDirName } = kootConfigForThisBuild;

    const {
        filename,
        swSrc: _swSrc,
        include = [],
        exclude = []
    } = Object.assign({}, defaults, serviceWorker);

    const isDev = process.env.WEBPACK_BUILD_ENV === 'dev';

    const swDest = isDev
        ? serviceWorkerFilename
        : `../${getSWFilename(filename, localeId)}`;

    const swSrc = await (async () => {
        if (_swSrc) return _swSrc;

        const templateBase = path.resolve(
            __dirname,
            `new-plugin-workbox-template.js`
        );
        const templateTemp = path.resolve(
            __dirname,
            '.tmp',
            `new-plugin-workbox-template${localeId ? `.${localeId}` : ''}.js`
        );

        if (fs.existsSync(templateTemp)) fs.removeSync(templateTemp);
        fs.ensureDirSync(path.dirname(templateTemp));
        fs.writeFileSync(
            templateTemp,
            (await inject(kootConfigForThisBuild, localeId)) +
                fs
                    .readFileSync(templateBase, 'utf-8')
                    .replace(
                        /__DIST_CLIENT_ASSETS_DIRNAME__/,
                        distClientAssetsDirName
                    ),
            'utf-8'
        );

        return templateTemp;
    })();

    kootConfigForThisBuild[keyConfigClientServiceWorkerPathname] = swDest;

    return new InjectManifest({
        swDest,
        swSrc,
        importWorkboxFrom: isDev ? 'cdn' : 'local',
        include: [/\.js$/, /extract\.all\..+?\.large\.css$/, ...include],
        exclude: [/\.map$/, /^manifest.*\.js$/, ...exclude],
        importsDirectory: isDev ? '' : `__workbox-assets`
    });
};

// ============================================================================

const inject = async (kootConfigForThisBuild, localeId) => {
    const ENV = process.env.WEBPACK_BUILD_ENV;

    const {
        [keyKootBaseVersion]: kootBaseVersion,
        distClientAssetsDirName
    } = kootConfigForThisBuild;

    const obj = {
        distClientAssetsDirName:
            ENV === 'dev' ? devPublicPathPrefix : distClientAssetsDirName,
        '__baseVersion_lt_0.12': kootBaseVersion
            ? semver.lt(kootBaseVersion, '0.12.0')
            : false,
        env: {
            WEBPACK_BUILD_ENV: ENV
        }
    };

    if (localeId) obj.localeId = localeId;

    return `\rself.__koot = ${JSON.stringify(obj, undefined, 4)}\r\r`;
};
