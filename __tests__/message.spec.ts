import WebSocket from 'ws';
import SmartlyWebSocket, { ErrorEvent } from '../smartly-websocket';

const WebSocketServer = WebSocket.Server;

const PORT = 20123;
const PORT_UNRESPONSIVE = '20124';
const URL = `ws://localhost:${PORT}`;
const sid = '1cd7f727-2a9e-4d80-a9f4-e048021e8844';
const pingInterval = 1000; // 小于5s 或者设置 jest的timeout
const pingTimeout = 1500;
const sidTxt = `0{"sid":"${sid}","pingInterval": ${pingInterval},"pingTimeout":${pingTimeout}}`;
let portCount = 0;

jest.setTimeout(10000);

// 创建服务端, PORT 自增
function createServer() {
    portCount += 1;
    const port = PORT + portCount;
    const wsServer = new WebSocketServer({ port }); // ws 服务端
    return {
        wsServer,
        wsUrl: `ws://localhost:${port}`,
    };
}

// 测试开始
beforeEach(() => {
    (global as any).WebSocket = WebSocket;
});

// 测试结束
afterEach(() => {
    // delete (global as any).WebSocket;
    jest.restoreAllMocks();
});

// 测试消息发送
test('消息发送', done => {
    const { wsServer, wsUrl } = createServer();
    const ws = new SmartlyWebSocket(wsUrl, '', {
        debug: false,
    });
    const msg = { text: 'hello world' };
    const postMsg = `420${JSON.stringify([
        'send-message',
        JSON.stringify({ text: msg.text, sid }),
    ])}`;
    const backMsg = `430${JSON.stringify([
        JSON.stringify({ text: msg.text, sid }),
    ])}`;

    wsServer.on('connection', (socket, req) => {
        // 发送信息
        socket.send(sidTxt);
        socket.onmessage = event => {
            if (event.data === '2') {
                // ping pong
                socket.send('3');
            }
            if ((event.data as string).indexOf('send-message') > -1) {
                expect(event.data).toBe(postMsg);
                // 发送消息
                socket.send(backMsg);
            }
        };
    });

    ws.on('connect', () => {
        ws.emit('send-message', msg, res => {
            try {
                const _data = JSON.parse(res);
                expect(_data.text).toEqual(msg.text);
                done();
            } catch {
                done.fail('消息发送失败');
            }
            ws.off('send-message');
            ws.close();
            wsServer.close();
        });
    });
});

// 测试消息接收
test('消息接收', done => {
    const { wsServer, wsUrl } = createServer();
    const ws = new SmartlyWebSocket(wsUrl, '', {
        debug: false,
    });
    const msg = { text: 'hello world' };
    const mid = Date.now();
    const backMsg = `42${JSON.stringify([
        'receive-message',
        JSON.stringify({ text: msg.text, message_id: mid }),
    ])}`;
    const ackMsg = `43${JSON.stringify([
        'ack',
        JSON.stringify({ message_id: mid, sid }),
    ])}`;

    wsServer.on('connection', (socket, req) => {
        // 发送信息
        socket.send(sidTxt);
        setTimeout(() => {
            socket.send(backMsg);
        }, 500);
        socket.onmessage = event => {
            if (event.data === '2') {
                // ping pong
                socket.send('3');
            }
            // 接收 ack
            if ((event.data as string).indexOf('43') === 0) {
                expect(event.data).toBe(ackMsg);
                ws.off('receive-message');
                ws.close();
                wsServer.close();
                done();
            }
        };
    });

    ws.on('receive-message', (res: string) => {
        const _data = JSON.parse(res);
        expect(_data.text).toEqual(msg.text);
        expect(_data.message_id).toEqual(mid);
    });
});
