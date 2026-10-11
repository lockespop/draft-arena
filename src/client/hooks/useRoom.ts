import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ClientRoomView, ServerMessage } from '../../shared/types';

function wsUrl(): string {
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (envUrl) return envUrl;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.hostname}:3001`;
}

export interface RoomHandle {
  state: ClientRoomView | null;
  youId: string | null;
  connected: boolean;
  error: string | null;
  send: (msg: ClientMessage) => void;
  clearError: () => void;
}

export function useRoom(): RoomHandle {
  const [state, setState] = useState<ClientRoomView | null>(null);
  const [youId, setYouId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const shouldRun = useRef(true);

  useEffect(() => {
    shouldRun.current = true;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!shouldRun.current) return;
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (shouldRun.current) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data as string) as ServerMessage;
          if (msg.t === 'state') {
            setState(msg.state);
            setYouId(msg.youId);
          } else if (msg.t === 'error') {
            setError(msg.message);
          }
        } catch {
          /* ignore malformed */
        }
      };
    };

    connect();
    return () => {
      shouldRun.current = false;
      if (retry) clearTimeout(retry);
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { state, youId, connected, error, send, clearError };
}
