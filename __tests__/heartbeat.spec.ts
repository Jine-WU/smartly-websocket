import WebSocket from 'ws';
import SmartlyWebSocket, { ErrorEvent } from '../smartly-websocket';

const WebSocketServer = WebSocket.Server;

const PORT = 30123;
const PORT_UNRESPONSIVE = '30124';
const URL = `ws://localhost:${PORT}`;
const sid = '1cd7f727-2a9e-4d80-a9f4-e048021e8844';
const pingInterval = 1000; // 小于5s 或者设置 jest的timeout
const pingTimeout = 1500;
const sidTxt = `0{"sid":"${sid}","pingInterval": ${pingInterval},"pingTimeout":${pingTimeout}}`;

jest.setTimeout(10000);

// 测试开始
beforeEach(() => {
    (global as any).WebSocket = WebSocket;
});

// 测试结束
afterEach(() => {
    delete (global as any).WebSocket;
    jest.restoreAllMocks();
});

test('初始化连接', done => {
    const wsServer = new WebSocketServer({ port: PORT }); // ws 服务端
    const ws = new SmartlyWebSocket(URL);
    let initOpen = false;

    wsServer.on('connection', (socket, req) => {
        // 发送信息
        socket.send(sidTxt);
    });

    ws.onopen = () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
    };

    ws.addEventListener('message', event => {
        if (!initOpen) {
            initOpen = true;
            expect(event.data).toBe(sidTxt);
            expect(ws.sid).toBe(sid);
            ws.close();
        }
    });

    ws.addEventListener('close', () => {
        wsServer.close(() => {
            setTimeout(() => done(), 100);
        });
    });
});

test('心跳', done => {
    const wsServer = new WebSocketServer({ port: PORT }); // ws 服务端
    const ws = new SmartlyWebSocket(URL);
    let initHeart = false;
    let heartTime = 0;

    wsServer.on('connection', (socket, req) => {
        // 发送信息
        socket.send(sidTxt);
        socket.onmessage = event => {
            if (event.data === '2') {
                // ping pong
                socket.send('3');
            }
        };
    });

    ws.on('ping', () => {
        initHeart = true;
        heartTime = Date.now();
    });

    ws.on('pong', () => {
        expect(initHeart).toBeTruthy();
        expect(Date.now() - heartTime).toBeLessThan(pingInterval);
        ws.close();
    });

    ws.addEventListener('close', () => {
        wsServer.close(() => {
            setTimeout(() => done(), 100);
        });
    });
});

test('心跳-超时', done => {
    const wsServer = new WebSocketServer({ port: PORT }); // ws 服务端
    const ws = new SmartlyWebSocket(URL);
    let initHeart = false;
    let heartTime = 0;

    wsServer.on('connection', (socket, req) => {
        // 发送信息
        socket.send(sidTxt);
    });

    ws.on('ping', () => {
        initHeart = true;
        heartTime = Date.now();
    });

    ws.addEventListener('close', () => {
        expect(initHeart).toBeTruthy();
        expect(Date.now() - heartTime).toBeGreaterThan(pingTimeout);
        wsServer.close(() => {
            setTimeout(() => done(), 100);
        });
    });
});

test('心跳-超时-重连', done => {
    const wsServer = new WebSocketServer({ port: PORT }); // ws 服务端
    const ws = new SmartlyWebSocket(URL);
    let initConnect = false;
    let reconnectTime = 0;
    let reconnect = false;
    let reconnectCount = 0;

    wsServer.on('connection', (socket, req) => {
        // 发送信息
        socket.send(sidTxt);
        if (initConnect) {
            reconnect = true;
            reconnectCount += 1;
            wsServer.close();
        }
        initConnect = true;
    });

    ws.on('ping', () => {
        reconnectTime = Date.now();
    });

    ws.addEventListener('error', () => {
        expect(reconnect).toBeTruthy();
        expect(reconnectCount).toBe(1);
        expect(Date.now() - reconnectTime).toBeGreaterThan(pingTimeout);
        wsServer.close(() => {
            setTimeout(() => done(), 100);
        });
    });
});
