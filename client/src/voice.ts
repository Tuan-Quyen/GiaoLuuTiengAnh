// Proximity voice: WebRTC P2P chỉ giữa những người cùng ở Khu thư giãn và đứng gần nhau.
// - Kết nối khi < VOICE_MAX + 1m, ngắt khi > VOICE_DISCONNECT (có độ trễ để không chập chờn).
// - Âm lượng = voiceGain(khoảng cách) qua GainNode (iOS không cho chỉnh audio.volume).
// - Mic mặc định tắt; tắt mic = replaceTrack(null) + dừng track (trình duyệt tắt đèn mic).
// - Người có sid nhỏ hơn là bên gửi offer → không bao giờ hai bên cùng offer.
// - Tối đa MAX_PEERS kết nối (người gần nhất) để đông người vẫn chạy được trên điện thoại.
import type { Socket } from 'socket.io-client';
import type { Zone } from '../../shared/map.ts';
import { VOICE_DISCONNECT, VOICE_MAX, voiceGain } from '../../shared/protocol.ts';

interface Peer {
  pc: RTCPeerConnection;
  gain?: GainNode;
  analyser?: AnalyserNode;
  el?: HTMLAudioElement;
  pendingIce: RTCIceCandidateInit[];
  speaking: boolean;
}

export interface VoiceWorld {
  self(): { sid: string; x: number; z: number; zone: Zone } | null;
  others(): Iterable<{ sid: string; x: number; z: number; zone: Zone }>;
  onSpeaking(sid: string, speaking: boolean): void;
}

const MAX_PEERS = 8;

type Signal = { type: 'offer' | 'answer'; sdp: string } | { type: 'ice'; candidate: RTCIceCandidateInit } | { type: 'bye' };

export class Voice {
  private peers = new Map<string, Peer>();
  private cooldown = new Map<string, number>();
  private ctx?: AudioContext;
  private track: MediaStreamTrack | null = null;
  private localAnalyser?: AnalyserNode;
  private localSpeaking = false;
  micOn = false;

  constructor(private socket: Socket, private world: VoiceWorld, private iceServers: RTCIceServer[]) {
    socket.on('rtc', ({ from, data }: { from: string; data: Signal }) => this.onSignal(from, data));
    setInterval(() => this.update(), 200);
  }

