/**
 * React SSR 完全测试
 *
 * 不同的 Koot 配置会分别使用不同的配置，用以测试多种结果。以下是已有的案例
 *
 * **store**
 * - 默认配置
 *     - 提供创建 store 的方法
 *     - 使用封装的 createStore 方法
 *     - 提供的 reducer 是 Object
 * - i18n.use="router"
 *     - 提供创建 store 的方法
 *     - 使用封装的 createStore 方法
 *     - 提供的 reducer 是 Function
 * - bundleVersionsKeep=false
 *     - 提供创建 store 的方法
 *     - 使用自定函数
 * - 0.6版配置
 *     - 仅提供 reducer 列表
 *
 * **sessionStore**
 * - 默认配置
 *     - `true` (全部开启)
 * - i18n.use="router"
 *     - `all` (全部开启)
 * - bundleVersionsKeep=false
 *     - 部分开启，同时混入无效设置
 * - 0.6版配置
 *     - 禁用
 */

// jest configuration

jest.setTimeout(24 * 60 * 60 * 1 * 1000);

//

const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const execSync = require('child_process').exec;
const exec = util.promisify(require('child_process').exec);
const puppeteer = require('puppeteer');
const chalk = require('chalk');
const get = require('lodash/get');
const cheerio = require('cheerio');

//

const {
    changeLocaleQueryKey,
    sessionStoreKey
} = require('../../../packages/koot/defaults/defines');
const defaultKootConfig = require('../../../packages/koot/defaults/koot-config');
const removeTempProjectConfig = require('../../../packages/koot/libs/remove-temp-project-config');
const sleep = require('../../../packages/koot/utils/sleep');
const addCommand = require('../../libs/add-command-to-package-json');
const terminate = require('../../libs/terminate-process');
const waitForPort = require('../../libs/get-port-from-child-process');
const filterState = require('../../../packages/koot/libs/filter-state');
const testHtmlRenderedByKoot = require('../../general-tests/html/rendered-by-koot');

//

const {
    injectScripts: puppeteerTestInjectScripts
} = require('../puppeteer-test');

//

global.kootTest = true;
process.env.KOOT_TEST_MODE = JSON.stringify(true);

//

const projects = require('../../projects/get')();

const projectsToUse = projects.filter(
    project =>
        // Array.isArray(project.type) && project.type.includes('react-isomorphic')
        project.name === 'standard'
);

const commandTestBuild = 'koot-buildtest';
/** @type {Boolean} 是否进行完整测试。如果为否，仅测试一次打包结果 */
const fullTest = true;
const headless = true;

//

let browser;
beforeAll(() =>
    puppeteer
        .launch({
            headless
        })
        .then(theBrowser => {
            browser = theBrowser;
        })
);
afterAll(() => browser.close().then(() => (browser = undefined)));

//

let lastTime;
beforeEach(() => (lastTime = Date.now()));
//

/**
 * 从配置文件中分析服务器端口号
 * @param {String} dir
 * @returns {number} port
 */
// const getPortFromConfig = async (dir) => {
//     const config = require(path.resolve(dir, 'koot.config.js'))
//     return require('../../../packages/koot/utils/get-port')(config.port)
// }

/**
 * 测试项目
 * @async
 * @param {Number} port
 * @param {Object} settings
 * @param {Object} [settings.kootConfig={}] Koot 配置对象
 * @param {Object} [settings.i18nUseRouter=false] 多语言使用路由模式
 */
