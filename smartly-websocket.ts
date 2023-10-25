/*!
 * Reconnecting WebSocket
 * by Pedro Ladaria <pedro.ladaria@gmail.com>
 * https://github.com/pladaria/reconnecting-websocket
 * License MIT
 */

import * as Events from './events';

// eslint-disable-next-line consistent-return
const getGlobalWebSocket = (): WebSocket | undefined => {
    if (typeof WebSocket !== 'undefined') {
        // @ts-ignore
        return WebSocket;
    }
};

/**
 * Returns true if given argument looks like a WebSocket class
 */
const isWebSocket = (w: any) => typeof w !== 'undefined' && !!w && w.CLOSING === 2;

export type Event = Events.Event;
export type ErrorEvent = Events.ErrorEvent;
export type CloseEvent = Events.CloseEvent;

type Query = {
    [key: string]: any;
}

export type Options = {
    WebSocket?: any;
    maxReconnectionDelay?: number;
    minReconnectionDelay?: number;
    reconnectionDelayGrowFactor?: number;
    minUptime?: number;
    connectionTimeout?: number;
    maxRetries?: number;
    maxEnqueuedMessages?: number;
    startClosed?: boolean;
    debug?: boolean;
    query?: Query;
    pingInterval?: number;
    pingTimeout?: number;
    heartbeatData?: string;
    ack?: boolean;
};

const DEFAULT = {
    maxReconnectionDelay: 10000,
    minReconnectionDelay: 1000 + Math.random() * 4000,
    minUptime: 5000,
    reconnectionDelayGrowFactor: 1.3,
    connectionTimeout: 4000,
    maxRetries: Infinity,
    maxEnqueuedMessages: Infinity,
    startClosed: false,
    debug: false,
    query: {},
    pingInterval: 10000,
    pingTimeout: 15000,
    ack: true,
};

const EVENT_NAME: any = {
    CONNECT: 'connect',
    CLOSE: 'close',
    ERROR: 'error',
    CONNECT_TIMEOUT: 'connect_timeout',
    RECONNECT: 'reconnect',
    RECONNECT_ATTEMPT: 'reconnect_attempt',
    RECONNECTING: 'reconnecting',
    RECONNECT_FAILED: 'reconnect_failed',
    PING: 'ping',
    PONG: 'pong',
};

const MESSAGE_FRAME_IDENTIFIER: any = {
    CONNECT: '0',
    PING: '2',
    PONG: '3',
    MESSAGE: '42',
    CALLBACK: '43',
};

export type UrlProvider = string | (() => string) | (() => Promise<string>);

export type Message = string | ArrayBuffer | Blob | ArrayBufferView;

export type ListenersMap = {
    error: Array<Events.WebSocketEventListenerMap['error']>;
    message: Array<Events.WebSocketEventListenerMap['message']>;
    open: Array<Events.WebSocketEventListenerMap['open']>;
    close: Array<Events.WebSocketEventListenerMap['close']>;
};

export default class SmartlyWebSocket {
    private _ws?: WebSocket;

    private _listeners: ListenersMap = {
        error: [],
        message: [],
        open: [],
        close: [],
    };

    private _eventListeners: Map<string, any> = new Map();

    private _retryCount = -1;

    private _uptimeTimeout: any;

    private _connectTimeout: any;

    private _heartbeatTimer: any;

    private _heartbeatTimeout: any;

    private _shouldReconnect = true;

    private _connectLock = false;

    private _binaryType: BinaryType = 'blob';

    private _closeCalled = false;

    private _messageQueue: Message[] = [];

    protected readonly _url: UrlProvider;

    private readonly _protocols?: string | string[];

    private readonly _options: Options;

    constructor(url: UrlProvider, protocols?: string | string[], options: Options = {}) {
        this._url = url;
        this._protocols = protocols;
        this._options = options;
        if (this._options.startClosed) {
            this._shouldReconnect = false;
        }
        this._connect();
    }

    static get CONNECTING() {
        return 0;
    }

