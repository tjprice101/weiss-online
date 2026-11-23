import Peer, { type DataConnection } from 'peerjs';

const PREFIX = 'wsom-room-';

function iceServers(): RTCIceServer[] {
  const base: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const extra = import.meta.env.VITE_ICE_SERVERS as string | undefined;
  if (extra) {
    try {
      base.push(...(JSON.parse(extra) as RTCIceServer[]));
    } catch {
      console.warn('VITE_ICE_SERVERS is not valid JSON');
    }
  }
  return base;
}

export function randomRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => chars[b % chars.length]).join('');
}

export type NetStatus = 'idle' | 'waiting' | 'connecting' | 'connected' | 'disconnected' | 'error';

/** A thin wrapper around PeerJS: one host, one guest, one reliable data channel. */
export class Net {
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  status: NetStatus = 'idle';
  code = '';
  role: 'host' | 'guest' = 'host';
  onMessage: (msg: any) => void = () => {};
  onStatus: (s: NetStatus, detail?: string) => void = () => {};
  onOpen: () => void = () => {};

  private set(s: NetStatus, detail?: string) {
    this.status = s;
    this.onStatus(s, detail);
  }

  host(code: string): Promise<void> {
    this.role = 'host';
    this.code = code;
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + code, { config: { iceServers: iceServers() }, debug: 1 });
      this.peer = peer;
      let opened = false;
      peer.on('open', () => {
        if (!opened) {
          opened = true;
          if (!this.conn?.open) this.set('waiting');
          resolve();
        }
      });
      peer.on('connection', (c) => {
        // Only one opponent at a time; a dropped guest can rejoin once their old connection closes.
        if (this.conn && this.conn.open) {
          c.on('open', () => (c.send({ t: 'busy' }), setTimeout(() => c.close(), 500)));
          return;
        }
        this.attach(c);
      });
      peer.on('disconnected', () => {
        // Lost the signalling server (needed so the guest can find us). The data connection keeps working.
        const retry = (n: number) => {
          if (peer.destroyed || !peer.disconnected) return;
          try {
            peer.reconnect();
          } catch {
            /* ignore */
          }
          if (n < 20) setTimeout(() => retry(n + 1), 3000);
        };
        setTimeout(() => retry(0), 1000);
      });
      peer.on('error', (err: any) => {
        if (err.type === 'unavailable-id') reject(new Error('Room code already in use'));
        else if (!opened) reject(err);
        else if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) console.warn('PeerJS signalling issue (reconnecting):', err.type);
        else this.set('error', String(err.message ?? err));
      });
    });
  }

  async join(code: string, attempts = 4): Promise<void> {
    this.role = 'guest';
    this.code = code.toUpperCase().trim();
    for (let i = 0; ; i++) {
      try {
        await this.tryJoin();
        return;
      } catch (e: any) {
        if (!e?.retry || i >= attempts - 1) {
          this.set('error', e?.message ?? String(e));
          throw e;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  }

  /** Reconnect a guest to the same room after a drop. */
  rejoin() {
    return this.join(this.code);
  }

  private guestPeer(): Promise<Peer> {
    if (this.peer && !this.peer.destroyed && this.peer.open) return Promise.resolve(this.peer);
    this.peer?.destroy();
    return new Promise((resolve, reject) => {
      const peer = new Peer({ config: { iceServers: iceServers() }, debug: 1 });
      this.peer = peer;
      peer.once('open', () => resolve(peer));
      peer.once('error', (err) => reject(err));
      peer.on('disconnected', () => !peer.destroyed && setTimeout(() => peer.disconnected && !peer.destroyed && peer.reconnect(), 1500));
    });
  }

  private async tryJoin(): Promise<void> {
    this.set('connecting');
    const peer = await this.guestPeer();
    await new Promise<void>((resolve, reject) => {
      const c = peer.connect(PREFIX + this.code, { reliable: true });
      const fail = (msg: string, retry: boolean) => {
        cleanup();
        c.close();
        reject(Object.assign(new Error(msg), { retry }));
      };
      const onErr = (err: any) => {
        if (err.type === 'peer-unavailable') fail('Room not found. Check the code and make sure the host is still waiting.', true);
        else fail(String(err.message ?? err), err.type === 'network' || err.type === 'server-error');
      };
      const timer = setTimeout(() => fail('Could not reach that room (timed out).', true), 15000);
      const cleanup = () => {
        clearTimeout(timer);
        peer.off('error', onErr);
      };
      peer.on('error', onErr);
      c.on('open', () => {
        cleanup();
        resolve();
      });
      this.attach(c);
    });
  }

  private attach(c: DataConnection) {
    this.conn = c;
    c.on('open', () => {
      this.set('connected');
      this.onOpen();
    });
    c.on('data', (d) => this.onMessage(d));
    c.on('close', () => {
      if (this.conn === c) {
        this.conn = null;
        this.set(this.role === 'host' ? 'waiting' : 'disconnected');
        if (this.role === 'host') this.onStatus('waiting', 'Opponent disconnected — waiting for them to rejoin');
      }
    });
    c.on('error', (e) => console.warn('conn error', e));
  }

  send(msg: unknown) {
    if (this.conn?.open) this.conn.send(msg);
  }

  get connected() {
    return !!this.conn?.open;
  }

  destroy() {
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
    this.status = 'idle';
  }
}