const doTest = async (port, settings = {}) => {
    const context = await browser.createIncognitoBrowserContext();
    const origin = isNaN(port) ? port : `http://127.0.0.1:${port}`;
    const { kootConfig = {}, i18nUseRouter = false, isDev = false } = settings;

    const getLocaleId = async page => {
        return await page.evaluate(() =>
            document
                .querySelector('meta[name="koot-locale-id"]')
                .getAttribute('content')
        );
    };

    const getSSRState = async page =>
        await page.evaluate(() => window.__REDUX_STATE__);

    const page = await context.newPage();
    const failedResponse = [];
    require('../../libs/puppeteer/page-event-response-failed-response')(
        page,
        failedResponse
    );

    // 测试: 页面基本结构
    {
        const res = await page
            .goto(origin, {
                waitUntil: 'networkidle0'
            })
            .catch();
        const pageContent = await page.content();

        // 测试: 页面请求应 OK
        expect(res.ok()).toBe(true);

        // 测试: 页面标题的注入应成功
        const pageTitle = await page.evaluate(
            () => document.querySelector('title').innerText
        );
        expect(typeof pageTitle).toBe('string');

        // 测试: #app 是否存在
        const $app = await page.$('#app');
        expect(typeof $app).toBe('object');

        // 测试: <script> 标签之间不应有 ,
        expect(/<\/script>,<script/g.test(pageContent)).toBe(false);

        // 测试: 配置 webpack.internalLoaders['less-loader']
        const baseFontSize = await page.evaluate(() =>
            getComputedStyle(document.body).getPropertyValue('font-size')
        );
        expect(baseFontSize).toBe('40px');

        if (i18nUseRouter) {
            // 页面是否已跳转
            const pageUrl = await page.url();
            expect(new RegExp(`^${origin}/.+`).test(pageUrl)).toBe(true);
        }

        await testHtmlRenderedByKoot(await res.text());
    }

    // 测试: 利用 URL 可切换到对应语种，并且 SSR 数据正确
    {
        /**
         * 测试目标语种
         * @param {String} localeId 语种ID
         * @param {Object} infos 测试目标值
         * @param {String} infos.title 页面标题
         * @param {String} infos.description 页面简介
         */
        const testTargetLocaleId = async (localeId, infos = {}) => {
            const gotoUrl = i18nUseRouter
                ? `${origin}/${localeId}/extend`
                : `${origin}/extend?${changeLocaleQueryKey}=${localeId}`;

            await page.goto(gotoUrl, {
                waitUntil: 'networkidle0'
            });

            // 测试语种 ID 正确
            const theLocaleId = await getLocaleId(page);
            expect(theLocaleId).toBe(localeId);

            // 测试页面标题正确
            const pageTitle = await page.evaluate(
                () => document.querySelector('title').innerText
            );
            expect(pageTitle).toBe(infos.title);

            // 测试页面简介正确
            const pageDescription = await page.evaluate(
                () =>
                    document.querySelector('meta[description]') &&
                    document
                        .querySelector('meta[description]')
                        .getAttribute('description')
            );
            expect(pageDescription).toBe(infos.description);

            // 测试 SSR Redux state 正确
            const SSRState = await getSSRState(page);
            const SSRServerTime = await page.evaluate(
                () =>
                    document.querySelector('.timestamp strong') &&
                    new Date(
                        document.querySelector('.timestamp strong').innerText
                    ).getTime()
            );
            expect(typeof SSRState.infos.serverTimestamp).toBe('number');
            expect(SSRServerTime).toBe(SSRState.infos.serverTimestamp);
        };

        await testTargetLocaleId('zh', {
            title: '组件扩展 - Koot.js 模板项目',
            description: '简介：Koot.js 组件扩展'
        });
        await testTargetLocaleId('en', {
            title: 'Component Extend - Koot.js boilerplate',
            description: 'Summary information for Koot.js Component Extend.'
        });
    }

    // 测试: 到其他语种的链接
    {
        const testLinksToOtherLang = async (
            toLocaleId = '',
            urlAppend = ''
        ) => {
            const gotoUrl = i18nUseRouter
                ? `${origin}/${toLocaleId}${urlAppend}`
                : `${origin}${urlAppend}${
                      urlAppend.includes('?') ? '&' : '?'
                  }${changeLocaleQueryKey}=${toLocaleId}`;
            await page.goto(gotoUrl, {
                waitUntil: 'networkidle0'
            });

            const localeId = await page.evaluate(() =>
                document
                    .querySelector('meta[name="koot-locale-id"]')
                    .getAttribute('content')
            );
            const linksToOtherLang = await page.$$eval(
                `link[rel="alternate"][hreflang][href]:not([hreflang="${localeId}"])`,
                els =>
                    Array.from(els).map(el => ({
                        lang: el.getAttribute('hreflang'),
                        href: el.getAttribute('href')
                    }))
            );
            /** @type {Object[]} */
            const linksToSameLang = await page.$$eval(
                `link[rel="alternate"][hreflang="${localeId}"][href]`,
                els =>
                    Array.from(els).map(el => ({
                        lang: el.getAttribute('hreflang'),
                        href: el.getAttribute('href')
                    }))
            );

            expect(linksToSameLang.length).toBe(0);
            expect(Array.isArray(linksToOtherLang)).toBe(true);
            expect(linksToOtherLang.length).toBeGreaterThan(0);

            for (const o of linksToOtherLang) {
                const { lang, href } = o;
                await page.goto(href, {
                    waitUntil: 'networkidle0'
                });
                const localeId = await page.evaluate(() =>
                    document
                        .querySelector('meta[name="koot-locale-id"]')
                        .getAttribute('content')
                );
                expect(lang).toBe(localeId);
            }
        };
        await testLinksToOtherLang();
        await testLinksToOtherLang(`zh`);
        await testLinksToOtherLang(`zh-tw`);
        await testLinksToOtherLang('', '?test=a');
        await testLinksToOtherLang('zh', '?test=a');
        await testLinksToOtherLang('zh-tw', '?test=a');
    }

    // 测试: 并发请求 state 是否正确
    if (!isDev) {
        await Promise.all([
            new Promise(async resolve => {
                const pageDelayed = await context.newPage();
                const localeIdDelayed = 'en';
                const gotoUrlDelayed = i18nUseRouter
                    ? `${origin}/${localeIdDelayed}/delayed`
                    : `${origin}/delayed?${changeLocaleQueryKey}=${localeIdDelayed}`;
                await pageDelayed.goto(gotoUrlDelayed, {
                    waitUntil: 'networkidle0'
                });
                const theLocaleId = await getLocaleId(pageDelayed);
                expect(theLocaleId).toBe(localeIdDelayed);
                resolve();
            }),
            new Promise(async resolve => {
                const localeId = 'zh';
                const gotoUrl = i18nUseRouter
                    ? `${origin}/${localeId}`
                    : `${origin}?${changeLocaleQueryKey}=${localeId}`;
                await page.goto(gotoUrl, {
                    waitUntil: 'networkidle0'
                });
                const theLocaleId = await getLocaleId(page);
                expect(theLocaleId).toBe(localeId);
                resolve();
            })
        ]);
    }

    // 测试: 访问没有指定组件的路由
    {
        const name = 'testtesttest';

        // 先测试父级路由
        const urlParent = `${origin}/static`;
        await page
            .goto(urlParent, {
                waitUntil: 'networkidle0'
            })
            .catch();
        const hasFeature = await page.evaluate(
            () => !!document.querySelector('.no-component-given')
        );
        expect(hasFeature).toBe(false);

        // 没有指定组件的路由
        const urlNoGiven = `${origin}/static/${name}`;
        const res = await page
            .goto(urlNoGiven, {
                waitUntil: 'networkidle0'
            })
            .catch();

        // 测试: 请求应 OK
        expect(res.ok()).toBe(true);

        // 测试: 相关页面特征存在
        const featureString = await page.evaluate(() => {
            const el = document.querySelector('.no-component-given');
            if (el) return el.innerText;
            return '';
        });
        expect(featureString).toBe(name);
    }

    // 测试: 利用 staticCopyFrom 配置复制的文件可访问
    {
        const testUrl = `${origin}/__test.txt`;
        const testContent = 'TEST';
        const res = await page.goto(testUrl, {
            waitUntil: 'networkidle0'
        });
        const result = await res.text();
        expect(res.ok()).toBe(true);
        expect(result).toBe(testContent);
    }

    // 测试：sessionStore
    {
        const context = await browser.createIncognitoBrowserContext();
        const page = await context.newPage();
        await page.goto(origin, {
            waitUntil: 'networkidle0'
        });

        const { sessionStore = defaultKootConfig.sessionStore } = kootConfig;
        const getSessionStoreAfterRefresh = async () => {
            // 点击 GET DATA
            const selectorBtn =
                '#koot-debug [data-section="app-name"] [data-button="get-data"]';
            await Promise.all([
                page.click(selectorBtn),
                page.waitForSelector(selectorBtn, {
                    hidden: true
                })
                // page.waitForResponse(response =>
                //     /\/app-name$/.test(response.url())
                // )
            ]);

            const before = await page.evaluate(() => {
                return {
                    stateBefore: window.__KOOT_STORE__.getState(),
                    ssrState: window.__REDUX_STATE__
                };
            });
            before.stateBefore = filterState(before.stateBefore);
            before.ssrState = filterState(before.ssrState);

            await page.reload({ waitUntil: 'networkidle0' });

            const after = {
                ...(await page.evaluate(sessionStoreKey => {
                    let sessionStore;
                    try {
                        sessionStore = JSON.parse(
                            window.sessionStorage.getItem(sessionStoreKey)
                        );
                    } catch (e) {}

                    let content;
                    try {
                        content = document.querySelector(
                            '#koot-debug [data-section="app-name"] .section-content'
                        ).innerText;
                    } catch (e) {}

                    return {
                        sessionStore,
                        state: window.__KOOT_STORE__.getState(),
                        content
                    };
                }, sessionStoreKey))
            };

            after.state = filterState(after.state);

            return {
                ...before,
                ...after
            };
        };

        if (sessionStore === true || sessionStore === 'all') {
            const result = await getSessionStoreAfterRefresh();
            expect(result.stateBefore).toEqual(result.sessionStore);
            expect(result.sessionStore).toEqual(result.state);
            expect(result.state).not.toEqual(result.ssrState);
            expect(result.content).toBe(result.state.kootTest.app.name);
        } else if (typeof sessionStore === 'object') {
            const result = await getSessionStoreAfterRefresh();
            const checkValue = (obj, accumulatedKey = '') => {
                Object.keys(obj).forEach(key => {
                    const value = obj[key];
                    if (typeof value === 'object') {
                        checkValue(
                            value,
                            accumulatedKey + `[${JSON.stringify(key)}]`
                        );
                    } else {
                        const keyCur =
                            accumulatedKey + `[${JSON.stringify(key)}]`;
                        const valueInStateBefore = get(
                            result.stateBefore,
                            keyCur
                        );
                        const valueInSessionStore = get(
                            result.sessionStore,
                            keyCur
                        );
                        const valueInStateAfter = get(result.state, keyCur);
                        if (typeof valueInStateBefore === 'undefined') {
                            expect(valueInSessionStore).toBe(undefined);
                            expect(valueInStateAfter).toBe(undefined);
                        } else {
                            expect(valueInStateBefore).toBe(
                                valueInSessionStore
                            );
                            expect(valueInSessionStore).toBe(valueInStateAfter);
                        }
                    }
                });
            };
            checkValue(sessionStore);
            if (get(result.state, 'kootTest.app.name')) {
                expect(result.content).toBe(result.state.kootTest.app.name);
            } else {
                expect(result.content).not.toBe(
                    result.stateBefore.kootTest.app.name
                );
            }
            expect(result.state).not.toEqual(result.ssrState);
        } else {
            const result = await getSessionStoreAfterRefresh();
            expect(result.sessionStore).toBe(null);
            expect(result.stateBefore).not.toEqual(result.state);
            expect(result.state.kootTest).toEqual(result.ssrState.kootTest);
            expect(result.content).not.toBe(
                result.stateBefore.kootTest.app.name
            );
        }

        await page.close();
        await context.close();
    }

    // 测试：使用 TypeScript 编写的组件
    {
        const pageTS = origin + '/ts';
        await page.goto(pageTS, {
            waitUntil: 'networkidle0'
        });
        const el = await page.$('[data-koot-test-page="page-ts"]');
        expect(el).not.toBe(null);
    }

    // 测试：extend 高阶组件的 SSR 控制
    {
        const context = await browser.createIncognitoBrowserContext();
        const page = await context.newPage();

        const res = await page.goto(origin, {
            waitUntil: 'networkidle0'
        });

        const HTML = await res.text();
        const $ = cheerio.load(HTML);

        const client = {
            NoSSR: await page.$('#koot-test-no-ssr'),
            ControledSSR: await page.$('#koot-test-controled-ssr')
        };
        const server = {
            NoSSR: $('#koot-test-no-ssr'),
            ControledSSR: $('#koot-test-controled-ssr')
        };

        expect(client.NoSSR).not.toBe(null);
        expect(client.ControledSSR).not.toBe(null);

        expect(server.NoSSR.text()).toBe('');
        expect(server.ControledSSR.text()).toBe('Alternative content');

        await page.close();
        await context.close();
    }

    // 测试：页面信息应来自深部组件，而非外部父级
    {
        const specialMetaKey = 'koot-test-meta-aaa';

        {
            // 直接访问 /ts
            const context = await browser.createIncognitoBrowserContext();
            const page = await context.newPage();
            const res = await page.goto(origin + '/ts', {
                waitUntil: 'networkidle0'
            });
            const HTML = await res.text();
            const $ = cheerio.load(HTML);

            const titleSSR = $('head title').text();
            const specialMetaSSR = $(`meta[${specialMetaKey}]`).attr(
                specialMetaKey
            );

            const titleCSR = await page.evaluate(() => document.title);
            const specialMetaCSR = await page.evaluate(specialMetaKey => {
                const meta = document.querySelector(`meta[${specialMetaKey}]`);
                if (meta) return meta.getAttribute(specialMetaKey);
                return '';
            }, specialMetaKey);

            expect(titleSSR).toBe('AAA');
            expect(titleSSR).toBe(titleCSR);
            expect(specialMetaSSR).toBe('AAA');
            expect(specialMetaSSR).toBe(specialMetaCSR);

            await page.close();
            await context.close();
        }

        {
            // 路由跳转到 /ts
            const context = await browser.createIncognitoBrowserContext();
            const page = await context.newPage();
            await page.goto(origin, {
                waitUntil: 'networkidle0'
            });
            await Promise.all([
                page.waitFor(`[data-koot-test-page="page-ts"]`),
                page.click('a[href$="/ts"]')
            ]);

            const titleCSR = await page.evaluate(() => document.title);
            const specialMetaCSR = await page.evaluate(specialMetaKey => {
                const meta = document.querySelector(`meta[${specialMetaKey}]`);
                if (meta) return meta.getAttribute(specialMetaKey);
                return '';
            }, specialMetaKey);

            expect(titleCSR).toBe('AAA');
            expect(specialMetaCSR).toBe('AAA');

            await page.close();
            await context.close();
        }
    }

    // TODO: 测试: 所有 Webpack 结果资源的访问

    // TODO: 测试: 有 extract.all.[*].css

    // TODO: 测试: inject 的函数用法

    // TODO: 测试: extend connect 的 Array 用法

    // TODO: 测试: 切换路由/点击路由链接：不刷新页面

    // TODO: 测试: hydrate 不会触发重新渲染

    // TODO: 测试: 开发环境热更新 (JSX & TSX)

    // TODO: 测试: 访问404

    // TODO: 测试: 访问全局子路由 (例: 路由配置了 /a，强行访问 /a/b)

    // TODO: 测试: 同一个通配路由，访问另一个URL，检查同构结果 (connect component 是否可用)

    // 其他公用测试
    await puppeteerTestInjectScripts(page);

    // 测试: 没有失败的请求
    if (failedResponse.length) {
        console.log(
            'failedResponse',
            failedResponse.map(res => ({
                status: res.status(),
                url: res.url()
            }))
        );
    }
    expect(failedResponse.length).toBe(0);

    // 结束测试
    await page.close();
    await context.close();
};