  /** Gọi trong một thao tác người dùng (click/tap) để trình duyệt cho phát âm thanh */
  unlock() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  async setMic(on: boolean): Promise<boolean> {
    this.unlock();
    if (on && !this.track) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        this.track = stream.getAudioTracks()[0];
        const src = this.ctx!.createMediaStreamSource(stream);
        this.localAnalyser = this.ctx!.createAnalyser();
        this.localAnalyser.fftSize = 512;
        src.connect(this.localAnalyser);
      } catch (e) {
        console.warn('mic', e);
        return false;
      }
    }
    if (!on && this.track) {
      this.track.stop();
      this.track = null;
      this.localAnalyser = undefined;
    }
    this.micOn = on;
    for (const p of this.peers.values()) this.applyTrack(p.pc);
    this.socket.emit('mic', on);
    return true;
  }

  private applyTrack(pc: RTCPeerConnection) {
    const sender = pc.getTransceivers()[0]?.sender;
    sender?.replaceTrack(this.track).catch(() => {});
  }

  private update() {
    const me = this.world.self();
    const wanted = new Map<string, number>();
    if (me && me.zone === 'lounge') {
      for (const o of this.world.others()) {
        if (o.zone !== 'lounge') continue;
        const d = Math.hypot(o.x - me.x, o.z - me.z);
        const connected = this.peers.has(o.sid);
        if (d < VOICE_MAX + 1 || (connected && d < VOICE_DISCONNECT)) wanted.set(o.sid, d);
      }
      // Giới hạn số kết nối P2P: chỉ giữ MAX_PEERS người gần nhất (mesh 30 người quá nặng cho điện thoại)
      if (wanted.size > MAX_PEERS) {
        const keep = new Set([...wanted].sort((a, b) => a[1] - b[1]).slice(0, MAX_PEERS).map(([sid]) => sid));
        for (const sid of [...wanted.keys()]) if (!keep.has(sid)) wanted.delete(sid);
      }
    }
    for (const sid of this.peers.keys()) if (!wanted.has(sid)) this.close(sid, true);
    for (const [sid, d] of wanted) {
      if (!this.peers.has(sid) && me && me.sid < sid && (this.cooldown.get(sid) ?? 0) < Date.now()) this.connect(sid);
      const p = this.peers.get(sid);
      if (p?.gain && this.ctx) p.gain.gain.setTargetAtTime(voiceGain(d), this.ctx.currentTime, 0.15);
      if (p?.analyser) {
        const s = level(p.analyser) > 0.02;
        if (s !== p.speaking) {
          p.speaking = s;
          this.world.onSpeaking(sid, s);
        }
      }
    }
    if (me) {
      const s = Boolean(this.localAnalyser && this.micOn && level(this.localAnalyser) > 0.02);
      if (s !== this.localSpeaking) {
        this.localSpeaking = s;
        this.world.onSpeaking(me.sid, s);
      }
    }
  }

  /** Số người đang nghe được mình / mình nghe được */
  get connectedCount() {
    return this.peers.size;
  }

  private createPeer(sid: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { pc, pendingIce: [], speaking: false };
    this.peers.set(sid, peer);
    pc.onicecandidate = (e) => e.candidate && this.send(sid, { type: 'ice', candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => this.attachAudio(peer, e.streams[0] ?? new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.close(sid, true);
    };
    return peer;
  }

  private async connect(sid: string) {
    const peer = this.createPeer(sid);
    const tr = peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
    if (this.track) await tr.sender.replaceTrack(this.track);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.send(sid, { type: 'offer', sdp: offer.sdp! });
  }

  private async onSignal(from: string, data: Signal) {
    try {
      if (data.type === 'bye') {
        this.cooldown.set(from, Date.now() + 5000); // bên kia chủ động ngắt/từ chối → đừng gọi lại ngay
        return this.close(from, false);
      }
      if (data.type === 'offer') {
        this.close(from, false);
        if (this.peers.size >= MAX_PEERS) return this.send(from, { type: 'bye' });
        const peer = this.createPeer(from);
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const tr = peer.pc.getTransceivers()[0];
        if (tr) {
          tr.direction = 'sendrecv';
          await tr.sender.replaceTrack(this.track);
        }
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send(from, { type: 'answer', sdp: answer.sdp! });
        await this.flushIce(peer);
        return;
      }
      const peer = this.peers.get(from);
      if (!peer) return;
      if (data.type === 'answer') {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flushIce(peer);
      } else if (data.type === 'ice') {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
        else peer.pendingIce.push(data.candidate);
      }
    } catch (e) {
      console.warn('rtc', e);
    }
  }

  private async flushIce(peer: Peer) {
    for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  private attachAudio(peer: Peer, stream: MediaStream) {
    this.unlock();
    const ctx = this.ctx!;
    // Chrome chỉ đẩy âm thanh WebRTC vào WebAudio khi stream đang gắn với một thẻ <audio>
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    src.connect(gain).connect(ctx.destination);
    Object.assign(peer, { el, gain, analyser });
  }

  private close(sid: string, notify: boolean) {
    const p = this.peers.get(sid);
    if (!p) return;
    this.peers.delete(sid);
    if (notify) this.send(sid, { type: 'bye' });
    p.gain?.disconnect();
    p.el && (p.el.srcObject = null);
    p.pc.close();
    if (p.speaking) this.world.onSpeaking(sid, false);
  }

  closeAll() {
    for (const sid of [...this.peers.keys()]) this.close(sid, true);
  }

  private send(to: string, data: Signal) {
    this.socket.emit('rtc', { to, data });
  }
}

const buf = new Float32Array(512);
function level(a: AnalyserNode) {
  a.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < a.fftSize; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / a.fftSize);
}
