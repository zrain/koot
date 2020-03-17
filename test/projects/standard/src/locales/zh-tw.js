module.exports = {
    title: 'Koot.js 模板項目',
    test_img: '/test-img-zh-tw.png',
    pages: {
        home: {
            title: '歡迎'
        },
        extend: {
            title: '組件擴展',
            description: '簡介：Koot.js 組件擴展',
            isomorphic: '同構數據',
            isomorphic_content:
                '當直接訪問本頁或刷新本頁時，上面的值會直接在服務器端獲取並渲染到同構結果中；當從其他頁面訪問到本頁時，上值會通過瀏覽器端獲取並渲染。'
        },
        static: {
            title: '靜態資源',
            description: '簡介：Koot.js 靜態資源使用',
            method_require: 'require() 方法',
            method_require_content:
                '使用 require() 引用靜態文件。文件名將會被自動 Hash 化。',
            method_static: '靜態資源文件夾方法',
            method_static_content:
                '將靜態文件放入靜態資源文件夾中，該路徑可在 koot.build.js 中設置。'
        },
        delayed: {
            title: '延遲渲染',
            description: '人為的將渲染過程推遲。'
        },
        ts: {
            msg: '該 React 組件使用 TypeScript 編寫！'
        }
    }
};
