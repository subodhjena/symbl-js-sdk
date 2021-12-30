/* eslint-disable sort-keys */
/* eslint-disable max-len */
import IEBackoff from "./InverseExpBackoff";
import WebSocket from "../websocket/WebSocket";
import config from "../config";
import logger from "../logger/Logger";

const webSocketConnectionStatus = {
    "notAvailable": "not_available",
    "notConnected": "not_connected",
    "connected": "connected",
    "error": "error",
    "closed": "closed",
    "connecting": "connecting"
};

export default class SessionApi {

    oauth2: OAuth2Object;

    id: string;

    connectionOptions: {
        handlers: any,
        reconnectOnError: boolean;
    }

    webSocketUrl: string;

    options: SessionOptions;

    webSocket: WebSocket;

    webSocketStatus: string;

    backoff: IEBackoff;

    onMessage: (arg?: any) => void;

    constructor (options: SessionOptions, oauth2: OAuth2Object) {

        this.connectionOptions = options.options;
        const onMessage = this.connectionOptions.handlers.onMessage;
        const {isStreaming} = options;

        if (!onMessage || typeof onMessage !== "function") {

            throw new Error("onMessage function is required for establishing connection with Session-Manger Websocket.");

        }

        let basePath = options.basePath || config.basePath;

        basePath = basePath.replace(
            /^http/u,
            "ws"
        );

        let session = "session";
        if (isStreaming) {

            session = "v1";

        }

        const uri = `${basePath}/${session}/subscribe`;

        if (!oauth2) {

            throw new Error("oauth2 is required for Session-Manager API.");

        }

        const {id} = options;

        if (!id) {

            throw new Error("id is required for establishing connection.");

        }

        this.backoff = new IEBackoff();

        this.oauth2 = oauth2;
        this.id = id;
        this.onMessage = onMessage;
        this.webSocketUrl = `${uri}/${this.id}`;
        this.options = options;

        this.connect = this.connect.bind(this);
        this.onConnectWebSocket = this.onConnectWebSocket.bind(this);
        this.onErrorWebSocket = this.onErrorWebSocket.bind(this);
        this.onMessageWebSocket = this.onMessageWebSocket.bind(this);
        this.onCloseWebSocket = this.onCloseWebSocket.bind(this);
        this.disconnect = this.disconnect.bind(this);

    }

    onCloseWebSocket (event: any): void {
        this.webSocketStatus = webSocketConnectionStatus.closed;
        if (this.connectionOptions.reconnectOnError === false && event.wasClean === false) {
            logger.debug("Attempting reconnect after error.");
            // this._cleanForReconnect();
            setTimeout(() => {
                this.connect().catch((err) => {
                    if (this.connectionOptions.handlers.onReconnectFail && typeof this.connectionOptions.handlers.onReconnectFail === "function") {
                        this.connectionOptions.handlers.onReconnectFail(err);
                    }
                });
            }, 3000);
        } else {
            logger.debug(
                new Date().toISOString(),
                "WebSocket Closed."
            );
        }
        if (this.connectionOptions.handlers.onClose && typeof this.connectionOptions.handlers.onClose === "function") {
            this.connectionOptions.handlers.onClose();
        }
    }

    onConnectWebSocket (): void {

        logger.debug("WebSocket Connected.");
        this.webSocketStatus = webSocketConnectionStatus.connected;

        if (this.connectionOptions.handlers.onSubscribe && typeof this.connectionOptions.handlers.onSubscribe === "function") {
            this.connectionOptions.handlers.onSubscribe();
        }

    }

    onErrorWebSocket (err: string): void {

        this.webSocketStatus = webSocketConnectionStatus.error;
        logger.error(err);

    }

    onMessageWebSocket (result: string): void {

        // Expecting insight data
        if (result) {

            const data = JSON.parse(result);
            logger.debug(
                "Websocket Message: ",
                {data}
            );
            this.onMessage(data);

        }

    }

    connect (): Promise<void> {

        return new Promise((resolve, reject) => {
            if (this.webSocketStatus !== webSocketConnectionStatus.connected) {
                logger.debug(`WebSocket Connecting on: ${this.webSocketUrl}`);
                if (this.webSocketStatus !== webSocketConnectionStatus.connecting) {
                    this.webSocketStatus = webSocketConnectionStatus.connecting;
                }
                this.webSocket = new WebSocket({
                    "url": this.webSocketUrl,
                    "accessToken": this.oauth2.activeToken,
                    "onError": this.onErrorWebSocket,
                    "onClose": this.onCloseWebSocket,
                    "onMessage": this.onMessageWebSocket,
                    "onConnect": this.onConnectWebSocket
                });
                this.backoff.run(this.connect).catch(() => {
                    reject('Too many retries attempted. Try again later.');
                });
            } else if (this.webSocketStatus === webSocketConnectionStatus.connected) {
                resolve();
            }
        });

    }

    disconnect (): void {

        logger.debug("Disconnecting WebSocket Connection");
        this.webSocket.disconnect();

    }

}