    static get OPEN() {
        return 1;
    }

    static get CLOSING() {
        return 2;
    }

    static get CLOSED() {
        return 3;
    }

    get CONNECTING() {
        return SmartlyWebSocket.CONNECTING;
    }

    get OPEN() {
        return SmartlyWebSocket.OPEN;
    }

    get CLOSING() {
        return SmartlyWebSocket.CLOSING;
    }

    get CLOSED() {
        return SmartlyWebSocket.CLOSED;
    }

    get binaryType() {
        return this._ws ? this._ws.binaryType : this._binaryType;
    }

    set binaryType(value: BinaryType) {
        this._binaryType = value;
        if (this._ws) {
            this._ws.binaryType = value;
        }
    }

    /**
     * Returns the number or connection retries
     */
    get retryCount(): number {
        return Math.max(this._retryCount, 0);
    }

    /**
     * The number of bytes of data that have been queued using calls to send() but not yet
     * transmitted to the network. This value resets to zero once all queued data has been sent.
     * This value does not reset to zero when the connection is closed; if you keep calling send(),
     * this will continue to climb. Read only
     */
    get bufferedAmount(): number {
        const bytes = this._messageQueue.reduce((acc, message) => {
            if (typeof message === 'string') {
                acc += message.length; // not byte size
            } else if (message instanceof Blob) {
                acc += message.size;
            } else {
                acc += message.byteLength;
            }
            return acc;
        }, 0);
        return bytes + (this._ws ? this._ws.bufferedAmount : 0);
    }

    /**
     * The extensions selected by the server. This is currently only the empty string or a list of
     * extensions as negotiated by the connection
     */
    get extensions(): string {
        return this._ws ? this._ws.extensions : '';
    }

    /**
     * A string indicating the name of the sub-protocol the server selected;
     * this will be one of the strings specified in the protocols parameter when creating the
     * WebSocket object
     */
    get protocol(): string {
        return this._ws ? this._ws.protocol : '';
    }

    /**
     * The current state of the connection; this is one of the Ready state constants
     */
    get readyState(): number {
        if (this._ws) {
            return this._ws.readyState;
        }
        return this._options.startClosed ? SmartlyWebSocket.CLOSED : SmartlyWebSocket.CONNECTING;
    }

    /**
     * The URL as resolved by the constructor
     */
    get url(): string {
        return this._ws ? this._ws.url : '';
    }

    /**
     * An event listener to be called when the WebSocket connection's readyState changes to CLOSED
     */
    public onclose: ((event: Events.CloseEvent) => void) | null = null;

    /**
     * An event listener to be called when an error occurs
     */
    public onerror: ((event: Events.ErrorEvent) => void) | null = null;

    /**
     * An event listener to be called when a message is received from the server
     */
    public onmessage: ((event: MessageEvent) => void) | null = null;

    /**
     * An event listener to be called when the WebSocket connection's readyState changes to OPEN;
     * this indicates that the connection is ready to send and receive data
     */
    public onopen: ((event: Event) => void) | null = null;

    /**
     * Closes the WebSocket connection or connection attempt, if any. If the connection is already
     * CLOSED, this method does nothing
     */
    public close(code = 1000, reason?: string) {
        reason = reason || 'client disconnect';
        this._closeCalled = true;
        this._shouldReconnect = false;
        this._clearTimeouts();
        if (!this._ws) {
            this._debug('close enqueued: no ws instance');
            return;
        }
        if (this._ws.readyState === this.CLOSED) {
            this._debug('close: already closed');
            return;
        }
        this._ws.close(code, reason);
    }

    /**
     * Closes the WebSocket connection or connection attempt and connects again.
     * Resets retry counter;
     */
    public reconnect(code?: number, reason?: string) {
        this._shouldReconnect = true;
        this._closeCalled = false;
        this._retryCount = -1;
        if (!this._ws || this._ws.readyState === this.CLOSED) {
            this._connect();
        } else {
            this._disconnect(code, reason);
            this._connect();
        }
    }