/**
 * 测试项目开始前
 * @async
 * @param {String} cwd
 */
const beforeTest = async cwd => {
    // 重置
    await exec(`pm2 kill`);
    await removeTempProjectConfig(cwd);
};

/**
 * 测试项目结束后
 * @async
 * @param {String} cwd
 * @param {String} title
 */
const afterTest = async (cwd, title) => {
    await sleep(2 * 1000);
    await exec(`pm2 kill`);
    // 移除临时项目配置文件
    await removeTempProjectConfig(cwd);

    console.log(
        chalk.green('√ ') +
            chalk.green(`${(Date.now() - lastTime) / 1000}s `) +
            title
    );
};

//

describe('测试: React 同构项目', () => {
    for (const project of projectsToUse) {
        const { name, dir } = project;
        describe(`项目: ${name}`, () => {
            test(`[prod] 使用 koot-build 命令进行打包`, async () => {
                await beforeTest(dir);

                const commandName = `${commandTestBuild}-isomorphic-build`;
                const command = `koot-build --env prod --koot-test`;
                await addCommand(commandName, command, dir);

                // console.log(commandName)
                const { /*stdout,*/ stderr } = await exec(
                    `npm run ${commandName}`,
                    {
                        cwd: dir
                    }
                );

                // console.log(stderr)

                // TODO: 依据 chunkmap，判断硬盘里是否有所有的文件，可考虑做成公用的生产环境打包结果测试

                expect(typeof stderr).toBe('string');
                expect(stderr).toBe('');

                await afterTest(dir, '[prod] 使用 koot-build 命令进行打包');
            });
            test(`[prod] 使用 koot-start (--no-build) 命令启动服务器并访问`, async () => {
                await beforeTest(dir);

                const configFile = `koot.config.js`;
                const commandName = `${commandTestBuild}-isomorphic-start-server`;
                const command = `koot-start --no-build --koot-test`;
                await addCommand(commandName, command, dir);

                const child = execSync(
                    `npm run ${commandName}`,
                    {
                        cwd: dir
                    }
                    // (err, stdout, stderr) => {
                    //     console.log('err', err)
                    //     console.log('stdout', stdout)
                    //     console.log('stderr', stderr)
                    // }
                );
                const errors = [];

                // child.stdin.pipe(process.stdin)
                // child.stdout.pipe(process.stdout)
                // child.stderr.pipe(process.stderr)
                // console.log('===============')

                await waitForPort(child);
                // const port = await getPortFromConfig(dir)
                const port = require(path.resolve(dir, 'koot.config.js')).port;
                child.stderr.on('data', err => {
                    errors.push(err);
                });
                // console.log('port', port)

                // console.log({
                //     port,
                //     errors,
                // })
                expect(errors.length).toBe(0);

                await doTest(port, {
                    kootConfig: require(path.resolve(dir, configFile))
                });
                await terminate(child.pid);

                await afterTest(
                    dir,
                    '[prod] 使用 koot-start (--no-build) 命令启动服务器并访问'
                );
            });
            if (fullTest) {
                test(`[prod] 使用 koot-start (--no-build) 命令启动服务器并访问 (自定义端口号)`, async () => {
                    await beforeTest(dir);

                    const configFile = `koot.config.js`;
                    const port = '8316';
                    const commandName = `${commandTestBuild}-isomorphic-start-server-custom-port`;
                    const command = `koot-start --no-build --port ${port} --koot-test`;
                    await addCommand(commandName, command, dir);

                    const child = execSync(
                        `npm run ${commandName}`,
                        {
                            cwd: dir
                        }
                        // (err, stdout, stderr) => {
                        //     console.log('err', err)
                        //     console.log('stdout', stdout)
                        //     console.log('stderr', stderr)
                        // }
                    );
                    const errors = [];

                    // child.stdin.pipe(process.stdin)
                    // child.stdout.pipe(process.stdout)
                    // child.stderr.pipe(process.stderr)
                    child.stderr.on('data', err => {
                        errors.push(err);
                    });

                    // console.log(111)
                    await waitForPort(child);
                    // console.log(222)

                    // console.log({
                    //     port,
                    //     errors,
                    // })
                    expect(errors.length).toBe(0);

                    await doTest(port, {
                        kootConfig: require(path.resolve(dir, configFile))
                    });
                    await terminate(child.pid);

                    await afterTest(
                        dir,
                        '[prod] 使用 koot-start (--no-build) 命令启动服务器并访问 (自定义端口号)'
                    );
                });
                test(`[prod] 使用打包后的执行文件启动服务器并访问`, async () => {
                    await beforeTest(dir);

                    const configFile = `koot.config.js`;
                    const cwd = path.resolve(dir, 'dist');
                    const child = execSync(
                        `node ${path.resolve(cwd, 'index.js')}`,
                        {
                            cwd
                        }
                    );
                    const errors = [];

                    await waitForPort(child);
                    // const port = await getPortFromConfig(dir)
                    const port = require(path.resolve(dir, 'koot.config.js'))
                        .port;
                    child.stderr.on('data', err => {
                        errors.push(err);
                    });

                    // console.log({
                    //     port,
                    //     errors,
                    // })
                    expect(errors.length).toBe(0);

                    await doTest(port, {
                        kootConfig: require(path.resolve(dir, configFile))
                    });
                    await terminate(child.pid);

                    await afterTest(
                        dir,
                        '[prod] 使用打包后的执行文件启动服务器并访问'
                    );
                });
                test(`[dev] 启动开发模式并访问`, async () => {
                    await beforeTest(dir);

                    const configFile = `koot.config.js`;
                    // const port = '8316'
                    const commandName = `${commandTestBuild}-isomorphic-dev`;
                    const command = `koot-dev --no-open --koot-test`;
                    await addCommand(commandName, command, dir);

                    const child = execSync(`npm run ${commandName}`, {
                        cwd: dir,
                        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
                    });
                    const errors = [];

                    const port = await waitForPort(
                        child,
                        / on.*http:.*:([0-9]+)/
                    );
                    child.stderr.on('data', err => {
                        errors.push(err);
                    });

                    // console.log({
                    //     port,
                    //     errors,
                    // })
                    expect(errors.length).toBe(0);

                    await doTest(port, {
                        kootConfig: require(path.resolve(dir, configFile)),
                        isDev: true
                    });
                    await terminate(child.pid);

                    await afterTest(dir, '[dev] 启动开发模式并访问');
                });
                test(`[prod] 打包并运行生产模式 (i18n.use="router")`, async () => {
                    await beforeTest(dir);

                    const configFile = `koot.config.i18n-use-router.js`;
                    const dist = path.resolve(
                        dir,
                        require(path.resolve(dir, configFile)).dist
                    );
                    const commandName = `${commandTestBuild}-isomorphic-start-i18n_use_router`;
                    const command = `koot-start --koot-test --config ${configFile}`;

                    await fs.remove(dist);
                    await addCommand(commandName, command, dir);

                    const child = execSync(`npm run ${commandName}`, {
                        cwd: dir
                    });
                    const errors = [];

                    await waitForPort(child);
                    // const port = await getPortFromConfig(dir)
                    const port = require(path.resolve(dir, 'koot.config.js'))
                        .port;
                    child.stderr.on('data', err => {
                        errors.push(err);
                    });

                    expect(errors.length).toBe(0);

                    await doTest(port, {
                        kootConfig: require(path.resolve(dir, configFile)),
                        i18nUseRouter: true
                    });
                    await terminate(child.pid);

                    await fs.remove(dist);
                    await afterTest(
                        dir,
                        '[prod] 打包并运行生产模式 (i18n.use="router")'
                    );
                });
                test(`[dev] 启动开发模式并访问 (i18n.use="router")`, async () => {
                    await beforeTest(dir);

                    const configFile = `koot.config.i18n-use-router.js`;
                    // const port = '8316'
                    const commandName = `${commandTestBuild}-isomorphic-dev-i18n_use_router`;
                    const command = `koot-dev --no-open --koot-test --config ${configFile}`;
                    await addCommand(commandName, command, dir);

                    const child = execSync(`npm run ${commandName}`, {
                        cwd: dir,
                        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
                    });
                    const errors = [];

                    const port = await waitForPort(
                        child,
                        / on.*http:.*:([0-9]+)/
                    );
                    child.stderr.on('data', err => {
                        errors.push(err);
                    });

                    // console.log({
                    //     port,
                    //     errors,
                    // })
                    expect(errors.length).toBe(0);

                    await doTest(port, {
                        kootConfig: require(path.resolve(dir, configFile)),
                        i18nUseRouter: true,
                        isDev: true
                    });
                    await terminate(child.pid);

                    await afterTest(
                        dir,
                        '[dev] 启动开发模式并访问 (i18n.use="router")'
                    );
                });
                test(`[prod] 打包并运行生产模式 (bundleVersionsKeep=false)`, async () => {
                    await beforeTest(dir);

                    const configFile = `koot.config.no-bundles-keep.js`;
                    const dist = path.resolve(
                        dir,
                        require(path.resolve(dir, configFile)).dist
                    );
                    const commandName = `${commandTestBuild}-isomorphic-start-no_bundles_keep`;
                    const command = `koot-start --koot-test --config ${configFile}`;

                    await fs.remove(dist);
                    await addCommand(commandName, command, dir);

                    const child = execSync(`npm run ${commandName}`, {
                        cwd: dir
                    });
                    const errors = [];

                    await waitForPort(child);
                    // const port = await getPortFromConfig(dir)
                    const port = require(path.resolve(dir, 'koot.config.js'))
                        .port;
                    child.stderr.on('data', err => {
                        errors.push(err);
                    });

                    expect(errors.length).toBe(0);

                    await doTest(port, {
                        kootConfig: require(path.resolve(dir, configFile))
                    });
                    await terminate(child.pid);

                    await fs.remove(dist);
                    await afterTest(
                        dir,
                        '[prod] 打包并运行生产模式 (bundleVersionsKeep=false)'
                    );
                });
                test(`[dev] 启动开发模式并访问 (bundleVersionsKeep=false)`, async () => {
                    await beforeTest(dir);

                    const configFile = `koot.config.no-bundles-keep.js`;
                    // const port = '8316'
                    const commandName = `${commandTestBuild}-isomorphic-dev-no_bundles_keep`;
                    const command = `koot-dev --no-open --koot-test --config ${configFile}`;
                    await addCommand(commandName, command, dir);

                    const child = execSync(`npm run ${commandName}`, {
                        cwd: dir,
                        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
                    });
                    const errors = [];

                    const port = await waitForPort(
                        child,
                        / on.*http:.*:([0-9]+)/
                    );
                    child.stderr.on('data', err => {
                        errors.push(err);
                    });

                    // console.log({
                    //     port,
                    //     errors,
                    // })
                    expect(errors.length).toBe(0);

                    await doTest(port, {
                        kootConfig: require(path.resolve(dir, configFile)),
                        isDev: true
                    });
                    await terminate(child.pid);

                    await afterTest(
                        dir,
                        '[dev] 启动开发模式并访问 (bundleVersionsKeep=false)'
                    );
                });
                test(`[prod] 打包并运行生产模式 (0.6版配置)`, async () => {
                    await beforeTest(dir);

                    const configFile = `koot.config.old-0.6.js`;
                    const dist = path.resolve(
                        dir,
                        require(path.resolve(dir, configFile)).dist
                    );
                    const commandName = `${commandTestBuild}-isomorphic-start-config_old_0.6`;
                    const command = `koot-start --koot-test --config ${configFile}`;

                    await fs.remove(dist);
                    await addCommand(commandName, command, dir);

                    const child = execSync(`npm run ${commandName}`, {
                        cwd: dir
                    });
                    const errors = [];

                    await waitForPort(child);
                    // const port = await getPortFromConfig(dir)
                    const port = require('../../../packages/koot/utils/get-port')(
                        require(path.resolve(dir, configFile)).port
                    );
                    child.stderr.on('data', err => {
                        errors.push(err);
                    });

                    expect(errors.length).toBe(0);

                    await doTest(port, {
                        kootConfig: require(path.resolve(dir, configFile))
                    });
                    await terminate(child.pid);

                    await fs.remove(dist);
                    await afterTest(
                        dir,
                        '[prod] 打包并运行生产模式 (0.6版配置)'
                    );
                });
                test(`[dev] 启动开发模式并访问 (0.6版配置)`, async () => {
                    await beforeTest(dir);

                    const configFile = `koot.config.old-0.6.js`;
                    // const port = '8316'
                    const commandName = `${commandTestBuild}-isomorphic-dev-config_old_0.6`;
                    const command = `koot-dev --no-open --koot-test --config ${configFile}`;
                    await addCommand(commandName, command, dir);

                    const child = execSync(`npm run ${commandName}`, {
                        cwd: dir,
                        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
                    });
                    const errors = [];

                    const port = await waitForPort(
                        child,
                        / on.*http:.*:([0-9]+)/
                    );
                    child.stderr.on('data', err => {
                        errors.push(err);
                    });

                    // console.log({
                    //     port,
                    //     errors,
                    // })
                    expect(errors.length).toBe(0);

                    await doTest(port, {
                        kootConfig: require(path.resolve(dir, configFile)),
                        isDev: true
                    });
                    await terminate(child.pid);

                    await afterTest(
                        dir,
                        '[dev] 启动开发模式并访问 (0.6版配置)'
                    );
                });
            }
        });
    }
});

// TODO: 打包结果的独立测试，打包结果需要在其他的独立目录中

// TODO: render-template 传入的值，扩展

// TODO: client before 确保可以使用 async 方法

/** TODO: 热更新测试
 * - 修改 ejs
 * - 修改 css
 * - 修改 react 组件
 * - 修改 extend 传入信息
 */
