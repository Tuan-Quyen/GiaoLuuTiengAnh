// Chat chữ: kênh chung (cả phòng) và kênh theo khu (chỉ người đang ở cùng khu).
import type { Socket } from 'socket.io-client';
import { ZONE_LABEL, type Zone } from '../../../shared/map.ts';
import type { ChatChannel, ChatMessage } from '../../../shared/protocol.ts';
import { h, isTouch, ui } from '../dom.ts';

export class Chat {
  private channel: ChatChannel = 'global';
  private msgs: ChatMessage[] = [];
  private list = h('div.msgs');
  private input = h('input', { placeholder: 'Nhắn gì đó… (Enter)', maxLength: 300, enterKeyHint: 'send' });
  private tabs: HTMLButtonElement[];
  private el: HTMLElement;
  private badge = h('span.badge.hidden');
  private unread = 0;
  private zone: Zone = 'lounge';

  constructor(private socket: Socket, private myUserId: string, initial: ChatMessage[]) {
    this.tabs = [
      h('button.on', { onclick: () => this.setChannel('global') }, 'Chung'),
      h('button', { onclick: () => this.setChannel('zone') }, 'Khu này'),
    ];
    const form = h('form', {
      onsubmit: (e: Event) => {
        e.preventDefault();
        const text = this.input.value.trim();
        if (text) socket.emit('chat', { channel: this.channel, text });
        this.input.value = '';
        if (isTouch()) this.input.blur();
      },
    }, this.input, h('button.primary', { type: 'submit' }, 'Gửi'));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.input.blur();
      e.stopPropagation();
    });
    const head = h('div.head', { onclick: () => this.toggle() }, '💬 Chat', this.badge, h('div.spacer'), h('span.small', '▾'));
    this.el = h(`div.chat${isTouch() ? '.touch.collapsed' : ''}`, head, h('div.tabs', this.tabs), this.list, form);
    ui().appendChild(this.el);
    socket.on('chat', (m: ChatMessage) => this.add(m));
    initial.forEach((m) => this.add(m, true));
  }

  setZone(z: Zone) {
    this.zone = z;
    this.tabs[1].textContent = `Khu: ${ZONE_LABEL[z]}`;
    this.render();
  }

  focus() {
    this.el.classList.remove('collapsed');
    this.input.focus();
  }

  private toggle() {
    this.el.classList.toggle('collapsed');
    if (!this.el.classList.contains('collapsed')) this.clearUnread();
  }

  private clearUnread() {
    this.unread = 0;
    this.badge.classList.add('hidden');
  }

  private setChannel(c: ChatChannel) {
    this.channel = c;
    this.tabs.forEach((t, i) => t.classList.toggle('on', (i === 0) === (c === 'global')));
    this.render();
  }

  private add(m: ChatMessage, silent = false) {
    this.msgs.push(m);
    if (this.msgs.length > 200) this.msgs.shift();
    if (!silent && this.el.classList.contains('collapsed') && m.userId !== this.myUserId) {
      this.badge.textContent = String(++this.unread);
      this.badge.classList.remove('hidden');
    }
    this.render();
  }

  private render() {
    const shown = this.msgs.filter((m) => (this.channel === 'global' ? m.channel === 'global' : m.channel === 'zone' && m.zone === this.zone));
    this.list.replaceChildren(
      ...(shown.length
        ? shown.map((m) =>
            h(
              `div.m${m.userId === this.myUserId ? '.me' : ''}`,
              h('b', m.name),
              ': ',
              m.text,
              ' ',
              h('span.z', new Date(m.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })),
            ),
          )
        : [h('div.muted.small', this.channel === 'global' ? 'Chưa có tin nhắn. Say hi in English! 👋' : 'Chỉ người ở cùng khu thấy tin nhắn ở đây.')]),
    );
    this.list.scrollTop = this.list.scrollHeight;
  }
}
