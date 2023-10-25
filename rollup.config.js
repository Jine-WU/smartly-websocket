import typescript from 'rollup-plugin-typescript2';

export default {
    input: 'smartly-websocket.ts',
    plugins: [typescript()],
    output: [
        {
            file: 'dist/smartly-websocket-iife.js',
            format: 'iife',
            name: 'SmartlyWebSocket',
        },
        {
            file: 'dist/smartly-websocket-amd.js',
            format: 'amd',
            name: 'SmartlyWebSocket',
        },
        {
            file: 'dist/smartly-websocket-cjs.js',
            format: 'cjs',
        },
        {
            file: 'dist/smartly-websocket.mjs',
            format: 'es',
        },
        {
            file: 'dist/reconnecting-websocket-mjs.js',
            format: 'es',
        },
    ],
};