    /**
     * Enqueue specified data to be transmitted to the server over the WebSocket connection
     */
    public send(data: Message) {
        if (this._ws && this._ws.readyState === this.OPEN) {
            this._debug('send', data);
            this._ws.send(data);
        } else {
            const { maxEnqueuedMessages = DEFAULT.maxEnqueuedMessages } = this._options;
            if (this._messageQueue.length < maxEnqueuedMessages) {
                this._debug('enqueue', data);
                this._messageQueue.push(data);
            }
        }
    }

    /**
     * Register an event handler of a specific event type
     */
    public addEventListener<T extends keyof Events.WebSocketEventListenerMap>(
        type: T,
        listener: Events.WebSocketEventListenerMap[T],
    ): void {
        if (this._listeners[type]) {
            // @ts-ignore
            this._listeners[type].push(listener);
        }
    }

    public dispatchEvent(event: Event) {
        const listeners = this._listeners[event.type as keyof Events.WebSocketEventListenerMap];
        if (listeners) {
            for (const listener of listeners) {
                this._callEventListener(event, listener);
            }
        }
        return true;
    }

    /**
     * Removes an event listener
     */
    public removeEventListener<T extends keyof Events.WebSocketEventListenerMap>(
        type: T,
        listener: Events.WebSocketEventListenerMap[T],
    ): void {
        if (this._listeners[type]) {
            // @ts-ignore
            this._listeners[type] = this._listeners[type].filter((l) => l !== listener);
        }
    }

    /**
     * 自定义事件监听
     * @param eventName
     * @param callback
     */
    public on(eventName: string, callback?: (cbRes: any) => void) {
        if (!this._eventListeners.has(eventName)) {
            this._eventListeners.set(eventName, []);
        }
        this._eventListeners.get(eventName).push(callback);
    }

    /**
     * 移除自定义事件监听
     * @param eventName
     * @param callback
     */
    public off(eventName: string, callback?: (cbRes: any) => void) {
        if (this._eventListeners.has(eventName)) {
            this._eventListeners.set(eventName, this._eventListeners.get(eventName).filter((cb: any) => cb !== callback));
        }
    }

    /**
     * 自定义发送事件
     * @param eventName
     * @param payload
     * @param cb
     */
    public emit(eventName: string, payload: any, cb?: (cbRes: any) => void) {}

    private _formattedTime() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

        const formattedTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;

