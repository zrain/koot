// ============================================================================

workbox.setConfig({ debug: false });
workbox.core.setCacheNameDetails({
    prefix: 'koot',
    suffix: 'cache',
    precache: self.__koot['__baseVersion_lt_0.12'] ? 'sw' : 'pre',
    runtime: self.__koot['__baseVersion_lt_0.12'] ? 'sw' : 'rt'
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

/**
 * The workboxSW.precacheAndRoute() method efficiently caches and responds to
 * requests for URLs in the manifest.
 * See https://goo.gl/S9QRab
 */
self.__precacheManifest = [].concat(self.__precacheManifest || []);
workbox.precaching.precacheAndRoute(self.__precacheManifest, {});

const getRoute = (pathname, isNotPath) => {
    const host = (location.host || location.hostname)
        .split('.')
        .reverse()
        .slice(0, 2)
        .reverse()
        .join('.');
    const p = pathname
        ? `\\/${pathname.substr(0, 1) === '/' ? pathname.substr(1) : pathname}`
        : '';
    const suffix = isNotPath ? `\\?.*` : '\\/';

    return new RegExp(
        `^[a-z]+:\\/\\/[^\/]*?${host}[:]*[0-9]*${p}(${suffix}|$)`
    );
};

workbox.routing.registerRoute(
    getRoute('api'),
    new workbox.strategies.NetworkOnly(),
    'GET'
);
workbox.routing.registerRoute(
    getRoute(self.__koot.distClientAssetsDirName),
    new workbox.strategies.CacheFirst({
        cacheName: self.__koot['__baseVersion_lt_0.12']
            ? 'koot-sw-cache'
            : undefined
    }),
    'GET'
);
workbox.routing.registerRoute(
    getRoute('favicon.ico', true),
    new workbox.strategies.CacheFirst({
        cacheName: self.__koot['__baseVersion_lt_0.12']
            ? 'koot-sw-cache'
            : undefined
    }),
    'GET'
);
workbox.routing.registerRoute(
    getRoute(),
    new workbox.strategies.NetworkFirst({
        cacheName: self.__koot['__baseVersion_lt_0.12']
            ? 'koot-sw-cache'
            : undefined
    }),
    'GET'
);