        return formattedTime;
    }

    private _debug(...args: any[]) {
        if (this._options.debug) {
            // not using spread because compiled version uses Symbols
            // tslint:disable-next-line
            console.log.apply(console, [this._formattedTime(), '\nSS_WS >>>', ...args]);
        }
    }

    private _getNextDelay() {
        const {
            reconnectionDelayGrowFactor = DEFAULT.reconnectionDelayGrowFactor,
            minReconnectionDelay = DEFAULT.minReconnectionDelay,
            maxReconnectionDelay = DEFAULT.maxReconnectionDelay,
        } = this._options;
        let delay = 0;
        if (this._retryCount > 0) {
            // eslint-disable-next-line no-restricted-properties
            delay = minReconnectionDelay * Math.pow(reconnectionDelayGrowFactor, this._retryCount - 1);
            if (delay > maxReconnectionDelay) {
                delay = maxReconnectionDelay;
            }
        }
        this._debug('next delay', delay);
        return delay;
    }

    private _wait(): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, this._getNextDelay());
        });
    }

    private _getNextUrl(urlProvider: UrlProvider): Promise<string> {
        if (typeof urlProvider === 'string') {
            if (this._options.query) {
                return Promise.resolve(this._assembleUrl(urlProvider, this._options.query || DEFAULT.query));
            }
            return Promise.resolve(urlProvider);
        }
        if (typeof urlProvider === 'function') {
            const url = urlProvider();
            if (typeof url === 'string') {
                return Promise.resolve(this._assembleUrl(url, this._options.query || DEFAULT.query));
            }
            // @ts-ignore redundant check
            if (url.then) {
                return url;
            }
        }
        throw Error('Invalid URL');
    }

    private _connect() {
        if (this._connectLock || !this._shouldReconnect) {
            return;
        }
        this._connectLock = true;

        const {
            maxRetries = DEFAULT.maxRetries,
            connectionTimeout = DEFAULT.connectionTimeout,
            WebSocket = getGlobalWebSocket(),
        } = this._options;

        if (this._retryCount >= maxRetries) {
            this._debug('max retries reached', this._retryCount, '>=', maxRetries);
            this._broadcastEvent(EVENT_NAME.RECONNECT_FAILED);
            // 抛出重试异常
            return;
        }

        // eslint-disable-next-line no-plusplus
        this._retryCount++;

        if (this._retryCount > 0) {
            this._broadcastEvent(EVENT_NAME.RECONNECT_ATTEMPT, { retryCount: this._retryCount });
        }

        this._debug('connect', this._retryCount);
        this._removeListeners();
        if (!isWebSocket(WebSocket)) {
            throw Error('No valid WebSocket class provided');
        }
        this._wait()
            .then(() => this._getNextUrl(this._url))
            .then((url) => {
                // close could be called before creating the ws
                if (this._closeCalled) {
                    return;
                }
                this._debug('connect', { url, protocols: this._protocols });
                this._ws = this._protocols ? new WebSocket(url, this._protocols) : new WebSocket(url);
                if (this._retryCount > 0) {
                    this._broadcastEvent(EVENT_NAME.RECONNECTING, { retryCount: this._retryCount });
                }
                this._ws!.binaryType = this._binaryType;
                this._connectLock = false;
                this._addListeners();

                this._connectTimeout = setTimeout(() => this._handleTimeout(), connectionTimeout);
            });
    }

    private _handleTimeout() {
        this._debug('timeout event');
        this._handleError(new Events.ErrorEvent(Error('TIMEOUT'), this));
    }

    private _disconnect(code = 1000, reason?: string) {
        this._clearTimeouts();
        this._stopHeartbeat();
        if (!this._ws) {
            return;
        }
        this._removeListeners();
        try {
            this._ws.close(code, reason);
            this._handleClose(new Events.CloseEvent(code, reason, this));
        } catch (error) {
            // ignore
        }
    }

    private _acceptOpen() {
        this._debug('accept open');
        this._retryCount = 0;
    }

    private _callEventListener<T extends keyof Events.WebSocketEventListenerMap>(
        event: Events.WebSocketEventMap[T],
        listener: Events.WebSocketEventListenerMap[T],
    ) {
        if ('handleEvent' in listener) {
            // @ts-ignore
            listener.handleEvent(event);
        } else {
            // @ts-ignore
            listener(event);
        }
    }

    private _handleOpen = (event: Event) => {
        this._debug('open event');
        const { minUptime = DEFAULT.minUptime } = this._options;

        clearTimeout(this._connectTimeout);
        this._uptimeTimeout = setTimeout(() => this._acceptOpen(), minUptime);

        this._ws!.binaryType = this._binaryType;

        this._startHeartbeat();

        // send enqueued messages (messages sent before websocket open event)
        this._messageQueue.forEach((message) => this._ws?.send(message));
        this._messageQueue = [];

        if (this.onopen) {
            this.onopen(event);
        }
        this._listeners.open.forEach((listener) => this._callEventListener(event, listener));
        if (this._retryCount > 0) {
            this._broadcastEvent(EVENT_NAME.RECONNECT, { ...event, retryCount: this._retryCount });
        } else {
            this._broadcastEvent(EVENT_NAME.CONNECT, event);
        }
    };

    private _handleMessage = (event: MessageEvent) => {
        if (event.data === '3') {
            this._triggerPongCallback();
            return;
        }

        this._debug('message event');
        console.log('收到消息：', event.data);

        if (this.onmessage) {
            this.onmessage(event);
        }
        this._listeners.message.forEach((listener) => this._callEventListener(event, listener));
        // todo 广播消息事件
    };

    private _handleError = (event: Events.ErrorEvent) => {
        this._debug('error event', event);
        this._disconnect(undefined, event.message === 'TIMEOUT' ? 'timeout' : undefined);

        if (this.onerror) {
            this.onerror(event);
        }
        this._debug('exec error listeners');
        this._listeners.error.forEach((listener) => this._callEventListener(event, listener));
        if (event.message === 'TIMEOUT') {
            this._broadcastEvent(EVENT_NAME.CONNECT_TIMEOUT);
        } else {
            this._broadcastEvent(EVENT_NAME.ERROR, event);
        }

        this._connect();
    };

    private _handleClose = (event: Events.CloseEvent) => {
        console.log('断连原因：', event);
        this._debug('close event');
        this._clearTimeouts();

        if (this._shouldReconnect) {
            this._connect();
        }

        if (this.onclose) {
            this.onclose(event);
        }
        this._listeners.close.forEach((listener) => this._callEventListener(event, listener));
        this._broadcastEvent(EVENT_NAME.CLOSE, event);
    };

    private _removeListeners() {
        if (!this._ws) {
            return;
        }
        this._debug('removeListeners');
        this._ws.removeEventListener('open', this._handleOpen);
        this._ws.removeEventListener('close', this._handleClose);
        this._ws.removeEventListener('message', this._handleMessage);
        // @ts-ignore
        this._ws.removeEventListener('error', this._handleError);
    }

    private _addListeners() {
        if (!this._ws) {
            return;
        }
        this._debug('addListeners');
        this._ws.addEventListener('open', this._handleOpen);
        this._ws.addEventListener('close', this._handleClose);
        this._ws.addEventListener('message', this._handleMessage);
        // @ts-ignore
        this._ws.addEventListener('error', this._handleError);
    }

    private _clearTimeouts() {
        clearTimeout(this._connectTimeout);
        clearTimeout(this._uptimeTimeout);
    }

    private _assembleUrl(url: string, query: Query) {
        if (query) {
            const queryString = Object.keys(query).map((key) => `${key}=${query[key]}`).join('&');
            if (url.indexOf('?') === -1) {
                url += `?${queryString}`;
            } else {
                url += `&${queryString}`;
            }
        }
        return url;
    }

    private _broadcastEvent(eventName: string, res?: any) {
        if (this._eventListeners.has(eventName)) {
            this._eventListeners.get(eventName).forEach((callback: any) => {
                // eslint-disable-next-line no-unused-expressions
                res ? callback(res) : callback();
            });
        }
    }

    private _startHeartbeat() {
        const { pingInterval = DEFAULT.pingInterval, pingTimeout = DEFAULT.pingTimeout } = this._options;
        this._heartbeatTimer = setInterval(() => {
            if (this._ws?.readyState === this.OPEN && !this._heartbeatTimeout) {
                // todo 心跳结构
                this._ws.send(this._options.heartbeatData || MESSAGE_FRAME_IDENTIFIER.PING);
                this._broadcastEvent(EVENT_NAME.PING);
                this._debug('ping');
                this._heartbeatTimeout = setTimeout(() => {
                    this._debug('ping timeout');
                    this._disconnect(1000, 'ping timeout');
                    this._connect();
                }, pingTimeout);
            }
        }, pingInterval);
    }

    private _stopHeartbeat() {
        if (this._heartbeatTimer) {
            console.log('中断心跳');
            this._debug('stop ping');
            clearInterval(this._heartbeatTimer);
            clearTimeout(this._heartbeatTimeout);
            this._heartbeatTimer = null;
            this._heartbeatTimeout = null;
        }
    }

    private _triggerPongCallback() {
        this._debug('pong');
        clearTimeout(this._heartbeatTimeout);
        this._heartbeatTimeout = null;
        this._broadcastEvent(EVENT_NAME.PONG);
    }
}
